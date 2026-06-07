import {EventEmitter} from 'events';
import {WorkflowDefinition, ExecutionContext} from '../interfaces';
import {StepResult} from '../interfaces/step-result.interface';
import {parseDag} from './dag-parser';
import {validateDag} from './dag-validator';
import {topologicalSort} from './topological-sorter';
import {runStep} from './step-runner';
import {withWorkflowTimeout, WorkflowTimeoutError} from './timeout-handler';

export type ExecutionEvent =
  | {type: 'execution.started'; executionId: string}
  | {
      type: 'step.started';
      executionId: string;
      stepId: string;
      stepName: string;
    }
  | {type: 'step.completed'; executionId: string; result: StepResult}
  | {
      type: 'execution.completed';
      executionId: string;
      status: 'success' | 'failed' | 'timeout';
      results: Map<string, StepResult>;
    };

export interface ExecutionResult {
  executionId: string;
  status: 'success' | 'failed' | 'timeout';
  steps: Map<string, StepResult>;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  error?: string;
}

const DEFAULT_WORKFLOW_TIMEOUT_MS = 300_000;

export class WorkflowExecutor {
  private emitter = new EventEmitter();

  on(event: string, listener: (data: ExecutionEvent) => void): void {
    this.emitter.on(event, listener);
  }

  async execute(
    definition: WorkflowDefinition,
    ctx: Omit<
      ExecutionContext,
      'workflow' | 'steps' | 'startTime' | 'timeoutMs'
    >,
  ): Promise<ExecutionResult> {
    const startedAt = new Date();

    const graph = parseDag(definition);
    const {valid, errors} = validateDag(definition, graph);
    if (!valid) {
      throw new Error(`Workflow tidak valid: ${errors.join('; ')}`);
    }

    const timeoutMs = definition.timeoutMs ?? DEFAULT_WORKFLOW_TIMEOUT_MS;
    const steps = new Map<string, StepResult>();

    const executionCtx: ExecutionContext = {
      ...ctx,
      workflow: definition,
      steps,
      startTime: startedAt,
      timeoutMs,
    };

    this.emit({type: 'execution.started', executionId: ctx.executionId});

    const layers = topologicalSort(graph);

    try {
      const run = this.executeLayered(layers, executionCtx);
      await withWorkflowTimeout(ctx.executionId, run, timeoutMs);

      const completedAt = new Date();
      const anyFailed = [...steps.values()].some((s) => s.status === 'failed');
      const status = anyFailed ? 'failed' : 'success';

      this.emit({
        type: 'execution.completed',
        executionId: ctx.executionId,
        status,
        results: steps,
      });

      return {
        executionId: ctx.executionId,
        status,
        steps,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };
    } catch (err) {
      const completedAt = new Date();
      const isTimeout = err instanceof WorkflowTimeoutError;
      const error = err instanceof Error ? err.message : String(err);

      for (const step of definition.steps) {
        if (!steps.has(step.id)) {
          steps.set(step.id, {
            stepId: step.id,
            stepName: step.name,
            status: 'failed',
            attempt: 1,
            error: isTimeout ? 'Workflow batas waktu terlampaui' : 'Workflow dibatalkan',
            logs: [],
          });
        }
      }

      this.emit({
        type: 'execution.completed',
        executionId: ctx.executionId,
        status: isTimeout ? 'timeout' : 'failed',
        results: steps,
      });

      return {
        executionId: ctx.executionId,
        status: isTimeout ? 'timeout' : 'failed',
        steps,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        error,
      };
    }
  }

  private async executeLayered(
    layers: string[][],
    ctx: ExecutionContext,
  ): Promise<void> {
    for (const layer of layers) {
      const results = await Promise.all(
        layer.map((stepId) => this.executeStep(stepId, ctx)),
      );

      const failed = results.find(
        (r) => r.status === 'failed' || r.status === 'timeout',
      );
      if (failed) {
        throw new Error(
          `Langkah "${failed.stepId}" (${failed.stepName}) gagal: ${failed.error ?? 'kesalahan tidak diketahui'}`,
        );
      }
    }
  }

  private async executeStep(
    stepId: string,
    ctx: ExecutionContext,
  ): Promise<StepResult> {
    const step = ctx.workflow.steps.find((s) => s.id === stepId)!;

    this.emit({
      type: 'step.started',
      executionId: ctx.executionId,
      stepId: step.id,
      stepName: step.name,
    });

    const result = await runStep(step, ctx);
    ctx.steps.set(stepId, result);

    this.emit({type: 'step.completed', executionId: ctx.executionId, result});

    return result;
  }

  private emit(event: ExecutionEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
  }
}
