// Vision layer + memory + channel filtering tests (M5 batch B). The
// shared world lives in ./test-world.ts.
import { describe, expect, it } from 'vitest';
import { restoreSimulation } from '../../../kernel/index';
import { StructuresChannel } from '../../construction/protocol';
import type { ConstructionStructures } from '../../construction/protocol';
import {
  DEPOT,
  despawnFirstMover,
  despawnStructure,
  depotStart,
  F1,
  F2,
  HIVE,
  makeWorld,
  OUTPOST,
  robotStart,
  spawnBareStructure,
  spawnRobot,
  structureKinds,
  W,
} from './test-world';

describe('vision layer (M5 batch B)', () => {
  it('stamps visible discs and downgrades to explored when sight leaves', () => {
    // Robot (vision 7) at (4,4); despawns at tick 6 before the tick-10
    // recompute, so its old disc lands on 'explored'.
    const w = makeWorld({
      starts: [robotStart(1, 4, 4)],
      extra: [despawnFirstMover(6)],
    });
    w.run(1);
    let layer = w.layer(F1);
    expect(layer[4 * W + 4]).toBe(2);
    expect(layer[39 * W + 39]).toBe(0);
    w.run(10);
    layer = w.layer(F1);
    // Sight gone: previously visible cells downgrade 2 -> 1, never 0.
    expect(layer[4 * W + 4]).toBe(1);
    expect(layer[39 * W + 39]).toBe(0);
  });

  it('hides hostile units outside vision and shows them inside', () => {
    // F1 robot at (4,4) sees radius 7. F2 crawlers: one at (8,4) inside,
    // one at (35,35) outside.
    const w = makeWorld({
      starts: [robotStart(1, 4, 4), robotStart(2, 8, 4), robotStart(2, 35, 35)],
    });
    w.run(1);
    const dense = w.dense(F1);
    // F1 sees its own robot plus the nearby crawler, not the far one.
    expect(dense.handles.length).toBe(2);
    // F2 sees both own units — plus the F1 robot, which the near
    // crawler's vision exposes (symmetric fog).
    const dense2 = w.dense(F2);
    expect(dense2.handles.length).toBe(3);
    let f1Seen = 0;
    for (let i = 0; i < dense2.handles.length; i++) {
      if (dense2.faction[i] === 1) {
        f1Seen++;
      }
    }
    expect(f1Seen).toBe(1);
  });
});

describe('vision memory (M5 batch B)', () => {
  it('records a seen structure, keeps it unseen, drops it when seen gone', () => {
    // F1 robot at (25,30) sees the F2 depot at (30,30) (footprint cells
    // 30-31 are within radius 7). The robot despawns at tick 6, the depot
    // at tick 12 while invisible, then a new robot re-exposes the cell.
    const w = makeWorld({
      starts: [robotStart(1, 25, 30), depotStart(2, 30, 30)],
      extra: [despawnFirstMover(6), despawnStructure(DEPOT.index, 12), spawnRobot(25, 30, 16)],
    });
    w.run(1);
    // Visible now: the depot is in the structures channel, not memory.
    expect(structureKinds(w.structures(F1), DEPOT.index)).toBe(1);
    expect(structureKinds(w.memory(F1), DEPOT.index)).toBe(0);
    w.run(11);
    // Robot gone: depot leaves the structures channel but stays in memory.
    expect(structureKinds(w.structures(F1), DEPOT.index)).toBe(0);
    expect(structureKinds(w.memory(F1), DEPOT.index)).toBe(1);
    w.run(7);
    // Depot was destroyed unseen (tick 12): the memory entry persists —
    // the replacement robot's disc has not recomputed yet.
    expect(structureKinds(w.memory(F1), DEPOT.index)).toBe(1);
    // After the next recompute the empty footprint is visible: the
    // stale entry is dropped.
    w.run(5);
    expect(structureKinds(w.memory(F1), DEPOT.index)).toBe(0);
  });

  it('drops a stale row even when the dead entity id was reused', () => {
    // The remembered depot dies unseen (tick 12) and a replacement
    // structure spawns elsewhere (tick 13) — entity ids recycle, so the
    // stale check must go through the stored handle, not the id.
    const w = makeWorld({
      starts: [robotStart(1, 25, 30), depotStart(2, 30, 30)],
      extra: [
        despawnFirstMover(6),
        despawnStructure(DEPOT.index, 12),
        spawnBareStructure(DEPOT.index, 35, 5, 13),
        spawnRobot(25, 30, 16),
      ],
    });
    w.run(12);
    // Recorded while visible, dead out of sight: the row persists.
    expect(structureKinds(w.memory(F1), DEPOT.index)).toBe(1);
    // The replacement entity may reuse the freed id; either way the old
    // footprint is re-exposed at the next recompute and the stale row
    // (dead handle) is dropped. The reused id's own structure shows up
    // in memory only once IT has been seen — it never is here.
    w.run(12);
    expect(structureKinds(w.memory(F1), DEPOT.index)).toBe(0);
  });

  it('seeds landmark structures of every other faction at the first tick', () => {
    // Landmarks far outside all vision: F2 hive + F1 outpost.
    const w = makeWorld({
      starts: [
        robotStart(1, 4, 4),
        { faction: F2, structures: [{ kind: HIVE.index, x: 30, y: 30 }] },
        { faction: F1, structures: [{ kind: OUTPOST.index, x: 4, y: 20 }] },
      ],
    });
    w.run(1);
    expect(structureKinds(w.memory(F1), HIVE.index)).toBe(1);
    expect(structureKinds(w.memory(F2), OUTPOST.index)).toBe(1);
  });
});

describe('omniscient + save/restore (M5 batch B)', () => {
  it('omniscient observers see all units regardless of fog', () => {
    const w = makeWorld({
      omniscient: new Set([2]),
      starts: [robotStart(1, 4, 4), robotStart(2, 35, 35)],
    });
    w.run(1);
    expect(w.dense(F2).handles.length).toBe(2);
    expect(w.dense(F1).handles.length).toBe(1);
  });

  it('memory and layer survive save/restore with identical hashes', () => {
    const a = makeWorld({
      starts: [robotStart(1, 25, 30), depotStart(2, 30, 30)],
    });
    a.run(7);
    const saved = a.sim.serialize();
    const b = makeWorld({
      starts: [robotStart(1, 25, 30), depotStart(2, 30, 30)],
    });
    const restored = restoreSimulation(b.config, b.modules, saved);
    a.run(13);
    for (let i = 0; i < 13; i++) {
      restored.step();
    }
    expect(restored.hash()).toBe(a.sim.hash());
    // The depot is visible throughout, so parity shows in the
    // structures channel (memory rows only list non-visible entries).
    const st = restored.snapshot(F1).channels[StructuresChannel.id] as ConstructionStructures;
    expect(structureKinds(st, DEPOT.index)).toBe(1);
  });
});
