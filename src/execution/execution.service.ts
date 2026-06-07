import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {InjectQueue} from '@nestjs/bull';
import {Queue} from 'bull';
import {PrismaService} from 'infra/database/prisma.service';
import {REDIS_CLIENT} from 'infra/redis/redis.module';
import {ListExecutionsDto, TriggerExecutionDto} from './dto';
import type Redis from 'ioredis';

@Injectable()
export class ExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('execution') private readonly queue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async triggerManual(
    tenantId: string,
    workflowId: string,
    userId: string | null,
    dto: TriggerExecutionDto,
  ) {
    const workflow = await this.prisma.workflowDefinition.findFirst({
      where: {id: workflowId, tenantId},
    });
    if (!workflow) throw new NotFoundException('Workflow tidak ditemukan');

    const version = await this.prisma.workflowVersion.findUnique({
      where: {
        workflowDefinitionId_version: {
          workflowDefinitionId: workflowId,
          version: workflow.currentVersion,
        },
      },
    });
    if (!version)
      throw new NotFoundException('Versi workflow saat ini tidak ditemukan');

    const execution = await this.prisma.execution.create({
      data: {
        tenantId,
        workflowDefinitionId: workflowId,
        workflowVersionId: version.id,
        triggeredById: userId,
        status: 'PENDING',
      },
    });

    await this.queue.add('run', {
      executionId: execution.id,
      globals: dto.globals ?? {},
    });

    return {executionId: execution.id};
  }

  async findAll(tenantId: string, query: ListExecutionsDto) {
    const {page, limit, workflowId, status, since} = query;
    const skip = (page - 1) * limit;

    const where = {
      tenantId,
      ...(workflowId ? {workflowDefinitionId: workflowId} : {}),
      ...(status ? {status} : {}),
      ...(since ? {createdAt: {gte: new Date(since)}} : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.execution.findMany({
        where,
        skip,
        take: limit,
        orderBy: {createdAt: 'desc'},
        include: {
          workflowDefinition: {select: {id: true, name: true}},
          triggeredBy: {select: {id: true, email: true}},
        },
      }),
      this.prisma.execution.count({where}),
    ]);

    return {items, total, page, limit, totalPages: Math.ceil(total / limit)};
  }

  async findOne(tenantId: string, id: string) {
    const execution = await this.prisma.execution.findFirst({
      where: {id, tenantId},
      include: {
        workflowDefinition: {select: {id: true, name: true}},
        workflowVersion: {select: {id: true, version: true}},
        stepLogs: {orderBy: {startedAt: 'asc'}},
        triggeredBy: {select: {id: true, email: true}},
      },
    });
    if (!execution)
      throw new NotFoundException(`Eksekusi ${id} tidak ditemukan`);
    return execution;
  }

  async cancel(tenantId: string, id: string) {
    const execution = await this.findOne(tenantId, id);
    if (!['PENDING', 'RUNNING'].includes(execution.status)) {
      throw new BadRequestException(
        `Tidak dapat membatalkan eksekusi dengan status ${execution.status}`,
      );
    }
    const result = await this.prisma.execution.update({
      where: {id},
      data: {status: 'CANCELLED', completedAt: new Date()},
    });
    await this.redis.del(`health:metrics:${tenantId}`);
    return result;
  }
}
