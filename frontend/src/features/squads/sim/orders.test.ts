// Squads AI (A5): the staggered orders-phase update — advance, guard
// engage and leash, resupply, reinforcement, gather launch, retarget,
// and the per-squad stagger.
import { describe, expect, it } from 'vitest';
import { distance, handleId } from '../../../core/index';
import type { EntityHandle } from '../../../core/index';
import { loadContent } from '../../../content/index';
import { Faction, InWorld } from '../../../kernel/index';
import type { SimModule } from '../../../kernel/index';
import { Health } from '../../combat/sim/index';
import { CargoStore } from '../../logistics/sim/index';
import { MoveCommand } from '../../movement/protocol';
import { CLEARANCE_HEAVY, clearanceAnchorCell } from '../../terrain/rules/index';
import { SpawnIntent } from '../../units/protocol';
import {
  BASE,
  DEPOT,
  F2,
  ROBOT,
  createAll,
  robotInit,
  robots,
  run,
  squad,
  structureInit,
  world,
} from './test-world';
import type { World } from './test-world';

// 30×20 map: a rock column at x=15 leaves only a 2-cell gap at rows
// 9–10 — a single 2×2 depot placed there seals the only corridor.
const CORRIDOR = Array.from({ length: 20 }, (_, y) => {
  const row = '.'.repeat(30).split('');
  if (y !== 9 && y !== 10) {
    row[15] = '#';
  }
  return row.join('');
});

describe('squads AI', () => {
  it('advance order becomes guard on arrival', () => {
    const w = world({ entities: robots(2, 4, 4) });
    createAll(w);
    w.issue('frontline_td:squads.order', { squad: 1, kind: 'advance', x: 12, y: 4 });
    run(w, 400);
    const sq = squad(w);
    expect(sq?.order.kind).toBe('guard');
    expect(Math.abs((sq?.centroid.x ?? 0) - 12.5)).toBeLessThan(2.5);
  });

  it('guard engages and damages a hostile inside the radius', () => {
    const w = world({
      entities: [...robots(2, 4, 4), { parts: robotInit(ROBOT, 8, 4), faction: 2 }],
      factions: [1, 2],
    });
    w.issue('frontline_td:squads.create', {
      units: w.handles.slice(0, 2).map((h) => Number(h)),
    });
    w.issue('frontline_td:squads.order', { squad: 1, kind: 'guard', x: 5, y: 4, radius: 8 });
    run(w, 120);
    expect(w.hp(2)).toBeLessThan(ROBOT.hp * 1000);
  });

  it('low-battery squads resupply at a covered cell and resume at the return threshold', () => {
    // ~25% battery: below the 3000 bp resupply threshold but above
    // empty (a fully drained unit has zero move speed by design).
    const drained = (c: unknown, init: Record<string, number>) =>
      c === CargoStore && (init['cap0'] ?? 0) > 0
        ? { ...init, amt0: Math.floor((init['cap0'] ?? 0) / 4), since0: 1 }
        : init;
    // The base generates energy (+2/cycle) so the battery refills
    // gradually — a guaranteed resupply window before the return.
    const w = world({
      entities: [
        { parts: structureInit(BASE, 2, 2) },
        ...[0, 1].map((i) => ({
          parts: robotInit(ROBOT, 6 + i, 4, drained),
          faction: 1,
        })),
      ],
    });
    w.issue('frontline_td:squads.create', {
      units: w.handles.slice(1).map((h) => Number(h)),
    });
    w.issue('frontline_td:squads.order', { squad: 1, kind: 'advance', x: 24, y: 4 });
    // The warehouse refills the batteries; once the mean reaches 8000 bp
    // the squad leaves resupply and resumes its order.
    let sawResupply = false;
    let back = false;
    for (let t = 0; t < 4000 && !back; t++) {
      w.sim.step();
      const sq = squad(w);
      sawResupply ||= sq?.phase === 'resupplying';
      back = sq?.phase !== 'resupplying' && (sq?.meanEnergyBp ?? 0) >= 8000;
    }
    expect(sawResupply).toBe(true);
    expect(back).toBe(true);
  });

  it('reinforcements join the issuer squad with the largest deficit', () => {
    const spawner: SimModule = {
      id: 'frontline_td:test.emitter',
      install(builder) {
        builder.system({
          id: 'frontline_td:test.emitter',
          phase: 'command',
          emits: [SpawnIntent],
          run(ctx) {
            if (ctx.tick === 2) {
              ctx.emit(SpawnIntent, {
                faction: 1,
                kind: 'frontline_td:robot',
                x: 6.5,
                y: 4.5,
                source: 0,
              });
            }
          },
        });
      },
    };
    const w = world({ entities: robots(1, 4, 4), withUnits: true, extraModules: [spawner] });
    w.issue('frontline_td:squads.create', {
      units: w.handles.map((h) => Number(h)),
      strength: 3,
    });
    run(w, 20);
    // Squad 1 has deficit 2 — the spawned robot joins it.
    expect(squad(w)?.members?.length).toBe(2);
  });

  it('gather stores a route and launches into advance at launchTick', () => {
    const w = world({ entities: robots(2, 4, 4) });
    createAll(w);
    w.issue('frontline_td:squads.gather', {
      squad: 1,
      x: 6,
      y: 4,
      launchTick: 40,
      targetX: 20,
      targetY: 4,
    });
    run(w, 2);
    const early = squad(w);
    expect(early?.order.kind).toBe('gather');
    expect((early?.route?.length ?? 0) > 0).toBe(true);
    run(w, 50);
    expect(squad(w)?.order.kind).toBe('advance');
  });

  it('gather launch fires at launchTick even while resupplying', () => {
    const drained = (c: unknown, init: Record<string, number>) =>
      c === CargoStore && (init['cap0'] ?? 0) > 0
        ? { ...init, amt0: Math.floor((init['cap0'] ?? 0) / 4), since0: 1 }
        : init;
    // 25% battery, no covered cell anywhere: resupply engages and can
    // never release — the scheduled launch must still fire on time.
    const w = world({
      entities: [0, 1].map((i) => ({
        parts: robotInit(ROBOT, 6 + i, 4, drained),
        faction: 1,
      })),
    });
    createAll(w);
    w.issue('frontline_td:squads.gather', {
      squad: 1,
      x: 8,
      y: 4,
      launchTick: 40,
      targetX: 20,
      targetY: 4,
    });
    let resupplied = false;
    for (let t = 0; t < 60; t++) {
      w.sim.step();
      resupplied ||= squad(w)?.phase === 'resupplying';
    }
    expect(resupplied).toBe(true);
    expect(squad(w)?.order.kind).toBe('advance');
    expect(Math.abs((squad(w)?.order.x ?? 0) - 20)).toBeLessThan(0.5);
  });

  it('battery-less members on a recycled entity id never trigger resupply', () => {
    // A drained robot dies (t=5) and a battery-less crawler spawns
    // (t=6): ids recycle, so the crawler reuses the dead robot's id and
    // its stale CargoStore slots. meanEnergyBp must skip non-CargoStore
    // entities, so the squad never resupplies and launches on time.
    const crawler = loadContent().units.byId('frontline_td:crawler');
    if (crawler === undefined) {
      throw new Error('crawler missing');
    }
    const drained = (c: unknown, init: Record<string, number>) =>
      c === CargoStore && (init['cap0'] ?? 0) > 0
        ? { ...init, amt0: Math.floor((init['cap0'] ?? 0) / 4), since0: 1 }
        : init;
    let crawlerHandle = 0 as EntityHandle;
    // `w` is captured by the swap system before its initializer runs.
    const wRef: { world?: World } = {};
    const swap: SimModule = {
      id: 'frontline_td:test.id_reuse',
      install(builder) {
        builder.system({
          id: 'frontline_td:test.id_reuse.go',
          phase: 'cleanup',
          run(ctx) {
            if (ctx.tick === 5) {
              const h = wRef.world?.handles[0];
              if (h !== undefined) {
                ctx.despawn(h);
              }
            }
            if (ctx.tick === 6) {
              crawlerHandle = ctx.spawn([
                [Faction, { id: 1 }],
                [InWorld],
                ...robotInit(crawler, 6, 4),
              ]);
            }
          },
        });
      },
    };
    const w = world({
      entities: [{ parts: robotInit(ROBOT, 6, 4, drained), faction: 1 }],
      extraModules: [swap],
    });
    wRef.world = w;
    run(w, 10);
    expect(handleId(crawlerHandle)).toBe(handleId(w.handles[0] ?? (0 as EntityHandle)));
    w.issue('frontline_td:squads.create', { units: [Number(crawlerHandle)] });
    w.issue('frontline_td:squads.gather', {
      squad: 1,
      x: 8,
      y: 4,
      launchTick: 40,
      targetX: 20,
      targetY: 4,
    });
    let resupplied = false;
    for (let t = 0; t < 60; t++) {
      w.sim.step();
      resupplied ||= squad(w)?.phase === 'resupplying';
    }
    expect(resupplied).toBe(false);
    expect(squad(w)?.order.kind).toBe('advance');
  });

  it('guard keeps the engaged target inside the leash and returns after it leaves', () => {
    // High-HP hostile so it survives the chase long enough to observe it.
    const tough = (c: unknown, init: Record<string, number>) =>
      c === Health ? { ...init, hp: 10_000_000, max: 10_000_000 } : init;
    const w = world({
      entities: [...robots(2, 4, 4), { parts: robotInit(ROBOT, 7, 4, tough), faction: 2 }],
      factions: [1, 2],
    });
    const hostile = Number(w.handles[2]);
    w.issue('frontline_td:squads.create', {
      units: w.handles.slice(0, 2).map((h) => Number(h)),
    });
    w.issue('frontline_td:squads.order', { squad: 1, kind: 'guard', x: 5, y: 4, radius: 3 });
    run(w, 20);
    expect(squad(w)?.phase).toBe('engaging');
    // The hostile walks to ~8.5: outside the radius (3) but inside the
    // leash (3 + 4). The guard keeps chasing it.
    w.issue(MoveCommand.type, { units: [hostile], x: 8, y: 4 }, F2);
    run(w, 80);
    expect(squad(w)?.phase).toBe('engaging');
    // Now beyond the leash: the guard breaks off and returns to the
    // guard point.
    w.issue(MoveCommand.type, { units: [hostile], x: 22, y: 4 }, F2);
    run(w, 200);
    const sq = squad(w);
    expect(sq?.phase).toBe('holding');
    expect(Math.abs((sq?.centroid.x ?? 0) - 5)).toBeLessThan(3);
  });

  it('engage split stops in-range members and closes the rest', () => {
    const w = world({
      entities: [
        { parts: robotInit(ROBOT, 1, 4) },
        { parts: robotInit(ROBOT, 7, 4) },
        { parts: robotInit(ROBOT, 9, 4), faction: 2 },
      ],
      factions: [1, 2],
    });
    w.issue('frontline_td:squads.create', {
      units: w.handles.slice(0, 2).map((h) => Number(h)),
    });
    w.issue('frontline_td:squads.order', { squad: 1, kind: 'guard', x: 6, y: 4, radius: 4 });
    const startA = w.pos(1).x;
    const startB = w.pos(0).x;
    run(w, 60);
    // Member 1 was inside weapon range (5) of the hostile → stopped;
    // member 0 was out of range → moved in.
    expect(Math.abs(w.pos(1).x - startA)).toBeLessThan(0.6);
    expect(w.pos(0).x).toBeGreaterThan(startB + 1);
  });

  it('a blocked advance attacks the wall segment and proceeds after it falls', () => {
    // A real blocking depot (placed via `starts`, so its footprint is
    // blocked) seals the corridor's only gap.
    const w = world({
      rows: CORRIDOR,
      entities: robots(2, 4, 9),
      factions: [1, 2],
      starts: [{ faction: F2, units: [], structures: [{ kind: DEPOT.index, x: 15, y: 9 }] }],
    });
    createAll(w);
    w.issue('frontline_td:squads.order', { squad: 1, kind: 'advance', x: 20, y: 10 });
    run(w, 1400);
    // The retarget BFS lands the squad next to the wall; it destroys
    // the depot, the route opens, and the advance completes.
    expect(w.structHp(0)).toBe(-1);
    const sq = squad(w);
    expect(sq?.order.kind).toBe('guard');
    expect(Math.abs((sq?.centroid.x ?? 0) - 20.5)).toBeLessThan(2.5);
  });

  it('retargets onto a wall placed after the advance started', () => {
    const w = world({
      rows: CORRIDOR,
      entities: robots(2, 4, 9),
      factions: [1, 2],
      walls: [{ tick: 40, kind: DEPOT, x: 15, y: 9 }],
    });
    createAll(w);
    w.issue('frontline_td:squads.order', { squad: 1, kind: 'advance', x: 20, y: 10 });
    run(w, 900);
    // The wall appears mid-route: the reachability re-check catches it
    // and the retargeted squad attacks the depot (damaged or fallen).
    expect(w.structHp(0)).toBeLessThan((DEPOT.hp ?? 0) * 1000);
  });

  it('a moving squad does not re-emit move intents (no slot reshuffles)', () => {
    const w = world({
      entities: [{ parts: robotInit(ROBOT, 4, 3) }, { parts: robotInit(ROBOT, 4, 8) }],
    });
    createAll(w);
    // Far gather point: the first update sends the squad, and every
    // later update must leave goal and slot targets untouched (a
    // re-emit would reshuffle assignSlots while members walk).
    w.issue('frontline_td:squads.gather', {
      squad: 1,
      x: 20,
      y: 5,
      launchTick: 10000,
      targetX: 25,
      targetY: 8,
    });
    run(w, 15); // past the first staggered update
    const seen = [w.tgtGoal(0), w.tgtSlot(0), w.tgtGoal(1), w.tgtSlot(1)];
    run(w, 50); // five more updates, still in transit
    expect([w.tgtGoal(0), w.tgtSlot(0), w.tgtGoal(1), w.tgtSlot(1)]).toEqual(seen);
  });

  it('a member stopped next to a large structure actually fires (fire-test reach)', () => {
    // The 4×4 base's hit radius puts it inside weapon reach even though
    // its centre is beyond the raw weapon range.
    const w = world({
      entities: [
        { parts: robotInit(ROBOT, 6, 5) },
        { parts: structureInit(BASE, 10, 4), faction: 2 },
      ],
      factions: [1, 2],
    });
    w.issue('frontline_td:squads.create', { units: [Number(w.handles[0])] });
    w.issue('frontline_td:squads.order', { squad: 1, kind: 'guard', x: 6, y: 5, radius: 8 });
    const startX = w.pos(0).x;
    run(w, 120);
    expect(Math.abs(w.pos(0).x - startX)).toBeLessThan(1);
    expect(w.structHp(0)).toBeLessThan((BASE.hp ?? 0) * 1000);
  });

  it('each squad updates on its own stagger slot', () => {
    const w = world({
      entities: [{ parts: robotInit(ROBOT, 4, 4) }, { parts: robotInit(ROBOT, 8, 4) }],
    });
    w.issue('frontline_td:squads.create', { units: [Number(w.handles[0])] });
    w.issue('frontline_td:squads.create', { units: [Number(w.handles[1])] });
    run(w, 2);
    w.issue('frontline_td:squads.order', { squad: 1, kind: 'advance', x: 25, y: 4 });
    w.issue('frontline_td:squads.order', { squad: 2, kind: 'advance', x: 25, y: 4 });
    const startX = [w.pos(0).x, w.pos(1).x];
    let firstMove0 = -1;
    let firstMove1 = -1;
    for (let t = 0; t < 30 && (firstMove0 < 0 || firstMove1 < 0); t++) {
      w.sim.step();
      if (firstMove0 < 0 && w.pos(0).x !== startX[0]) {
        firstMove0 = w.sim.tick;
      }
      if (firstMove1 < 0 && w.pos(1).x !== startX[1]) {
        firstMove1 = w.sim.tick;
      }
    }
    // Squad 2 fires on (tick + 2) % 10 === 0, squad 1 one tick later
    // (the position probe can lag the intent tick by one).
    expect((firstMove1 + 2) % 10).toBeLessThanOrEqual(1);
    expect(firstMove0).toBe(firstMove1 + 1);
  });

  it('mixed-unit role formation places vanguard ahead of backline without invalid heavy cells', () => {
    const db = loadContent();
    const crawler = db.units.byId('frontline_td:crawler');
    const spitter = db.units.byId('frontline_td:spitter');
    if (crawler === undefined || spitter === undefined) {
      throw new Error('crawler/spitter missing');
    }
    const heavy = { ...ROBOT, radius: 0.8 };
    // Start spitters ahead of crawlers/heavies so the settled order proves
    // role-based slot assignment rather than initial spawn order.
    const entities = [
      { parts: robotInit(crawler, 3, 9) },
      { parts: robotInit(crawler, 3, 10) },
      { parts: robotInit(heavy, 2, 7) },
      { parts: robotInit(heavy, 2, 11) },
      { parts: robotInit(spitter, 4, 8) },
      { parts: robotInit(spitter, 4, 9) },
      { parts: robotInit(spitter, 4, 10) },
      { parts: robotInit(spitter, 4, 11) },
    ];
    const w = world({ entities });
    createAll(w);
    w.issue('frontline_td:squads.order', { squad: 1, kind: 'advance', x: 20, y: 10 });
    run(w, 400);

    expect(squad(w)?.order.kind).toBe('guard');
    const slots = entities.map((_, i) => w.tgtSlot(i));
    expect(new Set(slots).size).toBe(entities.length);

    const positions = entities.map((_, i) => w.pos(i));
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        if (a !== undefined && b !== undefined) {
          expect(distance(a.x, a.y, b.x, b.y)).toBeGreaterThanOrEqual(0.6);
        }
      }
    }

    const crawlerAvgX = (w.pos(0).x + w.pos(1).x) / 2;
    const heavyAvgX = (w.pos(2).x + w.pos(3).x) / 2;
    const spitterAvgX = (w.pos(4).x + w.pos(5).x + w.pos(6).x + w.pos(7).x) / 4;
    expect(crawlerAvgX).toBeGreaterThan(spitterAvgX);
    expect(heavyAvgX).toBeGreaterThan(spitterAvgX);
    const maxSpitterX = Math.max(w.pos(4).x, w.pos(5).x, w.pos(6).x, w.pos(7).x);
    expect(Math.min(w.pos(0).x, w.pos(1).x)).toBeGreaterThan(maxSpitterX);

    for (const i of [2, 3]) {
      const p = w.pos(i);
      const ax = clearanceAnchorCell(p.x, CLEARANCE_HEAVY);
      const ay = clearanceAnchorCell(p.y, CLEARANCE_HEAVY);
      expect(ax).toBeGreaterThanOrEqual(0);
      expect(ax + 1).toBeLessThan(30);
      expect(ay).toBeGreaterThanOrEqual(0);
      expect(ay + 1).toBeLessThan(20);
    }
  });

  it('persistent slots prevent distant reinforcements from displacing settled members', () => {
    const entities = [
      ...[0, 1, 2, 3, 4].map((dy) => ({ parts: robotInit(ROBOT, 6, 8 + dy) })),
      ...[0, 1, 2, 3, 4].map((dy) => ({ parts: robotInit(ROBOT, 7, 8 + dy) })),
      { parts: robotInit(ROBOT, 2, 10) },
    ];
    const w = world({ entities });
    w.issue('frontline_td:squads.create', {
      units: w.handles.slice(0, 10).map((h) => Number(h)),
    });
    w.issue('frontline_td:squads.order', { squad: 1, kind: 'advance', x: 16, y: 10 });
    run(w, 200);
    expect(squad(w)?.order.kind).toBe('guard');
    expect(squad(w)?.phase).toBe('holding');

    const beforeGoals = Array.from({ length: 10 }, (_, i) => w.tgtGoal(i));
    const beforeSlots = Array.from({ length: 10 }, (_, i) => w.tgtSlot(i));
    const beforePos = Array.from({ length: 10 }, (_, i) => w.pos(i));
    expect(new Set(beforeSlots).size).toBe(10);

    w.issue('frontline_td:squads.assign', { squad: 1, units: [Number(w.handles[10])] });
    run(w, 300);

    expect(squad(w)?.members?.length).toBe(11);
    for (let i = 0; i < 10; i++) {
      expect(w.tgtGoal(i)).toBe(beforeGoals[i]);
      expect(w.tgtSlot(i)).toBe(beforeSlots[i]);
      const p = w.pos(i);
      const prev = beforePos[i];
      if (prev !== undefined) {
        expect(distance(p.x, p.y, prev.x, prev.y)).toBeLessThan(0.4);
      }
    }

    const newcomerSlot = w.tgtSlot(10);
    expect(beforeSlots).not.toContain(newcomerSlot);
    const newcomerPos = w.pos(10);
    expect(distance(newcomerPos.x, newcomerPos.y, 16, 10)).toBeLessThan(6);
    for (let i = 0; i < 10; i++) {
      const p = w.pos(i);
      expect(distance(newcomerPos.x, newcomerPos.y, p.x, p.y)).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('chokepoint compresses formation laterally and re-expands past the gap', () => {
    const entities = [
      ...[0, 1, 2, 3, 4, 5].map((dy) => ({ parts: robotInit(ROBOT, 3, 7 + dy) })),
      ...[0, 1, 2, 3, 4, 5].map((dy) => ({ parts: robotInit(ROBOT, 4, 7 + dy) })),
    ];
    const w = world({ rows: CORRIDOR, entities });
    createAll(w);
    w.issue('frontline_td:squads.order', { squad: 1, kind: 'advance', x: 24, y: 10 });

    const spreadY = () => {
      const ys = entities.map((_, i) => w.pos(i).y);
      return Math.max(...ys) - Math.min(...ys);
    };

    const initialSpread = spreadY();
    let minChokeSpread = Infinity;
    for (let t = 0; t < 450; t++) {
      w.sim.step();
      const cx = squad(w)?.centroid.x ?? 0;
      if (cx >= 13 && cx <= 17) {
        minChokeSpread = Math.min(minChokeSpread, spreadY());
      }
    }

    for (let i = 0; i < entities.length; i++) {
      expect(w.pos(i).x).toBeGreaterThan(18);
    }
    const postChokeSpread = spreadY();
    expect(minChokeSpread).toBeLessThan(initialSpread);
    expect(postChokeSpread).toBeGreaterThan(2.0);
  });

  it('march cruise-speed sync keeps mixed speeds cohesive and combat releases guide', () => {
    const db = loadContent();
    const raider = db.units.byId('frontline_td:raider');
    const spitter = db.units.byId('frontline_td:spitter');
    if (raider === undefined || spitter === undefined) {
      throw new Error('raider/spitter missing');
    }
    const wideRows = Array.from({ length: 20 }, () => '.'.repeat(40));

    // Part 1: open march sync keeps fast raider (3.5) cohesive with slow spitter (2.2).
    const wMarch = world({
      rows: wideRows,
      entities: [{ parts: robotInit(raider, 2, 9) }, { parts: robotInit(spitter, 2, 10) }],
    });
    createAll(wMarch);
    wMarch.issue('frontline_td:squads.order', { squad: 1, kind: 'advance', x: 34, y: 10 });
    run(wMarch, 120);
    expect(wMarch.pos(0).x).toBeGreaterThan(10);
    expect(wMarch.pos(1).x).toBeGreaterThan(10);
    expect(Math.abs(wMarch.pos(0).x - wMarch.pos(1).x)).toBeLessThanOrEqual(3.5);

    const savedMarch = wMarch.sim.serialize() as {
      entities: { data: Record<string, Record<string, Record<string, number>>> };
      moduleStates: {
        'frontline_td:squads': { squads: Array<{ guideActive?: boolean }> };
      };
    };
    expect(savedMarch.moduleStates['frontline_td:squads'].squads[0]?.guideActive).toBe(true);
    const guideEntries = Object.values(savedMarch.entities.data).map(
      (c) => c['frontline_td:movement.formation_guide']?.['active'] ?? 0,
    );
    expect(guideEntries.some((a) => a === 1)).toBe(true);

    // Part 2: engaging a hostile clears FormationGuide and releases raider at full 3.5 speed.
    const tough = (c: unknown, init: Record<string, number>) =>
      c === Health ? { ...init, hp: 10_000_000, max: 10_000_000 } : init;
    const wCombat = world({
      rows: wideRows,
      entities: [
        { parts: robotInit(raider, 2, 9), faction: 1 },
        { parts: robotInit(spitter, 2, 10), faction: 1 },
        { parts: robotInit(ROBOT, 24, 10, tough), faction: 2 },
      ],
      factions: [1, 2],
    });
    wCombat.issue('frontline_td:squads.create', {
      units: wCombat.handles.slice(0, 2).map((h) => Number(h)),
    });
    wCombat.issue('frontline_td:squads.order', { squad: 1, kind: 'advance', x: 34, y: 10 });
    let engagedTick = -1;
    for (let t = 0; t < 250; t++) {
      wCombat.sim.step();
      if (squad(wCombat)?.phase === 'engaging') {
        engagedTick = t + 1;
        break;
      }
    }
    expect(engagedTick).toBeGreaterThan(0);

    const savedEngage = wCombat.sim.serialize() as {
      entities: { data: Record<string, Record<string, Record<string, number>>> };
      moduleStates: {
        'frontline_td:squads': { squads: Array<{ guideActive?: boolean }> };
      };
    };
    expect(savedEngage.moduleStates['frontline_td:squads'].squads[0]?.guideActive).toBeUndefined();
    for (const comp of Object.values(savedEngage.entities.data)) {
      expect(comp['frontline_td:movement.formation_guide']?.['active'] ?? 0).toBe(0);
    }

    const raiderStart = wCombat.pos(0).x;
    run(wCombat, 20);
    // Full speed is 3.5 cells/s vs cruise 2.2 cells/s; verify clear > 2.8 cells/s advance.
    expect(wCombat.pos(0).x - raiderStart).toBeGreaterThan(2.8);
  });
});
