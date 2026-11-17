// Blueprint chain: three station blueprints in a line, each beyond the
// previous node's reach, activated at once — they must start one after
// another as each predecessor completes, fed by logistics deliveries.
import { describe, expect, it } from 'vitest';
import { LogisticsNetworkChannel } from '../../logistics/protocol';
import type { LogisticsNetwork } from '../../logistics/protocol';
import { ActivateCommand, PlaceCommand } from '../protocol';
import { BASE, CYCLE, F1, MATERIAL, STATION, makeWorld, run } from './test-world';

const W = 60;
const H = 30;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));

function baseStart() {
  return {
    faction: F1,
    units: [],
    stock: new Map([[MATERIAL, 200]]),
    structures: [{ kind: BASE.index, x: 2, y: 2 }],
  };
}

describe('auto-activation chain', () => {
  it('stations roll out one after another as predecessors complete', () => {
    const w = makeWorld({ rows: FLAT, starts: [baseStart()] });
    // Base ring ends near x=6; each station's ring is ~13 cells from its
    // predecessor's ring but >20 cells (200 cost) from all earlier nodes.
    const spots = [20, 36, 52];
    for (const x of spots) {
      w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x, y: 10, blueprint: true });
    }
    run(w, 2); // deferred blueprint spawns visible from the next tick
    expect(w.rejections()).toEqual([]);
    const bps = [...w.structures().handles.slice(1)].map(Number);
    expect(bps.length).toBe(3);
    // All beyond reach except the first: activating all at once leaves
    // the last two waiting until their predecessors complete.
    w.issue(ActivateCommand.type, { blueprints: bps });
    run(w, 2);
    expect(w.rejections()).toEqual([]);

    const seen: { stations: number; ops: number }[] = [];
    let completed = 0;
    // Generous bound: deliveries are a few cycles each and progress is
    // 120 ticks per station; three stations < 40 cycles.
    for (let cycle = 0; cycle < 40 && completed < 3; cycle++) {
      run(w, CYCLE);
      const ch = w.structures();
      let stations = 0;
      let ops = 0;
      for (let i = 0; i < ch.handles.length; i++) {
        if (ch.kind[i] === STATION.index) {
          stations++;
          if (ch.state[i] === 3) {
            ops++;
          }
        }
      }
      seen.push({ stations, ops });
      completed = ops;
    }
    expect(completed).toBe(3);
    expect(STATION.build?.timeTicks).toBe(120);
    // Sequential rollout: station entity count is monotonic, and a new
    // site only ever appeared while a predecessor was already
    // operational (the first excepted).
    for (let i = 1; i < seen.length; i++) {
      const prev = seen[i - 1] ?? { stations: 0, ops: 0 };
      const cur = seen[i] ?? prev;
      expect(cur.stations).toBeGreaterThanOrEqual(prev.stations);
      if (cur.stations > prev.stations && prev.stations > 0) {
        expect(prev.ops).toBeGreaterThanOrEqual(prev.stations);
      }
    }
    // Materials actually shipped: 200 units became <= 140.
    const net = w.sim.snapshot(F1).channels[LogisticsNetworkChannel.id] as LogisticsNetwork;
    expect(net.stock[MATERIAL]).toBeLessThanOrEqual(200000 - 3 * 20000);
  });
});
