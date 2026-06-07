import {WorkflowDefinition} from '../interfaces';
import {DagGraph} from './dag-parser';

const VALID_STEP_TYPES = new Set(['HTTP_CALL', 'SCRIPT', 'DELAY', 'CONDITION']);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateDag(
  definition: WorkflowDefinition,
  graph: DagGraph,
): ValidationResult {
  const errors: string[] = [];

  if (!definition.steps || definition.steps.length === 0) {
    errors.push('Workflow must have at least one step');
    return {valid: false, errors};
  }

  for (const step of definition.steps) {
    if (!step.id || step.id.trim() === '') {
      errors.push(`Step is missing an id`);
    }
    if (!step.name || step.name.trim() === '') {
      errors.push(`Step "${step.id}" is missing a name`);
    }
    if (!VALID_STEP_TYPES.has(step.type)) {
      errors.push(`Step "${step.id}" has invalid type "${step.type}"`);
    }
    if (!step.config) {
      errors.push(`Step "${step.id}" is missing config`);
    }
    validateStepConfig(step.id, step.type, step.config, errors);
  }

  for (const step of definition.steps) {
    for (const depId of step.dependsOn) {
      if (!graph.steps.has(depId)) {
        errors.push(`Step "${step.id}" depends on unknown step "${depId}"`);
      }
    }
  }

  const seen = new Set<string>();
  for (const step of definition.steps) {
    if (seen.has(step.id)) {
      errors.push(`Duplicate step id "${step.id}"`);
    }
    seen.add(step.id);
  }

  const cycles = detectCycles(graph);
  if (cycles.length > 0) {
    errors.push(`Workflow contains cycles: ${cycles.join(', ')}`);
  }

  return {valid: errors.length === 0, errors};
}

function validateStepConfig(
  stepId: string,
  type: string,
  config: unknown,
  errors: string[],
): void {
  if (!config || typeof config !== 'object') return;

  const c = config as Record<string, unknown>;

  if (type === 'HTTP_CALL') {
    if (!c.url) errors.push(`Step "${stepId}" (HTTP_CALL) missing "url"`);
    if (!c.method) errors.push(`Step "${stepId}" (HTTP_CALL) missing "method"`);
  }
  if (type === 'SCRIPT') {
    if (!c.script) errors.push(`Step "${stepId}" (SCRIPT) missing "script"`);
  }
  if (type === 'DELAY') {
    if (typeof c.delayMs !== 'number' || c.delayMs < 0) {
      errors.push(
        `Step "${stepId}" (DELAY) "delayMs" must be a non-negative number`,
      );
    }
  }
  if (type === 'CONDITION') {
    if (!c.expression)
      errors.push(`Step "${stepId}" (CONDITION) missing "expression"`);
  }
}

function detectCycles(graph: DagGraph): string[] {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const cycleNodes: string[] = [];

  for (const id of graph.steps.keys()) color.set(id, WHITE);

  function dfs(id: string): boolean {
    color.set(id, GRAY);
    for (const neighbor of graph.adjacency.get(id) ?? []) {
      if (color.get(neighbor) === GRAY) {
        cycleNodes.push(`${id} → ${neighbor}`);
        return true;
      }
      if (color.get(neighbor) === WHITE && dfs(neighbor)) return true;
    }
    color.set(id, BLACK);
    return false;
  }

  for (const id of graph.steps.keys()) {
    if (color.get(id) === WHITE) dfs(id);
  }

  return cycleNodes;
}
