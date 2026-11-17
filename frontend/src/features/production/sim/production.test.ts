// Batch C production tests: recipes run via logistics intents, stall on
// missing inputs and on full outputs; miner placement requires its
// deposit surface; recipes resolve by structure kind index.
import { describe, expect, it } from 'vitest';
import { CargoStore } from '../../logistics/sim/index';
import { PlaceCommand } from '../../construction/protocol';
import {
  CYCLE,
  ENERGY,
  F1,
  FACTORY,
  MATERIAL,
  MINER,
  ORE,
  makeWorld,
  run,
  structureInit,
} from './test-world';

const W = 40;
const H = 20;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));

// Miner store slots: 0 = energy (production), 1 = ore export.
const stocked =
  (energy: number, ore: number) =>
  (comp: unknown, init: Record<string, number>): Record<string, number> =>
    comp === CargoStore ? { ...init, amt0: energy, amt1: ore } : init;

describe('production recipes', () => {
  it('miner converts energy into ore once per recipe time', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [{ parts: structureInit(MINER, 10, 10, stocked(10000, 0)) }],
    });
    // Recipe: 200 milli energy -> 1000 milli ore every 40 ticks.
    run(w, 41);
    expect(w.storeAmount(0, ORE)).toBe(1000);
    expect(w.storeAmount(0, ENERGY)).toBe(10000 - 200);
    run(w, 40);
    expect(w.storeAmount(0, ORE)).toBe(2000);
  });

  it('stalls with waiting_inputs when an input is missing', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [{ parts: structureInit(MINER, 10, 10, stocked(0, 0)) }],
    });
    run(w, CYCLE);
    const section = w.inspect(0, 'frontline_td:production') as {
      state: string;
      missing: number[];
    };
    expect(section.state).toBe('waiting_inputs');
    expect(section.missing).toEqual([ENERGY]);
    expect(w.storeAmount(0, ORE)).toBe(0);
  });

  it('stalls with output_full when the export slot has no room', () => {
    // ore cap is 20000 milli; fill it exactly.
    const w = makeWorld({
      rows: FLAT,
      entities: [{ parts: structureInit(MINER, 10, 10, stocked(10000, 20000)) }],
    });
    run(w, CYCLE);
    const section = w.inspect(0, 'frontline_td:production') as { state: string };
    expect(section.state).toBe('output_full');
    // No input was consumed while stalled.
    expect(w.storeAmount(0, ENERGY)).toBe(10000);
  });

  it('multi-input recipe consumes all inputs', () => {
    // ammo_factory: 1 material + 1 energy -> 2 ammo every 2 s.
    const stockedFactory = (comp: unknown, init: Record<string, number>) =>
      comp === CargoStore ? { ...init, amt0: 10000, amt1: 10000, amt2: 0 } : init;
    const w = makeWorld({
      rows: FLAT,
      entities: [{ parts: structureInit(FACTORY, 10, 10, stockedFactory) }],
    });
    // 40-tick recipe: deposit at tick 40, then the next batch's inputs
    // are consumed immediately, so two input sets are gone by tick 45.
    run(w, 45);
    const material = w.storeAmount(0, MATERIAL);
    const energy = w.storeAmount(0, ENERGY);
    expect(material).toBe(10000 - 2000);
    expect(energy).toBe(10000 - 2000);
  });
});

describe('miner deposit rule', () => {
  it('rejects placement off the ore deposit', () => {
    const w = makeWorld({ rows: FLAT, factions: [1] });
    w.issue(PlaceCommand.type, { kind: 'frontline_td:miner', x: 10, y: 10, blueprint: false });
    run(w, 2);
    expect(w.rejections(F1)).toContain('needs_deposit');
  });
});
