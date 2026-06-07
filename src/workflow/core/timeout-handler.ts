export class WorkflowTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowTimeoutError';
  }
}

export class StepTimeoutError extends Error {
  constructor(stepId: string, timeoutMs: number) {
    super(`Langkah "${stepId}" batas waktu terlampaui setelah ${timeoutMs}ms`);
    this.name = 'StepTimeoutError';
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  error: Error,
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(error), timeoutMs),
  );
  return Promise.race([promise, timeout]);
}

export function withStepTimeout<T>(
  stepId: string,
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return withTimeout(
    promise,
    timeoutMs,
    new StepTimeoutError(stepId, timeoutMs),
  );
}

export function withWorkflowTimeout<T>(
  executionId: string,
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return withTimeout(
    promise,
    timeoutMs,
    new WorkflowTimeoutError(
      `Eksekusi workflow "${executionId}" batas waktu terlampaui setelah ${timeoutMs}ms`,
    ),
  );
}
