import {DagGraph} from './dag-parser';

export function topologicalSort(graph: DagGraph): string[][] {
  const inDegree = new Map<string, number>();
  for (const [id, parents] of graph.inEdges) {
    inDegree.set(id, parents.size);
  }

  const layers: string[][] = [];
  let currentLayer = [...inDegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id);

  const visited = new Set<string>();

  while (currentLayer.length > 0) {
    layers.push(currentLayer);

    const nextLayer: string[] = [];
    for (const id of currentLayer) {
      visited.add(id);
      for (const child of graph.adjacency.get(id) ?? []) {
        const newDeg = (inDegree.get(child) ?? 0) - 1;
        inDegree.set(child, newDeg);
        if (newDeg === 0) nextLayer.push(child);
      }
    }

    currentLayer = nextLayer;
  }

  if (visited.size !== graph.steps.size) {
    const unvisited = [...graph.steps.keys()].filter((id) => !visited.has(id));
    throw new Error(`Siklus terdeteksi melibatkan langkah: ${unvisited.join(', ')}`);
  }

  return layers;
}
