// Assault director scenario: wave/raider target selection on proto_01
// with modified setups (extra player station; hostile-held outpost).
import { describe, expect, it } from 'vitest';
import { contentId } from '../core/index';
import { defaultSetup } from '../modes/assault/index';
import { resolveSetup } from './resolve-setup';
import { DB, TPS, run, squads, structures } from './test-world';

describe('assault targeting', () => {
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
    run(r.sim, 60 * TPS);
    const raider = squads(r.sim).squads.find((s) => s.order.kind === 'advance' && s.strength <= 10);
    expect(raider).toBeDefined();
    if (raider !== undefined) {
      // Station centre is (15, 47); the advance should head there.
      const stations = Array.from(structures(r.sim).kind).filter((k) => {
        const def = DB.structures.list[k];
        return def?.id === 'frontline_td:station';
      });
      expect(stations.length).toBeGreaterThan(0);
      expect(Math.abs(raider.order.x - 15)).toBeLessThan(3);
      expect(Math.abs(raider.order.y - 47)).toBeLessThan(3);
    }
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
    // Handing the outpost to the player also replaces its starting enemy
    // garrison so the outpost remains player-held until wave:1 gathers at 90s.
    enemy.start.units = enemy.start.units.filter((u) => !(u.x === moved.x && u.y === moved.y));
    player.start?.units.push({
      unit: contentId('frontline_td:robot'),
      x: moved.x,
      y: moved.y,
      count: 8,
    });
    const r = resolveSetup(setup);
    if ('error' in r) {
      throw new Error(r.error);
    }
    // Gather at 90 s; the wave squad carries targetX/targetY.
    run(r.sim, 120 * TPS);
    const wave = squads(r.sim).squads.find((s) => s.tag === 'wave:1');
    expect(wave).toBeDefined();
    // Outpost centre is (70.5, 22.5); the main base is (11.5, 53.5).
    expect(Math.abs((wave?.order.targetX ?? 0) - 70.5)).toBeLessThan(2);
    expect(Math.abs((wave?.order.targetY ?? 0) - 22.5)).toBeLessThan(2);
  }, 60_000);
});
