import { parseDag } from '../dag-parser';
import { validateDag } from '../dag-validator';
import { WorkflowDefinition } from '../../interfaces';

describe('validateDag', () => {
  it('passes a valid linear DAG', () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'a', name: 'A', type: 'DELAY', config: { delayMs: 0 }, dependsOn: [] },
        { id: 'b', name: 'B', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['a'] },
      ],
    };
    const { valid, errors } = validateDag(def, parseDag(def));
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('rejects a workflow with no steps', () => {
    const def: WorkflowDefinition = { steps: [] };
    const { valid, errors } = validateDag(def, parseDag(def));
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/at least one step/);
  });

  it('detects an unknown dependsOn reference', () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'a', name: 'A', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['nonexistent'] },
      ],
    };
    const { valid, errors } = validateDag(def, parseDag(def));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('nonexistent'))).toBe(true);
  });

  it('detects duplicate step IDs', () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'a', name: 'A', type: 'DELAY', config: { delayMs: 0 }, dependsOn: [] },
        { id: 'a', name: 'A2', type: 'DELAY', config: { delayMs: 0 }, dependsOn: [] },
      ],
    };
    const { valid, errors } = validateDag(def, parseDag(def));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('detects a direct cycle (a → b → a)', () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'a', name: 'A', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['b'] },
        { id: 'b', name: 'B', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['a'] },
      ],
    };
    const { valid, errors } = validateDag(def, parseDag(def));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('cycle'))).toBe(true);
  });

  it('validates HTTP_CALL config requires url and method', () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'h', name: 'HTTP', type: 'HTTP_CALL', config: {} as any, dependsOn: [] },
      ],
    };
    const { valid, errors } = validateDag(def, parseDag(def));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('url'))).toBe(true);
    expect(errors.some((e) => e.includes('method'))).toBe(true);
  });
});
