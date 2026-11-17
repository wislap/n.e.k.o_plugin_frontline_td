// Batch C combat tests: deterministic acquire+fire, cost gating and
// resupply, ordered damage with a single death event, cleanup-phase death
// readers (goal release, footprint free), symmetry and save/restore.
import { describe, expect, it } from 'vitest';
import { MILLI } from '../../../core/index';
import { restoreSimulation } from '../../../kernel/index';
import type { SimModule } from '../../../kernel/index';
import { CargoStore } from '../../logistics/sim/index';
import { MoveCommand, MoveTarget } from '../../movement/sim/index';
import { StructuresChannel } from '../../construction/protocol';
import type { ConstructionStructures } from '../../construction/protocol';
import { CombatDied, CombatShot, DamageIntent } from '../protocol';
import {
  AMMO,
  BASE,
  CYCLE,
  ENERGY,
  F1,
  ROBOT,
  TURRET,
  buildWorld,
  makeWorld,
  robotInit,
  run,
  structureInit,
} from './test-world';

const W = 40;
const H = 20;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));

// Turret store slots: 0 = energy, 1 = ammo (content order).
const ammo =
  (amount: number, energy = 20000) =>
  (comp: unknown, init: Record<string, number>): Record<string, number> =>
    comp === CargoStore ? { ...init, amt0: energy, amt1: amount } : init;

const SHOT = CombatShot.type;
const DIED = CombatDied.type;

// Test module emitting one massive DamageIntent at `tick` against the
// handle returned by `targetOf` (read lazily so test handles work).
function killerModule(tick: number, targetOf: () => number): SimModule {
  return {
    id: 'frontline_td:test.killer',
    install(builder) {
      builder.system({
        id: 'frontline_td:test.killer',
        phase: 'combat_intent',
        emits: [DamageIntent],
        run(ctx) {
          const target = targetOf();
          if (ctx.tick === tick && target !== 0) {
            ctx.emit(DamageIntent, { target, amount: 10 * MILLI * MILLI });
          }
        },
      });
    },
  };
}

describe('acquire and fire', () => {
  it('turret shoots a hostile robot in range, drains ammo and kills it', () => {
    const w = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      entities: [
        { parts: structureInit(TURRET, 10, 10, ammo(40000)) },
        { parts: robotInit(ROBOT, 14, 10), faction: 2 },
      ],
    });
    run(w, 120);
    // 9 shots x 6000 damage kills 50000 hp; cooldown 8 ticks. The robot
    // fires back, so filter shot events by the turret's handle.
    expect(w.alive(1)).toBe(-1);
    expect(w.events(DIED).length).toBe(1);
    const turretShots = w
      .events(SHOT)
      .filter((p) => (p as { from: number }).from === Number(w.handles[0]));
    expect(turretShots.length).toBe(9);
    expect(w.storeAmount(0, AMMO)).toBe(40000 - 9 * 1000);
  });

  it('does not fire at targets beyond range', () => {
    const w = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      entities: [
        { parts: structureInit(TURRET, 10, 10, ammo(40000)) },
        { parts: robotInit(ROBOT, 20, 10), faction: 2 },
      ],
    });
    run(w, 60);
    expect(w.events(SHOT).length).toBe(0);
    expect(w.hp(1)).toBe(50 * MILLI);
  });

  it('does not fire at own faction', () => {
    const w = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      entities: [
        { parts: structureInit(TURRET, 10, 10, ammo(40000)) },
        { parts: robotInit(ROBOT, 14, 10), faction: 1 },
      ],
    });
    run(w, 60);
    expect(w.events(SHOT).length).toBe(0);
    expect(w.hp(1)).toBe(50 * MILLI);
  });
});

describe('cost gating', () => {
  it('holds fire while ammo is empty and resumes after resupply', () => {
    // Without a network an empty turret can never fire.
    const dry = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      entities: [
        { parts: structureInit(TURRET, 10, 10, ammo(0)) },
        { parts: robotInit(ROBOT, 14, 10), faction: 2 },
      ],
    });
    run(dry, 60);
    expect(
      dry.events(SHOT).filter((p) => (p as { from: number }).from === Number(dry.handles[0]))
        .length,
    ).toBe(0);
    expect(dry.hp(1)).toBe(50 * MILLI);

    // With a stocked warehouse inside service range the lifeline ammo
    // slot is refilled by logistics and firing resumes.
    const w = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      entities: [
        { parts: structureInit(BASE, 2, 2) },
        { parts: structureInit(TURRET, 8, 8, ammo(0)) },
        { parts: robotInit(ROBOT, 12, 8), faction: 2 },
      ],
      starts: [
        {
          faction: F1,
          units: [],
          stock: new Map([
            [AMMO, 50],
            [ENERGY, 50],
          ]),
        },
      ],
    });
    expect(w.storeAmount(1, AMMO)).toBe(0);
    run(w, CYCLE * 8);
    expect(
      w.events(SHOT).filter((p) => (p as { from: number }).from === Number(w.handles[1])).length,
    ).toBeGreaterThan(0);
    expect(w.storeAmount(1, AMMO)).toBeGreaterThan(0);
  });

  it('robot laser drains its battery and stops firing at zero', () => {
    // One shot costs 200 milli of energy; a 400-milli battery allows two.
    const smallBattery = (comp: unknown, init: Record<string, number>) =>
      comp === CargoStore ? { ...init, cap0: 400, amt0: 400, rate0: 0 } : init;
    const w = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      entities: [
        { parts: robotInit(ROBOT, 10, 10, smallBattery) },
        { parts: robotInit(ROBOT, 12, 10, smallBattery), faction: 2 },
      ],
    });
    run(w, 100);
    // Each robot fires exactly twice, then goes silent.
    expect(w.events(SHOT).length).toBe(4);
    expect(w.hp(0)).toBe(50 * MILLI - 2 * 4000);
    expect(w.hp(1)).toBe(50 * MILLI - 2 * 4000);
    expect(w.storeAmount(0, ENERGY)).toBe(0);
  });
});

describe('damage resolution and death', () => {
  it('emits combat.died exactly once under focused fire', () => {
    const w = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      entities: [
        { parts: structureInit(TURRET, 10, 8, ammo(40000)) },
        { parts: structureInit(TURRET, 10, 12, ammo(40000)) },
        { parts: robotInit(ROBOT, 14, 10), faction: 2 },
      ],
    });
    run(w, 120);
    expect(w.alive(2)).toBe(-1);
    expect(w.events(DIED).length).toBe(1);
    const died = w.events(DIED)[0] as { handle: number; faction: number };
    expect(died.faction).toBe(2);
  });

  it('keeps the current target while valid, then switches to the next', () => {
    const w = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      entities: [
        { parts: structureInit(TURRET, 10, 10, ammo(40000)) },
        { parts: robotInit(ROBOT, 14, 10), faction: 2 },
        { parts: robotInit(ROBOT, 16, 10), faction: 2 },
      ],
    });
    run(w, 80);
    // The nearer robot is killed first.
    expect(w.alive(1)).toBe(-1);
    const died = w.events(DIED)[0] as { handle: number };
    expect(died.handle).toBe(Number(w.handles[1]));
    run(w, 120);
    expect(w.alive(2)).toBe(-1);
    expect(w.events(DIED).length).toBe(2);
  });
});

describe('death cleanup', () => {
  it('releases the shared pathing goal of dead movers', () => {
    let killed = 0;
    const goalProbe: SimModule = {
      id: 'frontline_td:test.goal',
      install(builder) {
        // Goal ids start at 0, so encode goal+1 (0 = nobody moving).
        builder.probe('frontline_td:test.goal', (ctx) => {
          const target = ctx.read(MoveTarget);
          for (const id of ctx.query([MoveTarget])) {
            if ((target.active[id] ?? 0) === 1) {
              return (target.goal[id] ?? 0) + 1;
            }
          }
          return 0;
        });
      },
    };
    const w = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      entities: [{ parts: robotInit(ROBOT, 5, 10) }, { parts: robotInit(ROBOT, 6, 10) }],
      extraModules: [goalProbe, killerModule(8, () => killed)],
    });
    // Entities spawn on the first step; handles exist only afterwards.
    run(w, 1);
    w.issue(MoveCommand.type, {
      units: [Number(w.handles[0]), Number(w.handles[1])],
      x: 30,
      y: 10,
    });
    run(w, 4);
    const encoded = w.sim.probes()['frontline_td:test.goal'] ?? 0;
    expect(encoded).toBeGreaterThan(0);
    const goal = encoded - 1;
    expect(w.pathing.goalRefCount(goal)).toBe(2);
    // Kill the first mover mid-flight; its goal share must be released.
    killed = Number(w.handles[0]);
    run(w, 6);
    expect(w.alive(0)).toBe(-1);
    expect(w.pathing.goalRefCount(goal)).toBe(1);
  });

  it('frees the footprint of a dead structure and reopens pathing', () => {
    let target = 0;
    const w = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      starts: [
        {
          faction: F1,
          units: [],
          structures: [{ kind: TURRET.index, x: 10, y: 10 }],
        },
      ],
      extraModules: [killerModule(6, () => target)],
    });
    run(w, 3);
    expect(w.terrain.blocked(10, 10)).toBe(true);
    expect(w.terrain.passable(10, 10, 0)).toBe(false);
    const channel = w.sim.snapshot(F1).channels[StructuresChannel.id] as ConstructionStructures;
    target = channel.handles[0] ?? 0;
    expect(target).toBeGreaterThan(0);
    run(w, 6);
    // Death ran through cleanup: despawned, footprint unblocked.
    const after = w.sim.snapshot(F1).channels[StructuresChannel.id] as ConstructionStructures;
    expect(after.handles.length).toBe(0);
    expect(w.terrain.blocked(10, 10)).toBe(false);
    expect(w.terrain.passable(10, 10, 0)).toBe(true);
  });
});

describe('symmetry and determinism', () => {
  it('a mirrored duel stays symmetric', () => {
    const w = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      entities: [
        { parts: structureInit(TURRET, 8, 10, ammo(40000)) },
        { parts: robotInit(ROBOT, 12, 10), faction: 2 },
        { parts: structureInit(TURRET, 32, 10, ammo(40000)), faction: 2 },
        { parts: robotInit(ROBOT, 28, 10), faction: 1 },
      ],
    });
    run(w, 40);
    expect(w.hp(1)).toBe(w.hp(3));
    expect(w.hp(0)).toBe(w.hp(2));
  });

  it('save/restore mid-fight keeps the hash and the run identical', () => {
    const OPTS = {
      rows: FLAT,
      factions: [1, 2],
      entities: [
        { parts: structureInit(TURRET, 10, 10, ammo(40000)) },
        { parts: robotInit(ROBOT, 13, 10), faction: 2 },
      ],
    };
    const a = makeWorld(OPTS);
    run(a, 30);
    const saved = a.sim.serialize();
    const b = buildWorld(OPTS);
    b.attach(restoreSimulation(b.config, b.modules, saved));
    run(a, 60);
    run(b, 60);
    expect(b.sim.hash()).toBe(a.sim.hash());
    expect(b.hp(1)).toBe(a.hp(1));
  });
});
