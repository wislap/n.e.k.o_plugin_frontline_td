// Construction commands: placement validation, blueprint reservation,
// activation, cancellation/demolition and the structures channel.
import { describe, expect, it } from 'vitest';
import type { SpawnInit } from '../../../kernel/index';
import { ActivateCommand, CancelCommand, PlaceCommand } from '../protocol';
import {
  BASE,
  CYCLE,
  DEPOT,
  F1,
  F2,
  MATERIAL,
  makeWorld,
  moverInit,
  run,
  structureInit,
} from './test-world';

const W = 60;
const H = 30;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));

// World with a completed main base at (2,2) and material in the warehouse.
function baseWorld(
  overrides: { entities?: readonly { parts: SpawnInit; faction?: number }[] } = {},
) {
  return makeWorld({
    rows: FLAT,
    factions: [1, 2],
    entities: overrides.entities ?? [],
    starts: [
      {
        faction: F1,
        units: [],
        stock: new Map([[MATERIAL, 200]]),
        structures: [{ kind: BASE.index, x: 2, y: 2 }],
      },
    ],
  });
}

describe('construction.place', () => {
  it('rejects non-buildable and unknown kinds without mutating', () => {
    const w = baseWorld();
    w.issue(PlaceCommand.type, { kind: 'frontline_td:main_base', x: 10, y: 10, blueprint: false });
    w.issue(PlaceCommand.type, { kind: 'frontline_td:bogus', x: 10, y: 10, blueprint: false });
    run(w, 2); // commands land two steps after submit
    expect(w.rejections()).toEqual(['not_buildable', 'not_buildable']);
    expect(w.structures().handles.length).toBe(1); // only the base
    expect(w.terrain.blocked(10, 10)).toBe(false);
  });

  it('rejects out_of_bounds, terrain and uneven footprints', () => {
    const w = makeWorld({
      rows: [
        '..........',
        '..........',
        '....p.....',
        '..........',
        '..........',
        '......#...',
        '..........',
        '......^...',
        '..........',
        '..........',
      ],
      entities: [{ parts: structureInit(BASE, 0, 0) }],
    });
    // Station 2x2 needs to connect to the base (connect 200+): the rock,
    // ramp and cliff cells are all within reach but fail the footprint.
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 9, y: 0, blueprint: false });
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 6, y: 5, blueprint: false });
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 6, y: 7, blueprint: false });
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 3, y: 1, blueprint: false });
    run(w, 2);
    // x=9 footprint leaves the map; rock at (6,5); ramp at (6,7); the
    // (3,1) footprint spans heights 0 and 1 (p at row 2 x=4).
    expect(w.rejections()).toEqual(['out_of_bounds', 'terrain', 'terrain', 'uneven']);
    expect(w.structures().handles.length).toBe(1);
  });

  it('rejects not_connected when no completed node is in range', () => {
    const w = baseWorld();
    // Station at (40,20): far outside every connect bound.
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 40, y: 20, blueprint: false });
    run(w, 2);
    expect(w.rejections()).toEqual(['not_connected']);
  });

  it('rejects units_in_way but still allows a blueprint', () => {
    const w = baseWorld({ entities: [{ parts: moverInit(12, 10) }] });
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 11, y: 10, blueprint: false });
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 11, y: 10, blueprint: true });
    run(w, 2);
    expect(w.rejections()).toEqual(['units_in_way']);
    const ch = w.structures();
    expect(ch.handles.length).toBe(2); // base + blueprint
    expect(ch.state[1]).toBe(0);
    // The blueprint does not block movement cells.
    expect(w.terrain.blocked(11, 10)).toBe(false);
  });

  it('spawns a site that blocks its footprint and requests materials', () => {
    const w = baseWorld();
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 10, y: 10, blueprint: false });
    run(w, 2);
    expect(w.rejections()).toEqual([]);
    expect(w.terrain.blocked(10, 10)).toBe(true);
    expect(w.terrain.blocked(11, 11)).toBe(true);
    const ch = w.structures();
    expect(ch.handles.length).toBe(2);
    expect(ch.state[1]).toBe(2); // site
    const site = w.inspect(Number(ch.handles[1]));
    expect(site?.state).toBe('site');
    expect(site?.slots).toEqual([{ cargo: MATERIAL, required: 20000, delivered: 0 }]);
  });

  it('reserves blueprint cells per faction; another faction may overlap', () => {
    const w = baseWorld();
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 30, y: 10, blueprint: true });
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 30, y: 10, blueprint: true }, F2);
    w.issue(PlaceCommand.type, { kind: DEPOT.id, x: 29, y: 10, blueprint: true });
    run(w, 2);
    // F2's blueprint is fine (its own reservation map); F1's overlapping
    // depot is rejected 'reserved'.
    expect(w.rejections()).toEqual(['reserved']);
    const f1 = w.structures(F1);
    const f2 = w.structures(F2);
    // Each observer sees only their own blueprint (+ all real structures).
    expect(f1.state.filter((s) => s === 0).length).toBe(1);
    expect(f2.state.filter((s) => s === 0).length).toBe(1);
    expect(f1.handles.length).toBe(2); // base + f1 blueprint
    expect(f2.handles.length).toBe(2); // f2 blueprint + f1's base
  });
});

describe('construction.activate', () => {
  it('rejects no_targets and activates waiting blueprints', () => {
    const w = baseWorld();
    w.issue(ActivateCommand.type, { blueprints: [12345] });
    run(w, 2);
    expect(w.rejections()).toEqual(['no_targets']);

    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 10, y: 10, blueprint: true });
    run(w, 2); // deferred spawn visible from the next tick
    const bp = Number(w.structures().handles[1]);
    w.issue(ActivateCommand.type, { blueprints: [bp] });
    run(w, 2);
    expect(w.rejections()).toEqual([]);
    // It is buildable, so the next cycle turns it into a site.
    run(w, CYCLE + 2);
    expect(w.structures().state[1]).toBe(2);
    expect(w.terrain.blocked(10, 10)).toBe(true);
  });

  it('reports a waiting reason while the blueprint cannot start', () => {
    const w = baseWorld();
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 40, y: 20, blueprint: true });
    run(w, 2);
    const bp = Number(w.structures().handles[1]);
    w.issue(ActivateCommand.type, { blueprints: [bp] });
    run(w, CYCLE + 2);
    const ch = w.structures();
    expect(ch.state[1]).toBe(1); // waiting
    expect(w.inspect(bp)?.waiting).toBe('not_connected');
    expect(w.terrain.blocked(40, 20)).toBe(false);
  });
});

describe('construction.cancel', () => {
  it('despawns a blueprint and frees its reservation', () => {
    const w = baseWorld();
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 30, y: 10, blueprint: true });
    run(w, 2);
    const bp = Number(w.structures().handles[1]);
    w.issue(CancelCommand.type, { targets: [bp] });
    run(w, 2);
    expect(w.rejections()).toEqual([]);
    expect(w.structures().handles.length).toBe(1);
    // The cells can be reserved again.
    w.issue(PlaceCommand.type, { kind: DEPOT.id, x: 30, y: 10, blueprint: true });
    run(w, 2);
    expect(w.rejections()).toEqual([]);
    expect(w.structures().state[1]).toBe(0);
  });

  it('rejects no_targets for invalid or foreign handles', () => {
    const w = baseWorld();
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 30, y: 10, blueprint: true });
    run(w, 2);
    const bp = Number(w.structures(F1).handles[1]);
    w.issue(CancelCommand.type, { targets: [99999] });
    w.issue(CancelCommand.type, { targets: [bp] }, F2); // foreign
    run(w, 2);
    expect(w.rejections()).toEqual(['no_targets']);
    expect(w.rejections(F2)).toEqual(['no_targets']);
    expect(w.structures().handles.length).toBe(2);
  });

  it('deduplicates handles: one site cancel spawns one salvage pile', () => {
    const w = baseWorld();
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 10, y: 10, blueprint: false });
    run(w, CYCLE * 3);
    const site = Number(w.structures().handles[1]);
    w.issue(CancelCommand.type, { targets: [site, site, site] });
    run(w, 2);
    expect(w.rejections()).toEqual([]);
    expect(w.salvage().handles.length).toBe(1);
  });

  it('two cancel commands in one tick queue only one demolition', () => {
    const w = baseWorld({ entities: [{ parts: structureInit(DEPOT, 10, 10) }] });
    const depot = Number(w.structures().handles[1]);
    // Both commands run in the same command phase; the second must see the
    // pending demolition rather than reading the building as finished.
    w.issue(CancelCommand.type, { targets: [depot] });
    w.issue(CancelCommand.type, { targets: [depot] });
    run(w, 2);
    expect(w.rejections()).toEqual(['no_targets']);
    expect(w.structures().state[1]).toBe(4);
    run(w, 60 + 1);
    // One demolition -> one salvage pile, not two.
    expect(w.salvage().handles.length).toBe(1);
  });

  it('site cancel refunds delivered materials as salvage', () => {
    const w = baseWorld();
    w.issue(PlaceCommand.type, { kind: 'frontline_td:station', x: 10, y: 10, blueprint: false });
    // Let a couple of cycles deliver some material.
    run(w, CYCLE * 3);
    const delivered = w.inspect(Number(w.structures().handles[1]))?.slots?.[0]?.delivered ?? 0;
    expect(delivered).toBeGreaterThan(0);
    const site = Number(w.structures().handles[1]);
    w.issue(CancelCommand.type, { targets: [site] });
    run(w, 2);
    expect(w.rejections()).toEqual([]);
    expect(w.terrain.blocked(10, 10)).toBe(false);
    const sv = w.salvage();
    expect(sv.handles.length).toBe(1);
    expect(w.structures().handles.length).toBe(1);
  });

  it('finished building demolishes, frees cells and refunds salvage', () => {
    const w = baseWorld({ entities: [{ parts: structureInit(DEPOT, 10, 10) }] });
    // The raw test entity didn't block its cells; block them now so the
    // free-on-demolition path is observable.
    w.terrain.setBlocked(
      [
        { x: 10, y: 10 },
        { x: 11, y: 10 },
        { x: 10, y: 11 },
        { x: 11, y: 11 },
      ],
      true,
    );
    const depot = Number(w.structures().handles[1]);
    const base = Number(w.structures().handles[0]);
    // main_base is not buildable: cancelling it yields no valid targets.
    w.issue(CancelCommand.type, { targets: [base] });
    w.issue(CancelCommand.type, { targets: [depot] });
    run(w, 2);
    expect(w.rejections()).toEqual(['no_targets']);
    expect(w.structures().state[1]).toBe(4); // demolishing
    // Cancelling again while demolishing is a no-op for that handle.
    w.issue(CancelCommand.type, { targets: [depot] });
    run(w, 2);
    expect(w.rejections()).toEqual(['no_targets']);
    run(w, (DEPOT.build?.demolishTicks ?? 0) + 1);
    const ch = w.structures();
    expect(ch.handles.length).toBe(1);
    expect(w.terrain.blocked(10, 10)).toBe(false);
    // Refund: material 30 x salvageBp 5000 = 15 units in an export slot.
    run(w, 1); // deferred salvage spawn visible from the next tick
    expect(w.salvage().handles.length).toBe(1);
  });
});
