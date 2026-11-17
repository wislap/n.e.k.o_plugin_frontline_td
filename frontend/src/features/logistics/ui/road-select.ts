// Road-tool helpers (M3 E3): the click-one-click-two route selection and
// cursor hover picking over the logistics network channel. Links are
// indexed into the channel's links arrays; a/b are node indices into the
// nodes arrays. Pure so the extension rules are unit-testable.

export interface RoadLinkInfo {
  a: number;
  b: number;
  // Smoothed carried flow (volOut + volIn), whatever unit the caller
  // smooths in — only relative comparisons are used.
  flow: number;
}

// Extends a clicked link into a route: from each endpoint greedily pick
// the incident unselected link with the highest flow (ties by link
// index), continuing while the candidate flow is >= half the clicked
// link's flow and the far node is neither a warehouse nor a leaf.
export function extendRoute(
  links: readonly RoadLinkInfo[],
  clicked: number,
  warehouseNodes: ReadonlySet<number>,
): number[] {
  const sel = new Set<number>([clicked]);
  const base = links[clicked];
  if (base === undefined) {
    return [];
  }
  const degree = new Map<number, number>();
  const incident = new Map<number, number[]>();
  links.forEach((link, i) => {
    for (const n of [link.a, link.b]) {
      degree.set(n, (degree.get(n) ?? 0) + 1);
      const list = incident.get(n);
      if (list === undefined) {
        incident.set(n, [i]);
      } else {
        list.push(i);
      }
    }
  });
  const threshold = base.flow / 2;
  // Never extend from an endpoint that is a warehouse or a leaf; nodes on
  // the route are tracked so the greedy walk cannot loop around a mesh
  // cycle.
  const visited = new Set<number>([base.a, base.b]);
  const frontier: number[] = [];
  for (const n of [base.a, base.b]) {
    if (!warehouseNodes.has(n) && (degree.get(n) ?? 0) > 1) {
      frontier.push(n);
    }
  }
  while (frontier.length > 0) {
    const node = frontier.shift() ?? 0;
    let best = -1;
    let bestFlow = -Infinity;
    for (const i of incident.get(node) ?? []) {
      const flow = links[i]?.flow ?? -Infinity;
      const far = links[i] === undefined ? -1 : links[i].a === node ? links[i].b : links[i].a;
      if (!sel.has(i) && !visited.has(far) && flow > bestFlow) {
        best = i;
        bestFlow = flow;
      }
    }
    const chosen = best === -1 ? undefined : links[best];
    if (chosen === undefined || chosen.flow < threshold) {
      continue;
    }
    sel.add(best);
    const next = chosen.a === node ? chosen.b : chosen.a;
    visited.add(next);
    if (!warehouseNodes.has(next) && (degree.get(next) ?? 0) > 1) {
      frontier.push(next);
    }
  }
  return [...sel].sort((x, y) => x - y);
}

// Squared distance from (x, y) to the segment (ax, ay)-(bx, by).
function segDist2(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  const px = ax + t * dx - x;
  const py = ay + t * dy - y;
  return px * px + py * py;
}

// Distance from (x, y) to a polyline of cell indices (cell centres).
function polylineDist2(
  x: number,
  y: number,
  cells: ArrayLike<number>,
  from: number,
  to: number,
  width: number,
): number {
  let best = Infinity;
  let px = -1;
  let py = -1;
  for (let i = from; i < to; i++) {
    const cell = cells[i] ?? 0;
    const cx = (cell % width) + 0.5;
    const cy = Math.floor(cell / width) + 0.5;
    if (px >= 0) {
      best = Math.min(best, segDist2(x, y, px, py, cx, cy));
    }
    px = cx;
    py = cy;
    if (best === Infinity) {
      best = segDist2(x, y, cx, cy, cx, cy);
    }
  }
  return best;
}

// Nearest link whose polyline is within maxDist cells of (x, y);
// ties resolve by link index. Returns -1 when nothing is near.
export function nearestLink(
  links: {
    pathOffsets: ArrayLike<number>;
    pathCells: ArrayLike<number>;
    a: ArrayLike<number>;
  },
  width: number,
  x: number,
  y: number,
  maxDist = 0.75,
): number {
  let best = -1;
  let bestDist2 = maxDist * maxDist;
  for (let i = 0; i < links.a.length; i++) {
    const d = polylineDist2(
      x,
      y,
      links.pathCells,
      links.pathOffsets[i] ?? 0,
      links.pathOffsets[i + 1] ?? 0,
      width,
    );
    if (d < bestDist2) {
      bestDist2 = d;
      best = i;
    }
  }
  return best;
}

// Converts selected link indices to the node-handle pairs the
// upgrade_links command expects (dropping dangling indices).
export function linkPairs(
  network: {
    nodes: { handles: ArrayLike<number> };
    links: { a: ArrayLike<number>; b: ArrayLike<number> };
  },
  selected: readonly number[],
): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  for (const i of selected) {
    const a = network.nodes.handles[network.links.a[i] ?? 0] ?? 0;
    const b = network.nodes.handles[network.links.b[i] ?? 0] ?? 0;
    if (a !== 0 && b !== 0) {
      out.push({ a, b });
    }
  }
  return out;
}
