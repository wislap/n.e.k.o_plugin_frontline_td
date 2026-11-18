import { describe, expect, test } from 'vitest';
import { extendRoute, linkIndices, linkKey, nearestLink, type RoadLinkInfo } from './road-select';

function linksOf(edges: [number, number][], flows: number[]): RoadLinkInfo[] {
  return edges.map(([a, b], i) => ({ a, b, flow: flows[i] ?? 0 }));
}

describe('extendRoute', () => {
  test('extends a straight chain both ways', () => {
    // 0-1-2-3-4, click link 1 (1-2): picks 0 and 2, then 3.
    const links = linksOf(
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
      ],
      [8, 10, 9, 7],
    );
    expect(extendRoute(links, 1, new Set())).toEqual([0, 1, 2, 3]);
  });

  test('chooses the highest-flow branch', () => {
    // Star at node 1: 0-1 (clicked), 1-2 flow 9, 1-3 flow 5.
    const links = linksOf(
      [
        [0, 1],
        [1, 2],
        [1, 3],
      ],
      [10, 9, 5],
    );
    expect(extendRoute(links, 0, new Set())).toEqual([0, 1]);
  });

  test('stops below 50% of the clicked flow', () => {
    const links = linksOf(
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
      [10, 4, 10],
    );
    // Link 1 flow 4 < 5 => only the clicked link.
    expect(extendRoute(links, 0, new Set())).toEqual([0]);
  });

  test('stops at the warehouse node', () => {
    const links = linksOf(
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
      [10, 10, 10],
    );
    // Node 2 is the warehouse: link 1 is selected (ends there) but 2-3 is not.
    expect(extendRoute(links, 0, new Set([2]))).toEqual([0, 1]);
  });

  test('stops at leaf nodes', () => {
    // Node 3 is a leaf reached via node 2; click 1-2, chain 0-1.
    const links = linksOf(
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [2, 4],
      ],
      [10, 10, 9, 8],
    );
    const sel = extendRoute(links, 1, new Set());
    // From node 2 the higher-flow branch (2-3) wins; 3 is a leaf so it ends.
    expect(sel).toEqual([0, 1, 2]);
  });

  test('ties resolve by link index', () => {
    const links = linksOf(
      [
        [0, 1],
        [1, 2],
        [1, 3],
      ],
      [10, 9, 9],
    );
    expect(extendRoute(links, 0, new Set())).toEqual([0, 1]);
  });

  test('does not extend from a warehouse endpoint', () => {
    // Clicked link ends at the warehouse (node 0): only the other end
    // may grow the route.
    const links = linksOf(
      [
        [0, 1],
        [0, 2],
        [1, 3],
      ],
      [10, 10, 10],
    );
    expect(extendRoute(links, 0, new Set([0]))).toEqual([0, 2]);
  });

  test('does not extend from a leaf endpoint', () => {
    // Clicked link's node-0 end is a leaf: only node 1 extends.
    const links = linksOf(
      [
        [0, 1],
        [1, 2],
      ],
      [10, 10],
    );
    expect(extendRoute(links, 0, new Set())).toEqual([0, 1]);
  });

  test('does not loop around a mesh cycle', () => {
    // Square 0-1-2-3-0, clicked 0-1: BFS picks a spanning path, never
    // revisits a node already on the route, so at most 3 of 4 links.
    const links = linksOf(
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [0, 3],
      ],
      [10, 10, 10, 10],
    );
    const sel = extendRoute(links, 0, new Set());
    expect(sel.length).toBe(3);
    expect(new Set(sel).size).toBe(sel.length);
  });
});

describe('nearestLink', () => {
  const links = {
    a: [0, 1],
    pathOffsets: [0, 2, 4],
    // Link 0 through cells (1,1)-(2,1) of an 8-wide map; link 1 through
    // (1,3)-(2,3).
    pathCells: [9, 10, 25, 26],
  };

  test('picks the link under the cursor', () => {
    expect(nearestLink(links, 8, 2, 1.2)).toBe(0);
    expect(nearestLink(links, 8, 2, 2.9)).toBe(1);
  });

  test('returns -1 outside the threshold', () => {
    expect(nearestLink(links, 8, 2, 6)).toBe(-1);
  });

  test('resolves ties by link index', () => {
    // Two links sharing the same polyline cells: the lower index wins.
    const tied = {
      a: [0, 0],
      pathOffsets: [0, 2, 4],
      pathCells: [9, 10, 9, 10],
    };
    expect(nearestLink(tied, 8, 1.6, 1.5)).toBe(0);
  });
});

// Selection stability: links are remembered by node-handle pair so a
// network rebuild that reorders or drops links cannot corrupt the
// selection.
describe('link keys', () => {
  const net = (a: number[], b: number[], handles: number[]) => ({
    nodes: { handles },
    links: { a, b },
  });

  test('linkKey normalizes the endpoint handles', () => {
    const n = net([0, 1], [1, 0], [10, 20]);
    expect(linkKey(n, 0)).toEqual({ a: 10, b: 20 });
    // Endpoint order in the arrays does not matter.
    expect(linkKey(n, 1)).toEqual({ a: 10, b: 20 });
    expect(linkKey(net([0], [1], [0, 20]), 0)).toBeNull();
  });

  test('linkIndices follows links across a rebuild and drops dead ones', () => {
    // Before: (10-20) at index 0, (20-30) at index 1.
    const before = net([0, 1], [1, 2], [10, 20, 30]);
    const keys = [linkKey(before, 0), linkKey(before, 1)].filter(
      (k): k is NonNullable<typeof k> => k !== null,
    );
    // After: order flipped and a third link added.
    const after = net([1, 0, 2], [2, 1, 0], [10, 20, 30]);
    expect(linkIndices(after, keys)).toEqual([1, 0]);
    // The (10-20) link is gone: only (20-30) resolves.
    const shrunk = net([1], [2], [10, 20, 30]);
    expect(linkIndices(shrunk, keys)).toEqual([0]);
  });
});
