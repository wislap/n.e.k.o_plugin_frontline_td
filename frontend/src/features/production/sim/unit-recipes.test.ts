// Unit recipes (A4): unitOutput cycles through its unit list with the
// cycle index kept as producer state (serialized), the ramp is a step
// function on match ticks, no-input recipes need no attachment or
// energy, and completion emits units.spawn at the bottom edge.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/index';
import { restoreSimulation } from '../../../kernel/index';
import { CargoStore } from '../../logistics/sim/index';
import { ENERGY, F1, makeWorld, MATERIAL, run, structureInit } from './test-world';
import type { BuiltWorld } from './test-world';
import { denseUnits } from '../../../testing/index';

const DB = loadContent();
const HIVE = DB.structures.byId('frontline_td:hive');
const ROBOT_FACTORY = DB.structures.byId('frontline_td:robot_factory');

const W = 40;
const H = 30;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));

if (HIVE === undefined || ROBOT_FACTORY === undefined) {
  throw new Error('M4 content missing');
}

function unitCount(w: BuiltWorld): number {
  return denseUnits(w.sim, F1).handles.length;
}

// Preload production-class store slots: robot_factory stores are
// material (slot 0) and energy (slot 1).
const stocked =
  (material: number, energy: number) =>
  (comp: unknown, init: Record<string, number>): Record<string, number> =>
    comp === CargoStore ? { ...init, amt0: material, amt1: energy } : init;

describe('unit recipes', () => {
  it('hive produces units on its no-input recipe (no energy/attach)', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [{ parts: structureInit(HIVE, 10, 10) }],
      withUnits: true,
    });
    expect(unitCount(w)).toBe(0);
    // First ramp step: 10 s = 200 ticks; the unit is visible next tick.
    run(w, 201);
    expect(unitCount(w)).toBe(1);
    // Spawned near the hive's bottom edge (footprint 4 cells from 10,10).
    const d = denseUnits(w.sim, F1);
    expect(d.y[0] ?? 0).toBeGreaterThan(12);
    expect(d.y[0] ?? 99).toBeLessThan(18);
  });

  it('unitOutput cycles and the cycle index survives serialize/restore', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [{ parts: structureInit(HIVE, 10, 10) }],
      withUnits: true,
    });
    // cycle order: crawler, crawler, spitter, ...
    run(w, 602);
    expect(unitCount(w)).toBe(3);
    expect(DB.units.byIndex(denseUnits(w.sim, F1).kind[2] ?? -1)?.id).toBe('frontline_td:spitter');
    const saved = w.sim.serialize();
    const restored = restoreSimulation(w.config, w.modules, saved);
    w.attach(restored);
    run(w, 200);
    // Next cycle index is 3 → crawler, and the restore did not respawn.
    expect(unitCount(w)).toBe(4);
    expect(DB.units.byIndex(denseUnits(w.sim, F1).kind[3] ?? -1)?.id).toBe('frontline_td:crawler');
  });

  it('ramp shortens the cycle when its step tick passes', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [{ parts: structureInit(HIVE, 10, 10) }],
      withUnits: true,
    });
    const spawnTicks: number[] = [];
    // Track spawns by counting units each tick up to the 300 s step
    // (tick 6000): cadence 200 → 140 ticks after the step.
    let last = 0;
    for (let t = 0; t < 7000; t++) {
      w.sim.step();
      const n = unitCount(w);
      if (n > last) {
        spawnTicks.push(w.sim.tick);
        last = n;
      }
    }
    const gaps = spawnTicks.slice(1).map((t, i) => t - (spawnTicks[i] ?? 0));
    // Before tick 6000 cycles are 200 ticks; after, 140.
    const early = gaps.filter((_, i) => (spawnTicks[i + 1] ?? 0) <= 6000);
    const late = gaps.filter((_, i) => (spawnTicks[i + 1] ?? 0) > 6000);
    expect(early.every((g) => g === 200)).toBe(true);
    expect(late.every((g) => g === 140)).toBe(true);
    expect(late.length).toBeGreaterThan(0);
  });

  it('robot_factory consumes inputs and spawns a robot', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [{ parts: structureInit(ROBOT_FACTORY, 10, 10, stocked(10000, 10000)) }],
      withUnits: true,
    });
    // 12 s = 240 ticks.
    run(w, 241);
    expect(unitCount(w)).toBe(1);
    expect(DB.units.byIndex(denseUnits(w.sim, F1).kind[0] ?? -1)?.id).toBe('frontline_td:robot');
    // Inputs were consumed by the cycle start.
    expect(w.storeAmount(0, MATERIAL)).toBe(0);
    expect(w.storeAmount(0, ENERGY)).toBe(0);
  });

  it('robot_factory waits for inputs before starting', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [{ parts: structureInit(ROBOT_FACTORY, 10, 10, stocked(0, 0)) }],
      withUnits: true,
    });
    run(w, 300);
    expect(unitCount(w)).toBe(0);
    const section = w.inspect(0, 'frontline_td:production') as { state?: string };
    expect(section.state).toBe('waiting_inputs');
  });
});
