import axios from 'axios';
import {ExecutionContext, WorkflowStep} from '../interfaces';
import {StepResult} from '../interfaces/step-result.interface';
import {executeScript} from './script-executor';
import {interpolate, interpolateDeep} from './variable-interpolator';
import {withRetry} from './retry-strategy';
import {withStepTimeout} from './timeout-handler';
import {VM} from 'vm2';
import {WorkflowDefinition} from '../interfaces/workflow-definition.interface';

const DEFAULT_STEP_TIMEOUT_MS = 30_000;

export async function runStep(
  step: WorkflowStep,
  ctx: ExecutionContext,
): Promise<StepResult> {
  const startedAt = new Date();
  const logs: string[] = [];
  let attempt = 1;

  const result: StepResult = {
    stepId: step.id,
    stepName: step.name,
    status: 'running',
    startedAt,
    attempt,
    logs,
  };

  if (step.runIf) {
    const conditionStr = interpolate(step.runIf, ctx);
    const shouldRun = evalBoolean(conditionStr);
    if (!shouldRun) {
      return {
        ...result,
        status: 'skipped',
        completedAt: new Date(),
        durationMs: 0,
      };
    }
  }

  const stepTimeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const retryConfig = step.retryConfig;

  try {
    let output: unknown;

    await withRetry(
      async (att) => {
        attempt = att + 1;
        result.attempt = attempt;
        logs.push(`Percobaan ${attempt} dimulai`);

        const execution = executeStepByType(step, ctx, logs);
        output = await withStepTimeout(step.id, execution, stepTimeoutMs);

        logs.push(`Percobaan ${attempt} berhasil`);
      },
      retryConfig
        ? {
            maxRetries: retryConfig.maxRetries,
            initialDelayMs: retryConfig.initialDelayMs,
            maxDelayMs: retryConfig.maxDelayMs ?? 30_000,
          }
        : {maxRetries: 0},
      (att, err) =>
        logs.push(`Percobaan ${att} gagal: ${err.message}. Mencoba ulang...`),
    );

    const completedAt = new Date();
    return {
      ...result,
      status: 'success',
      output,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
  } catch (err) {
    const completedAt = new Date();
    const error = err instanceof Error ? err : new Error(String(err));
    logs.push(`Gagal: ${error.message}`);

    return {
      ...result,
      status: error.name === 'StepTimeoutError' ? 'timeout' : 'failed',
      error: error.message,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
  }
}

async function executeStepByType(
  step: WorkflowStep,
  ctx: ExecutionContext,
  logs: string[],
): Promise<unknown> {
  switch (step.type) {
    case 'HTTP_CALL':
      return runHttpStep(step, ctx, logs);
    case 'SCRIPT':
      return runScriptStep(step, ctx, logs);
    case 'DELAY':
      return runDelayStep(step, ctx, logs);
    case 'CONDITION':
      return runConditionStep(step, ctx, logs);
    default:
      throw new Error(`Jenis langkah tidak diketahui: ${step.type as string}`);
  }
}

async function runHttpStep(
  step: WorkflowStep,
  ctx: ExecutionContext,
  logs: string[],
): Promise<unknown> {
  const cfg = step.config as {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: unknown;
  };

  const url = interpolate(cfg.url, ctx);
  const headers = cfg.headers
    ? (interpolateDeep(cfg.headers, ctx) as Record<string, string>)
    : {};
  const data = cfg.body ? interpolateDeep(cfg.body, ctx) : undefined;

  logs.push(`HTTP ${cfg.method} ${url}`);

  const response = await axios.request({
    method: cfg.method as any,
    url,
    headers,
    data,
  });

  logs.push(`HTTP ${response.status} received`);
  return response.data;
}

function runScriptStep(
  step: WorkflowStep,
  ctx: ExecutionContext,
  logs: string[],
): unknown {
  const cfg = step.config as {script: string};

  const input: Record<string, unknown> = {};
  const contextSteps: Record<string, {output: unknown; status: string}> = {};
  for (const [id, r] of ctx.steps) {
    if (r.status === 'success') input[id] = r.output;
    contextSteps[id] = {output: r.output ?? null, status: r.status};
  }

  const prevResult = findPreviousDataStep(step, ctx.workflow, ctx.steps);
  const previousStep = prevResult
    ? {output: prevResult.output ?? null, status: prevResult.status}
    : null;

  logs.push(`Running script (${cfg.script.length} chars)`);
  const {result, logs: scriptLogs} = executeScript(cfg.script, {
    input,
    globals: ctx.globals,
    context: {steps: contextSteps, previousStep},
  });
  logs.push(...scriptLogs);

  return result;
}

function findPreviousDataStep(
  step: WorkflowStep,
  workflow: WorkflowDefinition,
  completedSteps: Map<string, StepResult>,
): StepResult | undefined {
  if (step.dependsOn.length === 0) return undefined;

  for (const depId of step.dependsOn) {
    const depDef = workflow.steps.find((s) => s.id === depId);
    if (!depDef) continue;

    if (depDef.type === 'DELAY') {
      const ancestor = findPreviousDataStep(depDef, workflow, completedSteps);
      if (ancestor) return ancestor;
    } else {
      const result = completedSteps.get(depId);
      if (result) return result;
    }
  }

  return undefined;
}

async function runDelayStep(
  step: WorkflowStep,
  _ctx: ExecutionContext,
  logs: string[],
): Promise<unknown> {
  const cfg = step.config as {delayMs: number};
  logs.push(`Waiting ${cfg.delayMs}ms`);
  await new Promise((resolve) => setTimeout(resolve, cfg.delayMs));
  return {waited: cfg.delayMs};
}

function runConditionStep(
  step: WorkflowStep,
  ctx: ExecutionContext,
  logs: string[],
): Promise<unknown> {
  const cfg = step.config as {expression: string};
  const interpolated = interpolate(cfg.expression, ctx);
  const result = evalBoolean(interpolated);
  logs.push(`Condition "${interpolated}" → ${result}`);

  ctx.globals[`_cond_${step.id}`] = result;

  return Promise.resolve({condition: result});
}

function evalBoolean(expression: string): boolean {
  try {
    const vm = new VM({timeout: 500, allowAsync: false});
    const result = vm.run(`!!(${expression})`);
    return Boolean(result);
  } catch {
    return false;
  }
}
