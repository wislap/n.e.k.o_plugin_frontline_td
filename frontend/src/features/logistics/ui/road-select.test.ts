import { describe, expect, test } from 'vitest';
import { extendRoute, nearestLink, type RoadLinkInfo } from './road-select';

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
