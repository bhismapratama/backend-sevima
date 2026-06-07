import {WorkflowDefinition, WorkflowStep} from '../interfaces';

export interface DagGraph {
  steps: Map<string, WorkflowStep>;
  adjacency: Map<string, Set<string>>;
  inEdges: Map<string, Set<string>>;
}

export function parseDag(definition: WorkflowDefinition): DagGraph {
  const steps = new Map<string, WorkflowStep>();
  const adjacency = new Map<string, Set<string>>();
  const inEdges = new Map<string, Set<string>>();

  for (const step of definition.steps) {
    steps.set(step.id, step);
    adjacency.set(step.id, new Set());
    inEdges.set(step.id, new Set(step.dependsOn ?? []));
  }

  for (const step of definition.steps) {
    for (const depId of step.dependsOn ?? []) {
      adjacency.get(depId)?.add(step.id);
    }
  }

  return {steps, adjacency, inEdges};
}
