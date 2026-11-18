// CI determinism (M4 D): a balanced-bot assault match must hash identically
// across two runs, and a mid-match save restored into a fresh resolveSetup
// must reproduce the same final hash (controller state included).
// The two runs are shared: `a` saves at 90 s on the way to the end, so the
// restore check replays from the same serialized state.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../src/content/index';
import { toFactionId } from '../src/core/index';
import type { Serializable } from '../src/core/index';
import { restoreSimulation } from '../src/kernel/index';
import type { Simulation } from '../src/kernel/index';
import { defaultSetup } from '../src/modes/assault/index';
import { resolveSetup } from '../src/app/resolve-setup';
import { createBalancedBot } from './bots/balanced';

const PLAYER = toFactionId(1);
const ENEMY = toFactionId(2);
const TPS = 20;
const SAVE_TICK = 90 * TPS;
const END_TICK = 3 * 60 * TPS;

function resolved() {
  const db = loadContent();
  const map = db.maps.byId('frontline_td:proto_01');
  if (map === undefined) {
    throw new Error('proto_01 missing');
  }
  const r = resolveSetup(defaultSetup(7), {
    controllerFor: (faction) =>
      Number(faction) === Number(PLAYER)
        ? createBalancedBot({ faction: PLAYER, db, map, hostile: new Set([Number(ENEMY)]) })
        : undefined,
  });
  if ('error' in r) {
    throw new Error(r.error);
  }
  return r;
}

function run(sim: Simulation, until: number): void {
  while (Number(sim.tick) < until) {
    sim.step();
  }
}

describe('eval determinism', () => {
  let a: ReturnType<typeof resolved>;
  let hashA: string;
  let hashB: string;
  let saved: Serializable;

  beforeAll(() => {
    a = resolved();
    const b = resolved();
    run(a.sim, SAVE_TICK);
    saved = a.sim.serialize();
    run(a.sim, END_TICK);
    run(b.sim, END_TICK);
    hashA = a.sim.hash();
    hashB = b.sim.hash();
  }, 240_000);

  it('balanced-bot match hashes identically across two runs', () => {
    expect(hashA).toBe(hashB);
  });

  it('save at 90 s + restore reproduces the final hash', () => {
    const c = resolved();
    const restored = restoreSimulation(c.config, c.modules, saved);
    run(restored, END_TICK);
    expect(restored.hash()).toBe(hashA);
  }, 120_000);
});
