import { parseDag } from '../dag-parser';
import { topologicalSort } from '../topological-sorter';
import { WorkflowDefinition } from '../../interfaces';

describe('topologicalSort', () => {
  it('returns single layer for independent steps', () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'a', name: 'A', type: 'DELAY', config: { delayMs: 0 }, dependsOn: [] },
        { id: 'b', name: 'B', type: 'DELAY', config: { delayMs: 0 }, dependsOn: [] },
      ],
    };
    const layers = topologicalSort(parseDag(def));
    expect(layers).toHaveLength(1);
    expect(layers[0]).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('produces correct layers for diamond graph (A → B,C → D)', () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'a', name: 'A', type: 'DELAY', config: { delayMs: 0 }, dependsOn: [] },
        { id: 'b', name: 'B', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['a'] },
        { id: 'c', name: 'C', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['a'] },
        { id: 'd', name: 'D', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['b', 'c'] },
      ],
    };
    const layers = topologicalSort(parseDag(def));
    expect(layers).toHaveLength(3);
    expect(layers[0]).toEqual(['a']);
    expect(layers[1]).toEqual(expect.arrayContaining(['b', 'c']));
    expect(layers[2]).toEqual(['d']);
  });

  it('handles linear chain (a → b → c)', () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'a', name: 'A', type: 'DELAY', config: { delayMs: 0 }, dependsOn: [] },
        { id: 'b', name: 'B', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['a'] },
        { id: 'c', name: 'C', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['b'] },
      ],
    };
    const layers = topologicalSort(parseDag(def));
    expect(layers).toEqual([['a'], ['b'], ['c']]);
  });

  it('throws on cyclic graph', () => {
    const def: WorkflowDefinition = {
      steps: [
        { id: 'a', name: 'A', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['b'] },
        { id: 'b', name: 'B', type: 'DELAY', config: { delayMs: 0 }, dependsOn: ['a'] },
      ],
    };
    expect(() => topologicalSort(parseDag(def))).toThrow(/[Cc]ycle/);
  });
});
