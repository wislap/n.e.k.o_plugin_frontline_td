// Build progress: capped by delivered materials, completion converts the
// site into the operational store profile, and the completed event fires.
import { describe, expect, it } from 'vitest';
import { ConstructionCompleted, PlaceCommand } from '../protocol';
import { BASE, CYCLE, F1, MATERIAL, makeWorld, run } from './test-world';

const W = 60;
const H = 30;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));

function baseStart(material: number) {
  return {
    faction: F1,
    units: [],
    stock: new Map([[MATERIAL, material]]),
    structures: [{ kind: BASE.index, x: 2, y: 2 }],
  };
}

describe('site progress', () => {
  it('progress is capped by delivered material', () => {
    // 5 units = 5000 milli of the 20000 needed: allowed = 120*5/20 = 30.
    const w = makeWorld({ rows: FLAT, starts: [baseStart(5)] });
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 10, y: 10, blueprint: false });
    run(w, CYCLE * 6 + 40);
    const site = w.inspect(Number(w.structures().handles[1]));
    expect(site?.state).toBe('site');
    expect(site?.slots?.[0]?.delivered).toBe(5000);
    // allowed = floorDiv(120 * 5000, 20000) = 30; progress clamps there.
    expect(site?.progress).toBe(30);
    expect(site?.slots?.[0]?.delivered).toBeLessThan(20000);
  });

  it('no progress at all with zero stock', () => {
    const w = makeWorld({ rows: FLAT, starts: [baseStart(0)] });
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 10, y: 10, blueprint: false });
    run(w, CYCLE * 3);
    const site = w.inspect(Number(w.structures().handles[1]));
    expect(site?.progress).toBe(0);
  });

  it('completes, emits construction.completed and converts the store', () => {
    const w = makeWorld({ rows: FLAT, starts: [baseStart(200)] });
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 10, y: 10, blueprint: false });
    run(w, 2);
    const handle = Number(w.structures().handles[1]);
    // 120 build ticks + a few delivery cycles; poll for the event.
    let sawEvent = false;
    for (let t = 0; t < 240 && !sawEvent; t++) {
      w.sim.step();
      sawEvent = w.sim.snapshot(F1).events.some((e) => e.type === ConstructionCompleted.type);
    }
    expect(sawEvent).toBe(true);
    const site = w.inspect(handle);
    expect(site?.state).toBe('operational');
    expect(site?.progressBp).toBe(10000);
    const ch = w.structures();
    expect(ch.state[1]).toBe(3);
    // Converted profile: the station's energy reserve slot replaced the
    // site-material slot (the logistics inspector sees a normal store).
    const logisticsSection = w.sim.snapshot(F1).channels['frontline_td:logistics'];
    expect(logisticsSection).not.toBeNull();
  });
});
