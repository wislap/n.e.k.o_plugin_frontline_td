// Save/restore and determinism: a mid-construction world (activated
// blueprint waiting, site in progress, salvage in flight) must serialize
// and restore to an identical run, and two fresh runs must hash alike.
import { describe, expect, it } from 'vitest';
import { restoreSimulation } from '../../../kernel/index';
import { ActivateCommand, CancelCommand, PlaceCommand } from '../protocol';
import {
  BASE,
  CYCLE,
  DEPOT,
  F1,
  MATERIAL,
  buildWorld,
  makeWorld,
  run,
  structureInit,
} from './test-world';

const W = 60;
const H = 30;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));

const OPTS = {
  rows: FLAT,
  factions: [1, 2],
  entities: [{ parts: structureInit(DEPOT, 30, 20) }],
  starts: [
    {
      faction: F1,
      units: [],
      stock: new Map([[MATERIAL, 200]]),
      structures: [{ kind: BASE.index, x: 2, y: 2 }],
    },
  ],
};

// Drive a world into the mid-construction state used by both tests.
function midConstruction(w: ReturnType<typeof makeWorld>): void {
  // A waiting blueprint (out of range), a site in progress, and a depot
  // cancelled into salvage — all at once in the serialized state.
  w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 50, y: 20, blueprint: true });
  w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 10, y: 10, blueprint: false });
  run(w, 2); // deferred spawns visible from the next tick
  const bp = Number(w.structures().handles[2]);
  w.issue(ActivateCommand.type, { blueprints: [bp] });
  const depot = Number(w.structures().handles[1]);
  // Depot starts demolishing (demolishTicks long); the site meanwhile
  // receives deliveries, so cancelling it later drops salvage.
  w.issue(CancelCommand.type, { targets: [depot] });
  run(w, CYCLE * 3);
  const site = Number(w.structures().handles[3]);
  w.issue(CancelCommand.type, { targets: [site] });
  run(w, CYCLE + 5);
}

describe('save/restore mid-construction', () => {
  it('restores blueprint, site and salvage to an identical run', () => {
    const a = makeWorld(OPTS);
    midConstruction(a);
    // Salvage in flight, a site receiving deliveries, a waiting bp.
    expect(a.salvage().handles.length).toBe(1);
    // The waiting blueprint is still reserved in the saved state.
    expect([...a.structures().state]).toContain(1);

    const saved = a.sim.serialize();
    const b = buildWorld(OPTS);
    b.attach(restoreSimulation(b.config, b.modules, saved));
    run(a, CYCLE * 3);
    run(b, CYCLE * 3);
    expect(b.sim.hash()).toBe(a.sim.hash());

    const ca = a.structures();
    const cb = b.structures();
    expect([...cb.handles]).toEqual([...ca.handles]);
    expect([...cb.state]).toEqual([...ca.state]);
    expect([...cb.progressBp]).toEqual([...ca.progressBp]);
    expect([...b.salvage().handles]).toEqual([...a.salvage().handles]);
  });
});

describe('determinism', () => {
  it('two identical worlds hash the same after construction commands', () => {
    const a = makeWorld(OPTS);
    const b = makeWorld(OPTS);
    for (const w of [a, b]) {
      midConstruction(w);
    }
    run(a, CYCLE * 4);
    run(b, CYCLE * 4);
    expect(a.sim.hash()).toBe(b.sim.hash());
  });
});
