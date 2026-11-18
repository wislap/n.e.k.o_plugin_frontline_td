// Ruin lifecycle tests (M5 batch A): a dead capture structure becomes a
// construction-owned ruin — no Faction, footprint stays blocked, cancel
// and demolish commands ignore it — and a completed capture turns it
// into a fresh site for the captor with rebuildTicks as its total.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/index';
import { MILLI, toFactionId } from '../../../core/index';
import type { SimModule } from '../../../kernel/index';
import { captureRuinParts, createCaptureModule } from '../../capture/sim/index';
import { DamageIntent } from '../../combat/protocol';
import { createCombatModule, structureParts as combatStructureParts } from '../../combat/sim/index';
import {
  ActivateCommand,
  CancelCommand,
  PlaceCommand,
  STATE_BLUEPRINT,
  STATE_OPERATIONAL,
  STATE_RUIN,
  STATE_SITE,
} from '../protocol';
import type { ConstructionStructures } from '../protocol';
import { Structure } from './components';
import { F1, F2, makeWorld, moverInit, run } from './test-world';
import { must } from '../../../testing/index';

const DB = loadContent();
const OUTPOST = must(DB.structures.byId('frontline_td:outpost'), 'outpost');
const DEPOT = must(DB.structures.byId('frontline_td:supply_depot'), 'supply_depot');
const REBUILD = must(OUTPOST.capture, 'outpost.capture').rebuildTicks;
const ROWS = Array.from({ length: 40 }, () => '.'.repeat(40));

// Emits one lethal DamageIntent against the first `kind` structure at
// tick 1 (resolved by query — handles are not needed at build time).
function killer(kindIndex: number, tick = 1): SimModule {
  return {
    id: `frontline_td:test.ruin_killer_${tick}`,
    install(builder) {
      builder.system({
        id: `frontline_td:test.ruin_killer.hit_${tick}`,
        phase: 'combat_intent',
        emits: [DamageIntent],
        run(ctx) {
          if (ctx.tick !== tick) {
            return;
          }
          const st = ctx.read(Structure);
          for (const id of ctx.query([Structure])) {
            if ((st.kind[id] ?? -1) === kindIndex) {
              const handle = ctx.handleOf(id as never);
              if (handle !== null) {
                ctx.emit(DamageIntent, { target: Number(handle), amount: 10_000_000 * MILLI });
              }
              return;
            }
          }
        },
      });
    },
  };
}

// Start structures go through spawnStructure: complete, faction-owned,
// footprint blocked and all injected parts (combat health included).
function outpostStart(faction: number, x: number, y: number) {
  return { faction: toFactionId(faction), structures: [{ kind: OUTPOST.index, x, y }] };
}

function baseOpts(extraModules: readonly SimModule[]) {
  return {
    rows: ROWS,
    factions: [1, 2] as const,
    relations: [{ a: 1, b: 2, relation: 'hostile' as const }],
    structureParts: [combatStructureParts],
    ruinParts: [captureRuinParts],
    extraModules,
  };
}

function outpostRow(rows: ConstructionStructures): number {
  for (let i = 0; i < rows.handles.length; i++) {
    if ((rows.kind[i] ?? -1) === OUTPOST.index) {
      return i;
    }
  }
  return -1;
}

describe('ruins (M5 batch A)', () => {
  it('a dead capture structure becomes a ruin: no faction, still blocked', () => {
    const w = makeWorld({
      ...baseOpts([createCombatModule(), createCaptureModule(DB), killer(OUTPOST.index)]),
      starts: [outpostStart(2, 5, 5)],
    });
    run(w, 3);
    const rows = w.structures(F2);
    const i = outpostRow(rows);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(rows.state[i]).toBe(STATE_RUIN);
    expect(rows.faction[i]).toBe(0);
    expect(rows.progressBp[i]).toBe(0);
    expect(rows.hpBp[i]).toBe(0);
    // The footprint stays blocked through the ruin.
    expect(w.terrain.blocked(6, 6)).toBe(true);
    expect(w.terrain.blocked(5, 5)).toBe(true);
  });

  it('cancel ignores ruins', () => {
    const w = makeWorld({
      ...baseOpts([createCombatModule(), createCaptureModule(DB), killer(OUTPOST.index)]),
      starts: [outpostStart(2, 5, 5)],
    });
    run(w, 3);
    const ruinHandle = w.structures(F2).handles[outpostRow(w.structures(F2))] ?? 0;
    w.issue(CancelCommand.type, { targets: [ruinHandle] }, F2);
    run(w, 2);
    const rows = w.structures(F2);
    expect(rows.state[outpostRow(rows)]).toBe(STATE_RUIN);
  });

  it('a completed capture rebuilds the ruin into a captor site', () => {
    const w = makeWorld({
      ...baseOpts([createCombatModule(), createCaptureModule(DB), killer(OUTPOST.index)]),
      starts: [outpostStart(2, 5, 5)],
      entities: [{ parts: moverInit(6.5, 6.5), faction: 1 }],
    });
    // Ruin appears after the kill; the lone captor unit then captures in
    // capture.seconds (30 s = 600 ticks). Give it slack.
    run(w, 650);
    let rows = w.structures(F1);
    let i = outpostRow(rows);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(rows.state[i]).toBe(STATE_SITE);
    expect(rows.faction[i]).toBe(1);
    // Time-only build: total = rebuildTicks even with no cost slots.
    const insp = w.inspect(rows.handles[i] ?? 0, F1);
    expect(insp?.total).toBe(REBUILD);
    expect(insp?.slots ?? []).toHaveLength(0);
    // Still blocked through the swap.
    expect(w.terrain.blocked(6, 6)).toBe(true);
    run(w, REBUILD + 20);
    rows = w.structures(F1);
    i = outpostRow(rows);
    expect(rows.state[i]).toBe(STATE_OPERATIONAL);
    expect(rows.faction[i]).toBe(1);
    expect(w.terrain.blocked(6, 6)).toBe(true);
  });

  it('a captor site destroyed before completion becomes a ruin again', () => {
    // Second kill lands at tick 660, after the capture has produced the
    // faction-1 rebuild site (~630 ticks into the run).
    const w = makeWorld({
      ...baseOpts([
        createCombatModule(),
        createCaptureModule(DB),
        killer(OUTPOST.index),
        killer(OUTPOST.index, 660),
      ]),
      starts: [outpostStart(2, 5, 5)],
      entities: [{ parts: moverInit(6.5, 6.5), faction: 1 }],
    });
    run(w, 650);
    expect(w.structures(F1).state[outpostRow(w.structures(F1))]).toBe(STATE_SITE);
    run(w, 15);
    const rows = w.structures(F1);
    const i = outpostRow(rows);
    expect(rows.state[i]).toBe(STATE_RUIN);
    expect(rows.faction[i]).toBe(0);
    expect(w.terrain.blocked(6, 6)).toBe(true);
  });

  it('mirror symmetry: factions swapped, positions mirrored, mirrored outcome', () => {
    // Same scenario with factions 1<->2 swapped and every position
    // mirrored across the map centre (40x40: p -> 39.5 - p for the
    // footprint top-left 5 -> 34, mover centre 6.5 -> 33).
    const w = makeWorld({
      ...baseOpts([createCombatModule(), createCaptureModule(DB), killer(OUTPOST.index)]),
      starts: [outpostStart(1, 34, 34)],
      entities: [{ parts: moverInit(35.5, 35.5), faction: 2 }],
    });
    run(w, 650);
    let rows = w.structures(F2);
    let i = outpostRow(rows);
    expect(rows.state[i]).toBe(STATE_SITE);
    expect(rows.faction[i]).toBe(2);
    run(w, REBUILD + 20);
    rows = w.structures(F2);
    i = outpostRow(rows);
    expect(rows.state[i]).toBe(STATE_OPERATIONAL);
    expect(rows.faction[i]).toBe(2);
  });
});

describe('exclusion zones (M5 batch A)', () => {
  it('operational hostile outposts deny placement inside the radius', () => {
    const w = makeWorld({
      ...baseOpts([createCombatModule(), createCaptureModule(DB)]),
      starts: [outpostStart(2, 5, 5)],
    });
    run(w, 1);
    // Depot 2x2 at (10,10): centre cell (11,11) is ~6.4 from (6.5,6.5).
    w.issue(PlaceCommand.type, { kind: DEPOT.id, x: 10, y: 10, blueprint: false }, F1);
    run(w, 2);
    expect(w.rejections(F1)).toContain('hostile_zone');
  });

  it('placement outside the radius falls through to coverage checks', () => {
    const w = makeWorld({
      ...baseOpts([createCombatModule(), createCaptureModule(DB)]),
      starts: [outpostStart(2, 5, 5)],
    });
    run(w, 1);
    // Depot at (25,25): centre (26,26) is ~26.9 away -> not excluded;
    // the depot is a node, so the fall-through reason is not_connected.
    w.issue(PlaceCommand.type, { kind: DEPOT.id, x: 25, y: 25, blueprint: false }, F1);
    run(w, 2);
    expect(w.rejections(F1)).toContain('not_connected');
    expect(w.rejections(F1)).not.toContain('hostile_zone');
  });

  it('the hive exclusion (16) also applies', () => {
    const hive = DB.structures.byId('frontline_td:hive');
    if (hive === undefined) {
      throw new Error('hive missing');
    }
    const w = makeWorld({
      ...baseOpts([createCombatModule(), createCaptureModule(DB)]),
      starts: [{ faction: F2, structures: [{ kind: hive.index, x: 5, y: 5 }] }],
    });
    run(w, 1);
    // Depot 2x2 at (15,15): centre (16,16) is ~12.5 from (7,7) < 16.
    w.issue(PlaceCommand.type, { kind: DEPOT.id, x: 15, y: 15, blueprint: false }, F1);
    run(w, 2);
    expect(w.rejections(F1)).toContain('hostile_zone');
  });

  it('ruins do not exclude', () => {
    const w = makeWorld({
      ...baseOpts([createCombatModule(), createCaptureModule(DB), killer(OUTPOST.index)]),
      starts: [outpostStart(2, 5, 5)],
    });
    run(w, 3);
    w.issue(PlaceCommand.type, { kind: DEPOT.id, x: 10, y: 10, blueprint: false }, F1);
    run(w, 2);
    expect(w.rejections(F1)).not.toContain('hostile_zone');
  });

  it('an activated blueprint waits on hostile_zone and starts once the zone falls', () => {
    // Own depot node at (18,4): centre (19,5). Blueprint depot at (14,4):
    // centre (15,5) is inside the outpost's exclusion (~8.6 < 12) but
    // within the own node's connect range (4 < 10), so hostile_zone is
    // the only blocker.
    const w = makeWorld({
      ...baseOpts([createCombatModule(), createCaptureModule(DB), killer(OUTPOST.index, 40)]),
      starts: [
        outpostStart(2, 5, 5),
        { faction: F1, structures: [{ kind: DEPOT.index, x: 18, y: 4 }] },
      ],
    });
    run(w, 1);
    w.issue(PlaceCommand.type, { kind: DEPOT.id, x: 14, y: 4, blueprint: true }, F1);
    run(w, 2);
    // Blueprints are private: find it via the F1 structures view.
    const rows = w.structures(F1);
    let bpHandle = 0;
    for (let i = 0; i < rows.handles.length; i++) {
      if ((rows.state[i] ?? -1) === STATE_BLUEPRINT) {
        bpHandle = rows.handles[i] ?? 0;
      }
    }
    expect(bpHandle).toBeGreaterThan(0);
    w.issue(ActivateCommand.type, { blueprints: [bpHandle] }, F1);
    run(w, 25);
    let insp = w.inspect(bpHandle, F1);
    expect(insp?.state).toBe('waiting');
    expect(insp?.waiting).toBe('hostile_zone');
    // The outpost dies at tick 40; the ruin does not exclude, so the
    // next activation cycle turns the blueprint into a building site.
    run(w, 40);
    insp = w.inspect(bpHandle, F1);
    expect(insp === null || insp.state !== 'waiting' || insp.waiting !== 'hostile_zone').toBe(true);
    const after = w.structures(F1);
    let siteState = -1;
    for (let i = 0; i < after.handles.length; i++) {
      if ((after.x[i] ?? -1) === 14 && (after.y[i] ?? -1) === 4) {
        siteState = after.state[i] ?? -1;
      }
    }
    expect(siteState).toBe(STATE_SITE);
  });
});
