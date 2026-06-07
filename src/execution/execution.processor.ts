import {Inject} from '@nestjs/common';
import {Process, Processor} from '@nestjs/bull';
import {Job} from 'bull';
import {ExecutionStatus, StepStatus} from '@prisma/client';
import {PrismaService} from 'infra/database/prisma.service';
import {REDIS_CLIENT} from 'infra/redis/redis.module';
import {WorkflowDefinition} from 'workflow/interfaces';
import {
  WorkflowExecutor,
  ExecutionResult,
} from 'workflow/core/workflow-executor';
import {ExecutionGateway} from './execution.gateway';
import type Redis from 'ioredis';

interface ExecutionJobData {
  executionId: string;
  globals: Record<string, unknown>;
}

@Processor('execution')
export class ExecutionProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ExecutionGateway,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Process('run')
  async handleRun(job: Job<ExecutionJobData>): Promise<void> {
    const {executionId, globals} = job.data;

    const dbExecution = await this.prisma.execution.findUnique({
      where: {id: executionId},
      include: {workflowVersion: true},
    });

    if (!dbExecution || dbExecution.status === 'CANCELLED') return;

    await this.prisma.execution.update({
      where: {id: executionId},
      data: {status: 'RUNNING', startedAt: new Date()},
    });

    const executor = new WorkflowExecutor();

    executor.on('step.started', (event) => {
      if (event.type !== 'step.started') return;
      this.gateway.broadcast(executionId, {
        type: 'step.started',
        stepId: event.stepId,
        stepName: event.stepName,
      });
    });

    executor.on('step.completed', (event) => {
      if (event.type !== 'step.completed') return;
      this.gateway.broadcast(executionId, {
        type:
          event.result.status === 'success' ? 'step.completed' : 'step.failed',
        stepId: event.result.stepId,
      });
    });

    executor.on('execution.completed', (event) => {
      if (event.type !== 'execution.completed') return;
      this.gateway.broadcast(executionId, {
        type:
          event.status === 'success'
            ? 'execution.completed'
            : 'execution.failed',
      });
    });

    const definition = dbExecution.workflowVersion
      .dag as unknown as WorkflowDefinition;

    let result: ExecutionResult;
    try {
      result = await executor.execute(definition, {
        executionId,
        tenantId: dbExecution.tenantId,
        workflowId: dbExecution.workflowDefinitionId,
        globals,
      });
    } catch (err) {
      const failedAt = new Date();
      await this.prisma.execution.update({
        where: {id: executionId},
        data: {
          status: ExecutionStatus.FAILED,
          completedAt: failedAt,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      await this.redis.del(`health:metrics:${dbExecution.tenantId}`);
      this.gateway.broadcastTenant(dbExecution.tenantId, {
        executionId,
        status: 'FAILED',
        completedAt: failedAt.toISOString(),
      });
      return;
    }

    const dbStatus =
      result.status === 'success'
        ? ExecutionStatus.SUCCESS
        : result.status === 'timeout'
          ? ExecutionStatus.TIMEOUT
          : ExecutionStatus.FAILED;

    await this.prisma.$transaction(async (tx) => {
      await tx.execution.update({
        where: {id: executionId},
        data: {
          status: dbStatus,
          completedAt: result.completedAt,
          durationMs: result.durationMs,
          error: result.error,
        },
      });

      const stepLogs = [...result.steps.entries()].map(
        ([stepId, stepResult]) => ({
          executionId,
          stepId,
          stepName: stepResult.stepName,
          status: this.mapStepStatus(stepResult.status),
          startedAt: stepResult.startedAt,
          completedAt: stepResult.completedAt,
          durationMs: stepResult.durationMs,
          attempt: stepResult.attempt,
          output: (stepResult.output as any) ?? null,
          error: stepResult.error ?? null,
          logs: stepResult.logs,
        }),
      );

      if (stepLogs.length > 0) {
        await tx.executionStepLog.createMany({data: stepLogs});
      }
    });

    await this.redis.del(`health:metrics:${dbExecution.tenantId}`);
    this.gateway.broadcastTenant(dbExecution.tenantId, {
      executionId,
      status: dbStatus,
      durationMs: result.durationMs,
      completedAt: result.completedAt.toISOString(),
    });
  }

  private mapStepStatus(status: string): StepStatus {
    const map: Record<string, StepStatus> = {
      success: StepStatus.SUCCESS,
      failed: StepStatus.FAILED,
      skipped: StepStatus.SKIPPED,
      timeout: StepStatus.FAILED,
      pending: StepStatus.PENDING,
      running: StepStatus.RUNNING,
    };
    return map[status] ?? StepStatus.FAILED;
  }
}
