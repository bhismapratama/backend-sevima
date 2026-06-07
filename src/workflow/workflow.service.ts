import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Redis from 'ioredis';
import {PrismaService} from 'infra/database/prisma.service';
import {REDIS_CLIENT} from 'infra/redis/redis.module';
import {parseDag} from './core/dag-parser';
import {validateDag} from './core/dag-validator';
import {WorkflowDefinition} from './interfaces';
import {
  CreateWorkflowDto,
  ListWorkflowsDto,
  RollbackWorkflowDto,
  UpdateWorkflowDto,
} from './dto';

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async create(tenantId: string, dto: CreateWorkflowDto) {
    const definition = dto.dag as unknown as WorkflowDefinition;
    const graph = parseDag(definition);
    const {valid, errors} = validateDag(definition, graph);
    if (!valid)
      throw new BadRequestException(`DAG tidak valid: ${errors.join('; ')}`);

    return this.prisma.$transaction(async (tx) => {
      const workflow = await tx.workflowDefinition.create({
        data: {
          tenantId,
          name: dto.name,
          description: dto.description,
          currentVersion: 1,
        },
      });

      await tx.workflowVersion.create({
        data: {
          workflowDefinitionId: workflow.id,
          version: 1,
          dag: dto.dag as any,
        },
      });

      return tx.workflowDefinition.findUniqueOrThrow({
        where: {id: workflow.id},
        include: {
          versions: {orderBy: {version: 'desc'}, take: 1},
          triggers: true,
        },
      });
    });
  }

  async findAll(tenantId: string, query: ListWorkflowsDto) {
    const {page, limit, search} = query;
    const skip = (page - 1) * limit;

    const where = {
      tenantId,
      ...(search
        ? {name: {contains: search, mode: 'insensitive' as const}}
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.workflowDefinition.findMany({
        where,
        skip,
        take: limit,
        orderBy: {createdAt: 'desc'},
        include: {
          versions: {
            orderBy: {version: 'desc'},
            take: 1,
            select: {id: true, version: true, dag: true, createdAt: true},
          },
          _count: {select: {executions: true}},
        },
      }),
      this.prisma.workflowDefinition.count({where}),
    ]);

    return {items, total, page, limit, totalPages: Math.ceil(total / limit)};
  }

  async findOne(tenantId: string, id: string) {
    const workflow = await this.prisma.workflowDefinition.findFirst({
      where: {id, tenantId},
      include: {
        versions: {orderBy: {version: 'desc'}, take: 1},
        triggers: {where: {isActive: true}},
      },
    });
    if (!workflow) throw new NotFoundException(`Workflow ${id} tidak ditemukan`);
    return workflow;
  }

  async update(tenantId: string, id: string, dto: UpdateWorkflowDto) {
    const existing = await this.findOne(tenantId, id);

    if (dto.dag) {
      const definition = dto.dag as unknown as WorkflowDefinition;
      const graph = parseDag(definition);
      const {valid, errors} = validateDag(definition, graph);
      if (!valid)
        throw new BadRequestException(`Invalid DAG: ${errors.join('; ')}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const newVersion = existing.currentVersion + 1;
      const dagToSave =
        dto.dag ?? (existing.versions[0]?.dag as Record<string, unknown>);

      await tx.workflowVersion.create({
        data: {
          workflowDefinitionId: id,
          version: newVersion,
          dag: dagToSave as any,
        },
      });

      return tx.workflowDefinition.update({
        where: {id},
        data: {
          name: dto.name,
          description: dto.description,
          currentVersion: newVersion,
        },
        include: {
          versions: {orderBy: {version: 'desc'}, take: 1},
          triggers: {where: {isActive: true}},
        },
      });
    });
  }

  async rollback(tenantId: string, id: string, dto: RollbackWorkflowDto) {
    await this.findOne(tenantId, id);

    const targetVersion = await this.prisma.workflowVersion.findUnique({
      where: {
        workflowDefinitionId_version: {
          workflowDefinitionId: id,
          version: dto.version,
        },
      },
    });
    if (!targetVersion)
      throw new NotFoundException(`Versi ${dto.version} tidak ditemukan`);

    return this.prisma.workflowDefinition.update({
      where: {id},
      data: {currentVersion: dto.version},
      include: {
        versions: {where: {version: dto.version}, take: 1},
        triggers: {where: {isActive: true}},
      },
    });
  }

  async getVersions(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.workflowVersion.findMany({
      where: {workflowDefinitionId: id},
      orderBy: {version: 'desc'},
      select: {id: true, version: true, createdAt: true},
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.workflowDefinition.delete({where: {id}});
    await this.redis.del(`health:metrics:${tenantId}`);
  }
}
