import { parseDag } from '../dag-parser';
import { WorkflowDefinition } from '../../interfaces';

const makeDefinition = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  steps: [
    { id: 'a', name: 'A', type: 'DELAY', config: { delayMs: 0 }, dependsOn: [] },
    { id: 'b', name: 'B', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['a'] },
    { id: 'c', name: 'C', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['a'] },
    { id: 'd', name: 'D', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['b', 'c'] },
  ],
  ...overrides,
});

describe('parseDag', () => {
  it('builds steps map with all step IDs', () => {
    const graph = parseDag(makeDefinition());
    expect([...graph.steps.keys()]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('builds correct forward adjacency (a → b, a → c)', () => {
    const graph = parseDag(makeDefinition());
    expect([...graph.adjacency.get('a')!]).toEqual(expect.arrayContaining(['b', 'c']));
    expect([...graph.adjacency.get('b')!]).toEqual(['d']);
    expect([...graph.adjacency.get('d')!]).toHaveLength(0);
  });

  it('records in-edges correctly for d (b and c)', () => {
    const graph = parseDag(makeDefinition());
    expect([...graph.inEdges.get('d')!]).toEqual(expect.arrayContaining(['b', 'c']));
    expect([...graph.inEdges.get('a')!]).toHaveLength(0);
  });

  it('handles a single-step workflow', () => {
    const def: WorkflowDefinition = {
      steps: [{ id: 'solo', name: 'Solo', type: 'DELAY', config: { delayMs: 0 }, dependsOn: [] }],
    };
    const graph = parseDag(def);
    expect(graph.steps.size).toBe(1);
    expect([...graph.adjacency.get('solo')!]).toHaveLength(0);
  });
});
