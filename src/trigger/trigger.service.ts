import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import {WorkflowTrigger} from '@prisma/client';
import {createHmac, randomBytes, randomUUID, timingSafeEqual} from 'crypto';
import {ScheduledTask} from 'node-cron';
import * as cron from 'node-cron';
import {PrismaService} from 'infra/database/prisma.service';
import {ExecutionService} from 'execution/execution.service';
import {CreateTriggerDto} from './dto';

@Injectable()
export class TriggerService implements OnModuleInit {
  private readonly cronTasks = new Map<string, ScheduledTask>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly executionService: ExecutionService,
  ) {}

  async onModuleInit() {
    const activeCronTriggers = await this.prisma.workflowTrigger.findMany({
      where: {type: 'CRON', isActive: true},
      include: {workflowDefinition: true},
    });

    for (const trigger of activeCronTriggers) {
      if (trigger.cronExpression && cron.validate(trigger.cronExpression)) {
        this.scheduleCronTask(trigger);
      }
    }

    await this.prisma.webhookNonce.deleteMany({
      where: {expiresAt: {lt: new Date()}},
    });

    cron.schedule('0 * * * *', async () => {
      await this.prisma.webhookNonce.deleteMany({
        where: {expiresAt: {lt: new Date()}},
      });
    });
  }

  async createTrigger(tenantId: string, dto: CreateTriggerDto) {
    const workflow = await this.prisma.workflowDefinition.findFirst({
      where: {id: dto.workflowId, tenantId},
    });
    if (!workflow) throw new NotFoundException('Workflow tidak ditemukan');

    if (dto.type === 'CRON') {
      if (!dto.cronExpression) {
        throw new BadRequestException(
          'cronExpression diperlukan untuk pemicu CRON',
        );
      }
      if (!cron.validate(dto.cronExpression)) {
        throw new BadRequestException('Ekspresi cron tidak valid');
      }

      const trigger = await this.prisma.workflowTrigger.create({
        data: {
          workflowDefinitionId: dto.workflowId,
          type: 'CRON',
          cronExpression: dto.cronExpression,
        },
      });

      this.scheduleCronTask({
        ...trigger,
        workflowDefinition: {tenantId},
      });

      return trigger;
    }

    if (dto.type === 'WEBHOOK') {
      const webhookPath = `/webhooks/${randomUUID()}`;
      const webhookSecret = randomBytes(32).toString('hex');

      return this.prisma.workflowTrigger.create({
        data: {
          workflowDefinitionId: dto.workflowId,
          type: 'WEBHOOK',
          webhookPath,
          webhookSecret,
        },
      });
    }

    return this.prisma.workflowTrigger.create({
      data: {workflowDefinitionId: dto.workflowId, type: 'MANUAL'},
    });
  }

  async listTriggers(tenantId: string, workflowId?: string) {
    if (workflowId) {
      const workflow = await this.prisma.workflowDefinition.findFirst({
        where: {id: workflowId, tenantId},
      });
      if (!workflow) throw new NotFoundException('Workflow tidak ditemukan');
    }

    return this.prisma.workflowTrigger.findMany({
      where: workflowId
        ? {workflowDefinitionId: workflowId}
        : {workflowDefinition: {tenantId}},
      orderBy: {createdAt: 'desc'},
    });
  }

  async toggleTrigger(tenantId: string, triggerId: string) {
    const trigger = await this.findTriggerOwnedByTenant(tenantId, triggerId);

    const updated = await this.prisma.workflowTrigger.update({
      where: {id: triggerId},
      data: {isActive: !trigger.isActive},
    });

    if (trigger.type === 'CRON') {
      if (updated.isActive) {
        const wf = await this.prisma.workflowDefinition.findUniqueOrThrow({
          where: {id: trigger.workflowDefinitionId},
        });
        this.scheduleCronTask({
          ...updated,
          workflowDefinition: {tenantId: wf.tenantId},
        });
      } else {
        void this.cronTasks.get(triggerId)?.stop();
        this.cronTasks.delete(triggerId);
      }
    }

    return updated;
  }

  async deleteTrigger(tenantId: string, triggerId: string) {
    const trigger = await this.findTriggerOwnedByTenant(tenantId, triggerId);

    if (trigger.type === 'CRON') {
      void this.cronTasks.get(triggerId)?.stop();
      this.cronTasks.delete(triggerId);
    }

    await this.prisma.workflowTrigger.delete({where: {id: triggerId}});
  }

  async verifyAndHandleWebhook(
    webhookPath: string,
    body: unknown,
    signature: string | undefined,
    nonce: string | undefined,
  ) {
    if (!signature)
      throw new UnauthorizedException('Header X-FlowForge-Signature tidak ada');
    if (!nonce)
      throw new UnauthorizedException('Header X-FlowForge-Nonce tidak ada');

    const trigger = await this.prisma.workflowTrigger.findFirst({
      where: {webhookPath, type: 'WEBHOOK', isActive: true},
      include: {workflowDefinition: true},
    });
    if (!trigger) throw new NotFoundException('Webhook tidak ditemukan');

    const expected = createHmac('sha256', trigger.webhookSecret!)
      .update(JSON.stringify(body))
      .digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(signature, 'hex');
    } catch {
      throw new UnauthorizedException('Format tanda tangan tidak valid');
    }

    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      throw new UnauthorizedException('Tanda tangan tidak valid');
    }

    const existingNonce = await this.prisma.webhookNonce.findUnique({
      where: {nonce},
    });
    if (existingNonce)
      throw new ConflictException(
        'Nonce duplikat - serangan putar ulang terdeteksi',
      );

    await this.prisma.webhookNonce.create({
      data: {nonce, expiresAt: new Date(Date.now() + 5 * 60 * 1000)},
    });

    const wf = trigger.workflowDefinition;
    return this.executionService.triggerManual(wf.tenantId, wf.id, null, {
      globals: {webhookPayload: body},
    });
  }

  private scheduleCronTask(
    trigger: WorkflowTrigger & {workflowDefinition: {tenantId: string}},
  ) {
    const task = cron.schedule(trigger.cronExpression!, async () => {
      await this.executionService.triggerManual(
        trigger.workflowDefinition.tenantId,
        trigger.workflowDefinitionId,
        null,
        {},
      );
    });
    this.cronTasks.set(trigger.id, task);
  }

  private async findTriggerOwnedByTenant(tenantId: string, triggerId: string) {
    const trigger = await this.prisma.workflowTrigger.findFirst({
      where: {
        id: triggerId,
        workflowDefinition: {tenantId},
      },
    });
    if (!trigger) throw new NotFoundException('Pemicu tidak ditemukan');
    return trigger;
  }
}
