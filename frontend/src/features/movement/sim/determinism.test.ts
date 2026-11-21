// M2 movement determinism (B5): a scripted move scenario on proto_01 must
// hash identically across runs and across a mid-run save/restore.
import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '../../../core/index';
import { contentId, packHandle, toFactionId, toTick } from '../../../core/index';
import { loadContent } from '../../../content/load';
import { createSimulation, restoreSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule } from '../../../kernel/index';
import { createPathingModule } from '../../pathing/sim/index';
import { createTerrainModule } from '../../terrain/sim/index';
import { createUnitsModule } from '../../units/sim/index';
import { createMovementModule, MoveCommand } from './index';

const F1 = toFactionId(1);
const F2 = toFactionId(2);
const TICKS = 400;
// This world installs terrain + pathing + movement + units only. The
// golden was re-derived for Batch S2 (ADR 0053: smooth flow gradients,
// two-slope damped asymmetric separation, arrival hysteresis, and
// clearance-tier wall/corner margin clamping). Any further change to
// movement or those serialized inputs legitimately changes the hash;
// update it in the same commit with the reason.
const GOLDEN_HASH = 'b078e15a293e01ac';

function makeSim() {
  const db = loadContent();
  const map = db.maps.byId(contentId('frontline_td:proto_01'));
  if (map === undefined) {
    throw new Error('proto_01 missing');
  }
  const terrain = createTerrainModule(map.grid, db.surfaces.list);
  const pathing = createPathingModule(terrain.api, db.movementClasses.list.length);
  const movement = createMovementModule(terrain.api, pathing.api);
  const units = createUnitsModule(db, terrain.api, [
    { faction: F1, units: [{ kind: 0, x: 10, y: 52, count: 60 }] },
    { faction: F2, units: [{ kind: 0, x: 30, y: 4, count: 30 }] },
  ]);
  const modules: SimModule[] = [terrain.module, pathing.module, movement, units];
  const config: SimConfig = {
    seed: 99,
    factions: [{ id: F1 }, { id: F2 }],
    relations: [{ a: F1, b: F2, relation: 'hostile' }],
    grid: { width: map.width, height: map.height },
    rngStreams: [],
    controllers: [],
  };
  return { config, modules };
}

// Start-state ids are deterministic: faction 1 spawns first -> ids 1..60.
function commands(): CommandEnvelope[] {
  const all = Array.from({ length: 60 }, (_, i) => packHandle(i + 1, 0));
  return [
    { tick: toTick(5), issuer: F1, type: MoveCommand.type, payload: { units: all, x: 60, y: 30 } },
    {
      tick: toTick(120),
      issuer: F1,
      type: MoveCommand.type,
      payload: { units: all.slice(0, 20), x: 12, y: 50 },
    },
    {
      tick: toTick(250),
      issuer: F1,
      type: MoveCommand.type,
      payload: { units: all.slice(20, 40), x: 5, y: 55 },
    },
  ];
}

function runTo(sim: ReturnType<typeof createSimulation>, ticks: number): void {
  for (const envelope of commands()) {
    if ((envelope.tick as number) > sim.tick) {
      sim.submit(envelope);
    }
  }
  while (sim.tick < ticks) {
    sim.step();
  }
}

describe('movement determinism on proto_01', () => {
  it('run twice -> identical hash (golden)', () => {
    const a = makeSim();
    const b = makeSim();
    const simA = createSimulation(a.config, a.modules);
    const simB = createSimulation(b.config, b.modules);
    runTo(simA, TICKS);
    runTo(simB, TICKS);
    expect(simA.hash()).toBe(simB.hash());
    expect(simA.hash()).toBe(GOLDEN_HASH);
  });

  it('save/restore mid-run -> identical hash', () => {
    const a = makeSim();
    const simA = createSimulation(a.config, a.modules);
    runTo(simA, 200);
    const saved = simA.serialize();
    runTo(simA, TICKS);

    const b = makeSim();
    const simB = restoreSimulation(b.config, b.modules, saved);
    // Re-submit the commands that are still in the future after restore.
    runTo(simB, TICKS);
    expect(simB.hash()).toBe(simA.hash());
  });
});
