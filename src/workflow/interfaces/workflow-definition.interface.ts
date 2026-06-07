export type StepType = 'HTTP_CALL' | 'SCRIPT' | 'DELAY' | 'CONDITION';

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs?: number;
}

export interface HttpCallConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ScriptConfig {
  script: string;
}

export interface DelayConfig {
  delayMs: number;
}

export interface ConditionConfig {
  expression: string;
}

export type StepConfig =
  | HttpCallConfig
  | ScriptConfig
  | DelayConfig
  | ConditionConfig;

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  config: StepConfig;
  dependsOn: string[];
  retryConfig?: RetryConfig;
  timeoutMs?: number;
  runIf?: string;
}

export interface WorkflowDefinition {
  steps: WorkflowStep[];
  timeoutMs?: number;
}
