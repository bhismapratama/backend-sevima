import { WorkflowExecutor } from '../workflow-executor';
import { WorkflowDefinition } from '../../interfaces';

const makeCtx = () => ({
  executionId: 'exec-test-1',
  tenantId: 'tenant-1',
  workflowId: 'wf-1',
  globals: {},
});

describe('WorkflowExecutor', () => {
  it('executes a single DELAY step successfully', async () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'wait', name: 'Wait', type: 'DELAY', config: { delayMs: 10 }, dependsOn: [] },
      ],
    };
    const executor = new WorkflowExecutor();
    const result = await executor.execute(def, makeCtx());

    expect(result.status).toBe('success');
    expect(result.steps.get('wait')?.status).toBe('success');
  });

  it('runs independent steps in parallel (both complete)', async () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'a', name: 'A', type: 'DELAY', config: { delayMs: 10 }, dependsOn: [] },
        { id: 'b', name: 'B', type: 'DELAY', config: { delayMs: 10 }, dependsOn: [] },
      ],
    };
    const executor = new WorkflowExecutor();
    const result = await executor.execute(def, makeCtx());

    expect(result.status).toBe('success');
    expect(result.steps.get('a')?.status).toBe('success');
    expect(result.steps.get('b')?.status).toBe('success');
  });

  it('executes SCRIPT step and passes output', async () => {
    const def: WorkflowDefinition = {
      steps: [
        {
          id: 'calc',
          name: 'Calc',
          type: 'SCRIPT',
          config: { script: 'return { value: 1 + 2 };' },
          dependsOn: [],
        },
      ],
    };
    const executor = new WorkflowExecutor();
    const result = await executor.execute(def, makeCtx());

    expect(result.status).toBe('success');
    expect((result.steps.get('calc')?.output as any)?.value).toBe(3);
  });

  it('skips a step whose runIf evaluates to false', async () => {
    const def: WorkflowDefinition = {
      steps: [
        {
          id: 'skipped',
          name: 'Should Skip',
          type: 'DELAY',
          config: { delayMs: 0 },
          dependsOn: [],
          runIf: 'false',
        },
      ],
    };
    const executor = new WorkflowExecutor();
    const result = await executor.execute(def, makeCtx());

    expect(result.steps.get('skipped')?.status).toBe('skipped');
  });

  it('rejects an invalid DAG (no steps)', async () => {
    const def: WorkflowDefinition = { steps: [] };
    const executor = new WorkflowExecutor();
    await expect(executor.execute(def, makeCtx())).rejects.toThrow(/Invalid workflow/);
  });

  it('times out a workflow that exceeds timeoutMs', async () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'slow', name: 'Slow', type: 'DELAY', config: { delayMs: 500 }, dependsOn: [] },
      ],
      timeoutMs: 50,
    };
    const executor = new WorkflowExecutor();
    const result = await executor.execute(def, makeCtx());
    expect(result.status).toBe('timeout');
  });

  it('emits step.started and step.completed events', async () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'x', name: 'X', type: 'DELAY', config: { delayMs: 0 }, dependsOn: [] },
      ],
    };
    const executor = new WorkflowExecutor();
    const events: string[] = [];
    executor.on('step.started', () => events.push('started'));
    executor.on('step.completed', () => events.push('completed'));

    await executor.execute(def, makeCtx());
    expect(events).toEqual(['started', 'completed']);
  });
});
