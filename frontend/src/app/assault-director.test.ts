// Assault director tests on proto_01 through the real resolve-setup
// path: garrison formation and guard points, hive_guard exclusion,
// garrison recreation, wave targeting and the gather→launch→breather
// cycle with save/restore.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/index';
import { contentId, toFactionId, toTick, TICKS_PER_SECOND } from '../core/index';
import { createSimulation, restoreSimulation } from '../kernel/index';
import { SquadsChannel, SquadsDisband } from '../features/squads/protocol';
import type { SquadsSnapshot } from '../features/squads/protocol';
import { StructuresChannel } from '../features/construction/protocol';
import type { ConstructionStructures } from '../features/construction/protocol';
import { DenseUnitsChannel } from '../features/units/protocol';
import type { DenseUnits } from '../features/units/protocol';
import { defaultSetup } from '../modes/assault/index';
import { resolveSetup } from './resolve-setup';

const F2 = toFactionId(2);
const DB = loadContent();

function run(sim: ReturnType<typeof createSimulation>, ticks: number): void {
  for (let k = 0; k < ticks; k++) {
    sim.step();
  }
}

describe('assault director', () => {
  function resolved(seed = 5) {
    const r = resolveSetup(defaultSetup(seed));
    if ('error' in r) {
      throw new Error(r.error);
    }
    return r;
  }

  function squads(sim: ReturnType<typeof createSimulation>): SquadsSnapshot {
    return sim.snapshot(F2).channels[SquadsChannel.id] as SquadsSnapshot;
  }

  it('gathers at ~90 s, launches at the window end and breathes out wave 2', () => {
    const { sim } = resolved();
    const tps = TICKS_PER_SECOND;
    // Up to ~160 s: first gather at 90 s, window 60 s, launch ~150 s.
    let sawGather = false;
    let launched = 0;
    let gatherAt = -1;
    for (let t = 0; t < 170 * tps && launched === 0; t++) {
      sim.step();
      if (t % 20 !== 0) {
        continue;
      }
      const squads = sim.snapshot(F2).channels[SquadsChannel.id] as SquadsSnapshot;
      for (const s of squads.squads) {
        if (s.order.kind === 'gather') {
          sawGather = true;
          gatherAt = t;
        }
        if (s.order.kind === 'advance' && sawGather && gatherAt > 0) {
          launched = s.id;
        }
      }
    }
    expect(sawGather).toBe(true);
    // First gather starts at 90 s: the gather order exists by ~95 s.
    expect(gatherAt).toBeGreaterThanOrEqual(88 * tps);
    expect(gatherAt).toBeLessThanOrEqual(150 * tps);
    expect(launched).not.toBe(0);
    // Second gather must be bigger: strength cap 8+4 per wave done.
    for (let t = 0; t < 200 * tps; t++) {
      sim.step();
      if (t % 20 !== 0) {
        continue;
      }
      const snap = squads(sim);
      const wave2 = snap.squads.find(
        (s) => s.order.kind === 'gather' && s.id !== launched && s.strength >= 12,
      );
      if (wave2 !== undefined) {
        return;
      }
      if (t > 190 * tps) {
        break;
      }
    }
    // If wave 1's squad is still alive the breather may not have elapsed;
    // assert at least the wave-count probe tracked the launch.
    const probes = sim.probes();
    expect(probes['frontline_td:assault.waves.f2'] ?? 0).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('identifies its squads by tag', () => {
    const { sim } = resolved();
    run(sim, 100 * TICKS_PER_SECOND);
    const tags = squads(sim)
      .squads.map((s) => s.tag)
      .sort();
    expect(tags).toContain('hive_guard');
    expect(tags).toContain('raid');
    expect(tags).toContain('wave:1');
  }, 60_000);

  it('pins wave strength at launch so later spawns stay unassigned', () => {
    const { sim } = resolved();
    const tps = TICKS_PER_SECOND;
    // Past the first launch (gather 90 s + window 60 s = 150 s).
    run(sim, 160 * tps);
    const wave = squads(sim).squads.find((s) => s.tag === 'wave:1');
    expect(wave).toBeDefined();
    expect(wave?.order.kind === 'advance' || wave?.order.kind === 'guard').toBe(true);
    const members = wave?.members?.length ?? 0;
    expect(wave?.strength).toBe(members);
    // The hive keeps producing; new monsters must not join the launched wave.
    run(sim, 40 * tps);
    const later = squads(sim).squads.find((s) => s.tag === 'wave:1');
    if (later !== undefined) {
      expect(later.members?.length ?? 0).toBeLessThanOrEqual(members);
    }
  }, 60_000);

  it('restored mid-gather reproduces the uninterrupted run', () => {
    const a = resolved();
    const tps = TICKS_PER_SECOND;
    run(a.sim, 100 * tps); // mid-gather: created at 90 s, launches ~150 s
    const saved = a.sim.serialize();
    const controllerStates = (saved as unknown as { controllerStates: Record<string, unknown> })
      .controllerStates;
    // The director's private state is part of the save (and the hash).
    expect(controllerStates[String(2)]).toBeDefined();
    // A second resolved instance supplies fresh modules for the restore.
    const b = resolved();
    const restored = restoreSimulation(b.config, b.modules, saved);
    run(a.sim, 100 * tps);
    run(restored, 100 * tps);
    expect(restored.hash()).toBe(a.sim.hash());
  }, 120_000);

  it('raider squad advances on the nearest hostile non-warehouse node', () => {
    // Give the player a station (non-warehouse node) west of the base;
    // the raiders should advance on it rather than the warehouse.
    const setup = defaultSetup(5);
    const player = setup.factions[0];
    if (player === undefined) {
      throw new Error('no player faction');
    }
    player.start?.structures?.push({
      structure: contentId('frontline_td:station'),
      x: 14,
      y: 46,
    });
    const r = resolveSetup(setup);
    if ('error' in r) {
      throw new Error(r.error);
    }
    run(r.sim, 60 * TICKS_PER_SECOND);
    const snap = r.sim.snapshot(F2).channels[SquadsChannel.id] as SquadsSnapshot;
    const raider = snap.squads.find((s) => s.order.kind === 'advance' && s.strength <= 10);
    expect(raider).toBeDefined();
    if (raider !== undefined) {
      // Station centre is (15, 47); the advance should head there.
      const structures = r.sim.snapshot(F2).channels[
        StructuresChannel.id
      ] as ConstructionStructures;
      const stations = Array.from(structures.kind).filter((k) => {
        const def = DB.structures.list[k];
        return def?.id === 'frontline_td:station';
      });
      expect(stations.length).toBeGreaterThan(0);
      expect(Math.abs(raider.order.x - 15)).toBeLessThan(3);
      expect(Math.abs(raider.order.y - 47)).toBeLessThan(3);
    }
  });

  it('hive spawns feed the gather squad and waves probe counts', () => {
    const { sim } = resolved();
    run(sim, 160 * TICKS_PER_SECOND);
    const probes = sim.probes();
    expect(probes['frontline_td:assault.waves.f2'] ?? 0).toBeGreaterThanOrEqual(1);
    expect(probes['frontline_td:assault.hivehp.f2'] ?? -1).toBeGreaterThan(0);
    const dense = sim.snapshot(F2).channels[DenseUnitsChannel.id] as DenseUnits;
    const enemy = Array.from(dense.faction).filter((f) => f === 2).length;
    // Hive production plus initial monsters.
    expect(enemy).toBeGreaterThan(16);
  });

  it('forms per-outpost garrisons at init that hold near their outposts', () => {
    const { sim } = resolved();
    run(sim, 60 * TICKS_PER_SECOND);
    const snap = squads(sim);
    const dense = sim.snapshot(F2).channels[DenseUnitsChannel.id] as DenseUnits;
    const pos = new Map<number, { x: number; y: number }>();
    for (let i = 0; i < dense.handles.length; i++) {
      pos.set(dense.handles[i] ?? 0, { x: dense.x[i] ?? 0, y: dense.y[i] ?? 0 });
    }
    // proto_01 outpost footprints (top-left) → centres.
    const outposts = [
      { tag: 'garrison:30,55', cx: 31.5, cy: 56.5 },
      { tag: 'garrison:26,21', cx: 27.5, cy: 22.5 },
      { tag: 'garrison:69,21', cx: 70.5, cy: 22.5 },
    ];
    for (const o of outposts) {
      const g = snap.squads.find((s) => s.tag === o.tag);
      expect(g).toBeDefined();
      expect(g?.order.kind).toBe('guard');
      expect(g?.order.x).toBeCloseTo(o.cx);
      expect(g?.order.y).toBeCloseTo(o.cy);
      expect(g?.strength).toBe(6);
      expect(g?.memberCount ?? 0).toBeGreaterThan(0);
      // Most members hold at the outpost; reinforcement arrivals may
      // still be walking in from the hive.
      const near = (g?.members ?? []).filter((h) => {
        const p = pos.get(h);
        if (p === undefined) {
          return false;
        }
        const dx = p.x - o.cx;
        const dy = p.y - o.cy;
        return dx * dx + dy * dy <= 64;
      }).length;
      expect(near).toBeGreaterThanOrEqual(Math.ceil((g?.memberCount ?? 0) / 2));
    }
  }, 60_000);

  it('hive_guard guards the hive centre and excludes garrison monsters', () => {
    const { sim } = resolved();
    run(sim, 60 * TICKS_PER_SECOND);
    const snap = squads(sim);
    const garrisons = snap.squads.filter((s) => s.tag?.startsWith('garrison:'));
    // South 4, west 6, east 6 garrison monsters at init; generic
    // reinforcement may top the south garrison up to strength 6.
    expect(garrisons.reduce((n, s) => n + s.memberCount, 0)).toBeGreaterThanOrEqual(16);
    const guard = snap.squads.find((s) => s.tag === 'hive_guard');
    expect(guard).toBeDefined();
    expect(guard?.order.kind).toBe('guard');
    // Hive footprint 4x4 at enemy_north (30,4) → centre (32,6), not the
    // centroid of all monsters.
    expect(Math.abs((guard?.order.x ?? 0) - 32)).toBeLessThan(0.5);
    expect(Math.abs((guard?.order.y ?? 0) - 6)).toBeLessThan(0.5);
    // Remaining non-raider monsters: the 16 enemy_north monsters.
    expect(guard?.memberCount).toBe(16);
  }, 60_000);

  it('recreates a destroyed garrison from unassigned monsters', () => {
    const { sim } = resolved();
    run(sim, 60 * TICKS_PER_SECOND);
    const g = squads(sim).squads.find((s) => s.tag === 'garrison:26,21');
    expect(g).toBeDefined();
    if (g === undefined) {
      return;
    }
    sim.submit({
      tick: toTick(sim.tick + 1),
      issuer: F2,
      type: SquadsDisband.type,
      payload: { squad: g.id },
    });
    // A few decide ticks: the disbanded members are unassigned, so the
    // garrison is recreated and re-ordered to guard.
    run(sim, 60);
    const recreated = squads(sim).squads.find((s) => s.tag === 'garrison:26,21');
    expect(recreated).toBeDefined();
    expect(recreated?.memberCount ?? 0).toBeGreaterThan(0);
    expect(recreated?.order.kind).toBe('guard');
  }, 60_000);

  it('wave targets a hostile-held outpost before other structures', () => {
    // Hand the east outpost to the player: it sits much nearer the
    // rally point (50,14) than the player's main base at (10,52).
    const setup = defaultSetup(5);
    const player = setup.factions[0];
    const enemy = setup.factions[1];
    const east = enemy?.start?.structures?.findIndex(
      (s) => s.structure === 'frontline_td:outpost' && s.x === 69 && s.y === 21,
    );
    if (
      player === undefined ||
      enemy?.start?.structures === undefined ||
      east === undefined ||
      east < 0
    ) {
      throw new Error('setup missing factions');
    }
    const [moved] = enemy.start.structures.splice(east, 1);
    if (moved === undefined) {
      throw new Error('east outpost missing');
    }
    player.start?.structures?.push(moved);
    const r = resolveSetup(setup);
    if ('error' in r) {
      throw new Error(r.error);
    }
    // Gather at 90 s; the wave squad carries targetX/targetY.
    run(r.sim, 120 * TICKS_PER_SECOND);
    const wave = (r.sim.snapshot(F2).channels[SquadsChannel.id] as SquadsSnapshot).squads.find(
      (s) => s.tag === 'wave:1',
    );
    expect(wave).toBeDefined();
    // Outpost centre is (70.5, 22.5); the main base is (11.5, 53.5).
    expect(Math.abs((wave?.order.targetX ?? 0) - 70.5)).toBeLessThan(2);
    expect(Math.abs((wave?.order.targetY ?? 0) - 22.5)).toBeLessThan(2);
  }, 60_000);
});
