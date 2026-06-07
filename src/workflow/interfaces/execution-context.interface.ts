import {WorkflowDefinition} from './workflow-definition.interface';
import {StepResult} from './step-result.interface';

export interface ExecutionContext {
  executionId: string;
  tenantId: string;
  userId?: string;
  workflowId: string;
  steps: Map<string, StepResult>;
  globals: Record<string, unknown>;
  workflow: WorkflowDefinition;
  startTime: Date;
  timeoutMs: number;
}
