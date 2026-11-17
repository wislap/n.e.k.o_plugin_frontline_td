// Sites block terrain immediately: a placed site reroutes a moving
// unit's flow field, and the unit never enters a footprint cell.
import { describe, expect, it } from 'vitest';
import { toTick } from '../../../core/index';
import { MoveCommand } from '../../movement/protocol';
import { PlaceCommand } from '../protocol';
import { BASE, F1, MATERIAL, moverInit, makeWorld, run } from './test-world';

// Corridor: rock rows at y=0 and y=9, open between. A site across the
// middle lane forces the flow field around it.
const ROWS = [
  '########################################',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '########################################',
];

describe('sites block terrain and reroute flow fields', () => {
  it('a placed site reroutes a moving unit around its footprint', () => {
    const w = makeWorld({
      rows: ROWS,
      entities: [{ parts: moverInit(8, 5) }],
      starts: [
        {
          faction: F1,
          units: [],
          stock: new Map([[MATERIAL, 200]]),
          structures: [{ kind: BASE.index, x: 1, y: 1 }],
        },
      ],
    });
    const mover = w.handles[0];
    if (mover === undefined) {
      throw new Error('mover missing');
    }
    w.sim.submit({
      tick: toTick(w.sim.tick + 1),
      issuer: F1,
      type: MoveCommand.type,
      payload: { units: [mover], x: 36, y: 5 },
    });
    run(w, 5);
    // While the unit is still west of x=18, drop a site on its lane.
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 18, y: 4, blueprint: false });
    run(w, 2); // the place command lands two steps after submit
    expect(w.rejections()).toEqual([]);
    // The footprint is blocked for every movement class immediately.
    expect(w.terrain.blocked(18, 4)).toBe(true);
    expect(w.terrain.passable(19, 5, 0)).toBe(false);
    // It routed around (through y<=3 or y>=6) rather than stopping.
    let crossed = false;
    for (let t = 0; t < 800 && !crossed; t++) {
      w.sim.step();
      const p = w.pos(0);
      const cx = Math.floor(p.x);
      const cy = Math.floor(p.y);
      // It must never stand on a blocked cell.
      expect(w.terrain.blocked(cx, cy)).toBe(false);
      if (p.x > 20) {
        crossed = true;
      }
    }
    expect(crossed).toBe(true);
  });
});
