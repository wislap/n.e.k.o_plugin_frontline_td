// Deterministic Dijkstra: binary min-heap keyed by (cost, node index) so
// ties always pop the smaller index — identical inputs give identical
// results. Integer costs only.

export const UNREACHABLE = 1 << 30;

// neighbors(node, visit) must call visit(to, cost) for every outgoing edge.
export function dijkstra(
  nodeCount: number,
  seeds: readonly [number, number][],
  neighbors: (node: number, visit: (to: number, cost: number) => void) => void,
): Int32Array {
  const dist = new Int32Array(nodeCount).fill(UNREACHABLE);
  // Flat parallel arrays: heapCost[i], heapNode[i].
  const heapCost: number[] = [];
  const heapNode: number[] = [];

  function less(a: number, b: number): boolean {
    return heapCost[a] !== heapCost[b]
      ? (heapCost[a] ?? 0) < (heapCost[b] ?? 0)
      : (heapNode[a] ?? 0) < (heapNode[b] ?? 0);
  }
  function swap(a: number, b: number): void {
    const c = heapCost[a] ?? 0;
    const n = heapNode[a] ?? 0;
    heapCost[a] = heapCost[b] ?? 0;
    heapNode[a] = heapNode[b] ?? 0;
    heapCost[b] = c;
    heapNode[b] = n;
  }
  function push(cost: number, node: number): void {
    heapCost.push(cost);
    heapNode.push(node);
    let i = heapCost.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(i, parent)) {
        break;
      }
      swap(i, parent);
      i = parent;
    }
  }
  function pop(): void {
    const last = heapCost.length - 1;
    heapCost[0] = heapCost[last] ?? 0;
    heapNode[0] = heapNode[last] ?? 0;
    heapCost.pop();
    heapNode.pop();
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      if (l < heapCost.length && less(l, smallest)) {
        smallest = l;
      }
      if (r < heapCost.length && less(r, smallest)) {
        smallest = r;
      }
      if (smallest === i) {
        break;
      }
      swap(i, smallest);
      i = smallest;
    }
  }

  for (const [node, cost] of seeds) {
    if (cost < (dist[node] ?? UNREACHABLE)) {
      dist[node] = cost;
      push(cost, node);
    }
  }
  while (heapCost.length > 0) {
    const cost = heapCost[0] ?? 0;
    const node = heapNode[0] ?? 0;
    pop();
    if (cost !== dist[node]) {
      continue; // stale entry
    }
    neighbors(node, (to, edgeCost) => {
      const next = cost + edgeCost;
      if (next < (dist[to] ?? UNREACHABLE)) {
        dist[to] = next;
        push(next, to);
      }
    });
  }
  return dist;
}
