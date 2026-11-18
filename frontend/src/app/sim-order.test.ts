// Module registration order is load-bearing (ADR 0043): within a phase
// systems run in registration order, and the cleanup phase interleaves
// structural ops. Verified empirically — moving combat's module earlier
// diverges the match-smoke golden hash, because the queued despawn order
// changes the entity free-list and therefore which ids later spawns
// reuse. These assertions pin the order the sim depends on.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/index';
import type { ResolvedMap } from '../content/index';
import { toFactionId } from '../core/index';
import { createSimulation } from '../kernel/index';
import type { SimConfig } from '../kernel/index';
import type { TerrainGrid } from '../features/terrain/content';
import { must } from '../testing/index';
import { createSimModules, RNG_STREAMS } from './sim-registry';

const F1 = toFactionId(1);
const F2 = toFactionId(2);
const DB = loadContent();

const W = 4;
const H = 4;
const GROUND = must(DB.surfaces.byId('frontline_td:ground'), 'ground').index;
const MAP: ResolvedMap = {
  id: 'frontline_td:test.order' as ResolvedMap['id'],
  index: 998,
  width: W,
  height: H,
  points: {},
  grid: {
    width: W,
    height: H,
    heights: new Uint8Array(W * H),
    surfaces: new Uint16Array(W * H).fill(GROUND),
    ramps: new Uint8Array(W * H),
  } satisfies TerrainGrid,
};

// Global execution position of a system: modules are registered in array
// order, systems inside a module in builder order — the same order the
// kernel executes within a shared phase.
function executionIndex(
  manifest: ReturnType<ReturnType<typeof createSimulation>['describe']>,
  systemId: string,
): [number, number] {
  for (let m = 0; m < manifest.modules.length; m++) {
    const systems = manifest.modules[m]?.systems ?? [];
    const s = systems.findIndex((sys) => sys.id === systemId);
    if (s !== -1) {
      return [m, s];
    }
  }
  throw new Error(`system ${systemId} not in manifest`);
}

describe('sim module order', () => {
  it('runs cleanup readers of combat.died before combat.despawn', () => {
    const sim = createSimulation(
      {
        seed: 1,
        factions: [{ id: F1 }, { id: F2 }],
        relations: [],
        grid: { width: W, height: H },
        rngStreams: [...RNG_STREAMS],
        controllers: [],
      } satisfies SimConfig,
      createSimModules(DB, MAP, []).modules,
    );
    const manifest = sim.describe();
    const despawn = executionIndex(manifest, 'frontline_td:combat.despawn');
    const releaseDead = executionIndex(manifest, 'frontline_td:movement.release_dead');
    const freeDead = executionIndex(manifest, 'frontline_td:construction.free_dead');
    expect(releaseDead < despawn).toBe(true);
    expect(freeDead < despawn).toBe(true);
  });
});
