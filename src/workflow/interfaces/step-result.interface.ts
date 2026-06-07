export type StepStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'timeout';

export interface StepResult {
  stepId: string;
  stepName: string;
  status: StepStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  attempt: number;
  output?: unknown;
  error?: string;
  logs: string[];
}
