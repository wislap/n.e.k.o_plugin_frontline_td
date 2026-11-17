// Dynamic blocker overlay (A4): passable/stepCost honour it for every class
// and diagonal leg, listeners fire on real changes only, the module mirrors
// it into the blocked layer, and it round-trips through save/restore.
import { describe, expect, it } from 'vitest';
import { contentId, toFactionId } from '../../../core/index';
import type { ResolvedSurface } from '../../../content/load';
import { createSimulation, restoreSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule } from '../../../kernel/index';
import { baseConfig } from '../../../kernel/testing/helpers';
import { TERRAIN_BLOCKED_LAYER_ID } from '../protocol';
import type { TerrainGrid } from '../content';
import { createTerrainModule } from './module';
import { createTerrainApi } from './terrain-api';

const CLS = 0;
const F1 = toFactionId(1);
const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
];

// 4x4 flat ground.
function makeGrid(): TerrainGrid {
  return {
    width: 4,
    height: 4,
    heights: new Uint8Array(16),
    surfaces: new Uint16Array(16),
    ramps: new Uint8Array(16),
  };
}

function config(grid: TerrainGrid): SimConfig {
  return { ...baseConfig({ rngStreams: [] }), grid: { width: grid.width, height: grid.height } };
}

describe('terrain blocked overlay', () => {
  it('makes cells impassable and blocks steps in and out for every class', () => {
    const api = createTerrainApi(makeGrid(), SURFACES);
    api.setBlocked([{ x: 1, y: 1 }], true);
    expect(api.blocked(1, 1)).toBe(true);
    expect(api.passable(1, 1, CLS)).toBe(false);
    expect(api.stepCost(0, 1, 1, 1, CLS)).toBe(-1); // into
    expect(api.stepCost(1, 1, 0, 1, CLS)).toBe(-1); // out of
    expect(api.stepCost(0, 0, 1, 0, CLS)).toBe(10); // unaffected step
    api.setBlocked([{ x: 1, y: 1 }], false);
    expect(api.stepCost(0, 1, 1, 1, CLS)).toBe(10);
  });

  it('blocks diagonal corner cutting through a blocked leg', () => {
    const api = createTerrainApi(makeGrid(), SURFACES);
    api.setBlocked([{ x: 1, y: 0 }], true);
    // (0,0) -> (1,1) diagonal: the (1,0) leg is blocked.
    expect(api.stepCost(0, 0, 1, 1, CLS)).toBe(-1);
    api.setBlocked([{ x: 1, y: 0 }], false);
    api.setBlocked([{ x: 0, y: 1 }], true);
    expect(api.stepCost(0, 0, 1, 1, CLS)).toBe(-1);
  });

  it('notifies listeners synchronously with the cells that actually changed', () => {
    const api = createTerrainApi(makeGrid(), SURFACES);
    const calls: { x: number; y: number }[][] = [];
    api.onBlockedChange((cells) => calls.push([...cells]));
    api.setBlocked(
      [
        { x: 1, y: 1 },
        { x: 9, y: 9 }, // out of bounds: ignored
      ],
      true,
    );
    api.setBlocked([{ x: 1, y: 1 }], true); // no change: no call
    api.setBlocked([{ x: 1, y: 1 }], false);
    expect(calls).toEqual([[{ x: 1, y: 1 }], [{ x: 1, y: 1 }]]);
  });

  it('mirrors the overlay into the blocked layer only when dirty', () => {
    const grid = makeGrid();
    const { module, api } = createTerrainModule(grid, SURFACES);
    const sim = createSimulation(config(grid), [module]);
    sim.step();
    let snapshot = sim.snapshot(F1);
    expect(snapshot.layers[TERRAIN_BLOCKED_LAYER_ID]?.[1 * 4 + 1]).toBe(0);
    api.setBlocked([{ x: 1, y: 1 }], true);
    sim.step();
    snapshot = sim.snapshot(F1);
    expect(snapshot.layers[TERRAIN_BLOCKED_LAYER_ID]?.[1 * 4 + 1]).toBe(1);
    expect(snapshot.changedLayers).toContain(TERRAIN_BLOCKED_LAYER_ID);
    sim.step();
    snapshot = sim.snapshot(F1);
    expect(snapshot.changedLayers).not.toContain(TERRAIN_BLOCKED_LAYER_ID);
  });

  it('mirrors blockers set in the construction phase before the tick boundary', () => {
    // Regression: construction runs after cleanup; if the mirror ran in
    // cleanup, a dirty flag surviving the boundary (unserialized) would
    // leave a restored sim's layer permanently stale.
    const grid = makeGrid();
    const make = () => {
      const { module, api } = createTerrainModule(grid, SURFACES);
      const site: SimModule = {
        id: 'frontline_td:test.site',
        install(builder) {
          builder.system({
            id: 'frontline_td:test.site.build',
            phase: 'construction',
            run(ctx) {
              if (ctx.tick === 1) {
                api.setBlocked([{ x: 3, y: 3 }], true);
              }
            },
          });
        },
      };
      return { api, modules: [module, site] as SimModule[] };
    };
    const a = make();
    const simA = createSimulation(config(grid), a.modules);
    simA.step();
    const saved = simA.serialize();
    simA.step();
    // The mirror ran in the same tick the blocker was set.
    expect(simA.snapshot(F1).layers[TERRAIN_BLOCKED_LAYER_ID]?.[3 * 4 + 3]).toBe(1);

    const b = make();
    const simB = restoreSimulation(config(grid), b.modules, saved);
    simB.step();
    expect(simB.hash()).toBe(simA.hash());
    expect(simB.snapshot(F1).layers[TERRAIN_BLOCKED_LAYER_ID]?.[3 * 4 + 3]).toBe(1);
  });

  it('save/restore round-trips the overlay with an identical hash', () => {
    const grid = makeGrid();
    const make = () => createTerrainModule(grid, SURFACES);
    const a = make();
    const simA = createSimulation(config(grid), [a.module]);
    simA.step();
    a.api.setBlocked([{ x: 2, y: 2 }], true);
    simA.step();
    const saved = simA.serialize();
    simA.step();

    const b = make();
    const simB = restoreSimulation(config(grid), [b.module], saved);
    expect(b.api.blocked(2, 2)).toBe(true);
    simB.step();
    expect(simB.hash()).toBe(simA.hash());
    expect(simB.snapshot(F1).layers[TERRAIN_BLOCKED_LAYER_ID]?.[2 * 4 + 2]).toBe(1);
  });
});
