// Topology polyline legality: every stored link path must consist of
// real dijkstra-predecessor steps — no stepping across cliffs or blocked
// edges. Exercised on proto_01 across the plateau ramp.
import { describe, expect, it } from 'vitest';
import { createTerrainApi } from '../../terrain/sim/index';
import { buildFactionTopo } from './topology';
import type { TopoNode } from './topology';
import { DB } from './test-world';

describe('link polylines on proto_01', () => {
  it('every consecutive cell pair is a legal step (plateau ramp)', () => {
    const map = DB.maps.byId('frontline_td:proto_01');
    if (map === undefined) {
      throw new Error('proto_01 missing from base pack');
    }
    const terrain = createTerrainApi(map.grid, DB.surfaces.list);
    const cls = DB.movementClasses.byId('frontline_td:ground')?.index ?? 0;
    // Node A on the plateau (height 1), node B east of the single-cell
    // ramp at x=25 — the ground path must climb through the ramp.
    const node = (id: number, x: number, y: number): TopoNode => ({
      id,
      x,
      y,
      connect: 1000,
      service: 10,
      vehicles: 4,
      warehouse: id === 1,
      w: 1,
      h: 1,
    });
    const topo = buildFactionTopo([node(1, 10, 52), node(2, 27, 52)], terrain, cls, 10000);
    expect(topo.links.length).toBe(1);
    for (const link of topo.links) {
      expect(link.cells.length).toBeGreaterThan(1);
      for (let i = 0; i + 1 < link.cells.length; i++) {
        const a = link.cells[i] ?? 0;
        const b = link.cells[i + 1] ?? 0;
        const ax = a % terrain.width;
        const ay = (a / terrain.width) | 0;
        const bx = b % terrain.width;
        const by = (b / terrain.width) | 0;
        expect(terrain.stepCost(ax, ay, bx, by, cls)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
