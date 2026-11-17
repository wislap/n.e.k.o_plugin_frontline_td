// Selective topology dirtying (ADR 0030): blocking a cell only removes
// edges, so a faction's topology is invariant unless a newly blocked cell
// lies in its sensitive set (link polylines + node rings). This file
// property-tests that rule by comparing an incrementally maintained
// topology (rebuilt only when the rule fires) with a forced full rebuild
// after every block/unblock event, on proto_01 and a synthetic map.
import { describe, expect, it } from 'vitest';
import type { ResolvedSurface } from '../../../content/index';
import { contentId } from '../../../core/index';
import type { TerrainGrid } from '../../terrain/content';
import { createTerrainApi } from '../../terrain/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { ringCells } from './ring-search';
import { buildFactionTopo } from './topology';
import type { FactionTopo, TopoNode } from './topology';
import { CYCLE, DB, makeWorld, nodeParts, run } from './test-world';

const CLS = DB.movementClasses.byId('frontline_td:ground')?.index ?? 0;
// Same minimal surface pair as test-world: index 0 ground (cost 10),
// index 1 impassable.
const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
];
const EMPTY_ROADS = (terrain: TerrainApi): Uint8Array =>
  new Uint8Array(terrain.width * terrain.height);

function expectTopoEqual(a: FactionTopo, b: FactionTopo): void {
  const links = (t: FactionTopo): unknown[] =>
    t.links.map((l) => ({ a: l.a, b: l.b, cost: l.cost, m: l.m, cells: l.cells, steps: l.steps }));
  expect(links(a)).toEqual(links(b));
  expect([...a.covered]).toEqual([...b.covered]);
  expect([...a.attach]).toEqual([...b.attach]);
  expect([...a.attachCost]).toEqual([...b.attachCost]);
}

function rebuild(nodes: TopoNode[], terrain: TerrainApi): FactionTopo {
  return buildFactionTopo(nodes, terrain, CLS, EMPTY_ROADS(terrain), [10000], 0);
}

// The module's rule: unblocking dirties every faction; blocking dirties
// only factions whose sensitive set intersects the changed cells.
function dirtyByRule(topo: FactionTopo, cells: readonly number[], blocked: boolean): boolean {
  if (!blocked) {
    return true;
  }
  return cells.some((c) => (topo.sensitive[c] ?? 0) !== 0);
}

// A deterministic event script: each entry resolves a cell set against
// the CURRENT maintained topology, applies setBlocked, then compares the
// maintained topo with a forced rebuild.
type Pick = 'link' | 'ring' | 'clear';

function pickCells(topo: FactionTopo, terrain: TerrainApi, kind: Pick): { x: number; y: number }[] {
  if (kind === 'link') {
    const link = topo.links[0];
    if (link === undefined || link.cells.length === 0) {
      return [];
    }
    const cell = link.cells[(link.cells.length / 2) | 0] ?? 0;
    return [{ x: cell % terrain.width, y: (cell / terrain.width) | 0 }];
  }
  if (kind === 'ring') {
    const onLink = new Set<number>();
    for (const link of topo.links) {
      for (const c of link.cells) {
        onLink.add(c);
      }
    }
    for (const node of topo.nodes) {
      for (const c of ringCells(node, terrain, CLS)) {
        if (!onLink.has(c)) {
          return [{ x: c % terrain.width, y: (c / terrain.width) | 0 }];
        }
      }
    }
    return [];
  }
  // 'clear': first passable cell outside the sensitive set.
  for (let c = 0; c < topo.sensitive.length; c++) {
    if (
      (topo.sensitive[c] ?? 0) === 0 &&
      terrain.passable(c % terrain.width, (c / terrain.width) | 0, CLS)
    ) {
      return [{ x: c % terrain.width, y: (c / terrain.width) | 0 }];
    }
  }
  return [];
}

function runScript(nodes: TopoNode[], terrain: TerrainApi, picks: Pick[]): void {
  let maintained = rebuild(nodes, terrain);
  const blockedCells = new Map<number, { x: number; y: number }>();
  let round = 0;
  for (const pick of picks) {
    round += 1;
    let cells: { x: number; y: number }[];
    let blocked: boolean;
    if (round % 4 === 0 && blockedCells.size > 0) {
      // Every fourth event unblocks the oldest blocked cell.
      const [index, cell] = [...blockedCells.entries()][0] as [number, { x: number; y: number }];
      blockedCells.delete(index);
      cells = [cell];
      blocked = false;
    } else {
      cells = pickCells(maintained, terrain, pick);
      blocked = true;
      for (const c of cells) {
        blockedCells.set(c.y * terrain.width + c.x, c);
      }
    }
    terrain.setBlocked(cells, blocked);
    const indices = cells.map((c) => c.y * terrain.width + c.x);
    if (dirtyByRule(maintained, indices, blocked)) {
      maintained = rebuild(nodes, terrain);
    }
    expectTopoEqual(maintained, rebuild(nodes, terrain));
  }
}

describe('selective topology dirtying on blockers', () => {
  it('synthetic map: skipped rebuilds equal forced rebuilds', () => {
    const rows = [
      '..............................',
      '..............................',
      '..............................',
      '...............#..............',
      '...............#..............',
      '...............#..............',
      '...............#..............',
      '...............#..............',
      '...............#..............',
      '...............#..............',
      '...............#..............',
      '...............#..............',
      '...............#..............',
      '...............#..............',
      '...............#..............',
      '..............................',
    ];
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    const grid: TerrainGrid = {
      width,
      height,
      heights: new Uint8Array(width * height),
      surfaces: new Uint16Array(width * height),
      ramps: new Uint8Array(width * height),
    };
    rows.forEach((row, y) => {
      for (let x = 0; x < width; x++) {
        if (row[x] === '#') {
          grid.surfaces[y * width + x] = 1;
        }
      }
    });
    const terrain = createTerrainApi(grid, SURFACES);
    const node = (id: number, x: number, y: number): TopoNode => ({
      id,
      x,
      y,
      connect: 1000,
      service: 6,
      vehicles: 2,
      warehouse: id === 1,
      w: 1,
      h: 1,
    });
    const nodes = [node(1, 3, 4), node(2, 24, 4), node(3, 3, 12), node(4, 24, 12)];
    const topo = rebuild(nodes, terrain);
    expect(topo.links.length).toBeGreaterThan(0);
    runScript(nodes, terrain, ['link', 'clear', 'ring', 'link', 'clear', 'clear', 'link', 'clear']);
  });

  it('proto_01: skipped rebuilds equal forced rebuilds', () => {
    const map = DB.maps.byId('frontline_td:proto_01');
    if (map === undefined) {
      throw new Error('proto_01 missing from base pack');
    }
    const terrain = createTerrainApi(map.grid, DB.surfaces.list);
    const node = (id: number, x: number, y: number): TopoNode => ({
      id,
      x,
      y,
      connect: 2000,
      service: 10,
      vehicles: 4,
      warehouse: id === 1,
      w: 1,
      h: 1,
    });
    // Spread nodes across the map on passable ground (deterministic
    // scan order), so links and rings cover a wide area.
    const spots: [number, number][] = [];
    for (let y = 2; y < terrain.height - 2 && spots.length < 6; y += 2) {
      for (let x = 2; x < terrain.width - 2 && spots.length < 6; x += 2) {
        if (!terrain.passable(x, y, CLS)) {
          continue;
        }
        if (spots.every(([sx, sy]) => Math.max(Math.abs(sx - x), Math.abs(sy - y)) >= 15)) {
          spots.push([x, y]);
        }
      }
    }
    expect(spots.length).toBeGreaterThanOrEqual(3);
    const nodes = spots.map(([x, y], i) => node(i + 1, x, y));
    runScript(nodes, terrain, ['link', 'clear', 'ring', 'link', 'clear', 'clear', 'link', 'clear']);
  });

  it('module wiring: on-path block rebuilds, remote block is skipped', () => {
    const rows = Array.from({ length: 12 }, () => '.'.repeat(24));
    const world = makeWorld({
      rows,
      entities: [
        { parts: nodeParts(2, 5, { connect: 500, service: 4, vehicles: 1, warehouse: true }) },
        { parts: nodeParts(18, 5, { connect: 500, service: 4, vehicles: 1 }) },
      ],
    });
    run(world.sim, CYCLE);
    const linkShape = (): unknown => {
      const links = world.network(1).links;
      return {
        a: [...links.a],
        b: [...links.b],
        m: [...links.m],
        pathCells: [...links.pathCells],
      };
    };
    const initial = linkShape();
    expect((initial as { a: number[] }).a.length).toBe(1);

    // Blocking a polyline cell reroutes the link: the rebuild must run.
    const mid = (initial as { pathCells: number[] }).pathCells[8] ?? 0;
    world.terrain.setBlocked([{ x: mid % 24, y: (mid / 24) | 0 }], true);
    run(world.sim, CYCLE);
    expect(linkShape()).not.toEqual(initial);

    // Unblocking restores the original path: the rebuild must run again.
    world.terrain.setBlocked([{ x: mid % 24, y: (mid / 24) | 0 }], false);
    run(world.sim, CYCLE);
    expect(linkShape()).toEqual(initial);

    // Blocking a cell outside every ring and polyline changes nothing.
    world.terrain.setBlocked([{ x: 10, y: 1 }], true);
    run(world.sim, CYCLE);
    expect(linkShape()).toEqual(initial);
  });
});
