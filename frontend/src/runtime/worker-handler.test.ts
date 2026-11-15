import { describe, expect, it } from 'vitest';
import { defineGridLayer } from '../kernel/index';
import type { SimModule } from '../kernel/index';
import { createQueuedController, createSimulation } from '../kernel/index';
import { baseConfig, F1 } from '../kernel/testing/helpers';
import { basePackManifest } from '../content/packs';
import { toFactionId } from '../core/index';
import type { MatchSetup, WorkerToMain } from '../protocol/index';
import { createWorkerHandler } from './worker-handler';
import type { Resolved } from './worker-handler';

const WriteLayer = defineGridLayer('frontline_td:test.wh.write', 'u8', { perFaction: false });
const ReadLayer = defineGridLayer('frontline_td:test.wh.read', 'i32', { perFaction: true });
const WRITE_KEY = 'frontline_td:test.wh.write';
const READ_KEY = `frontline_td:test.wh.read#${F1}`;

// Writes the global layer every tick and the per-faction layer only on odd
// ticks, so delta posts can be told apart.
function layerModule(): SimModule {
  return {
    id: 'frontline_td:test.wh',
    install(builder) {
      const write = builder.claimLayerWriter(WriteLayer);
      const read = builder.claimLayerWriter(ReadLayer);
      builder.system({
        id: 'frontline_td:test.wh.writer',
        phase: 'command',
        run(ctx) {
          const view = ctx.writeLayer(write);
          view[0] = ctx.tick;
          if (ctx.tick % 2 === 1) {
            const perFaction = ctx.writeLayer(read, F1);
            perFaction[1] = ctx.tick;
          }
        },
      });
    },
  };
}

function setup(local = true): MatchSetup {
  return {
    formatVersion: 1,
    packs: [basePackManifest()],
    seed: 7,
    factions: [
      { id: F1, controller: local ? 'local' : 'none', carryIn: { unlocks: [] } },
      { id: toFactionId(2), controller: 'none', carryIn: { unlocks: [] } },
    ],
    relations: [],
  };
}

function makeHandler(modules: SimModule[] = [layerModule()]) {
  const posted: WorkerToMain[] = [];
  let now = 0;
  const handler = createWorkerHandler({
    post: (message) => {
      posted.push(message);
    },
    resolve: (): Resolved => {
      const localQueue = createQueuedController(F1);
      const sim = createSimulation(
        baseConfig({ factions: [{ id: F1 }, { id: toFactionId(2) }], controllers: [localQueue] }),
        modules,
      );
      return { sim, localQueue, observer: F1 };
    },
    now: () => now,
  });
  return {
    posted,
    handler,
    advance: (ms: number) => {
      now += ms;
      handler.pump();
    },
    snapshots: () =>
      posted.filter((m): m is Extract<WorkerToMain, { kind: 'snapshot' }> => m.kind === 'snapshot'),
    errors: () =>
      posted.filter((m): m is Extract<WorkerToMain, { kind: 'error' }> => m.kind === 'error'),
    stats: () =>
      posted.filter((m): m is Extract<WorkerToMain, { kind: 'stats' }> => m.kind === 'stats'),
  };
}

describe('createWorkerHandler', () => {
  it('posts an error for an invalid setup', () => {
    const { handler, errors } = makeHandler();
    handler.onMessage({ kind: 'start', setup: { formatVersion: 2 } });
    expect(errors()).toHaveLength(1);
    expect(errors()[0]?.message).toContain('invalid match setup');
  });

  it('posts an error on a second start', () => {
    const { handler, errors } = makeHandler();
    handler.onMessage({ kind: 'start', setup: setup() });
    handler.onMessage({ kind: 'start', setup: setup() });
    expect(errors()).toHaveLength(1);
  });

  it('posts a snapshot after a 100 ms pump', () => {
    const { handler, advance, snapshots } = makeHandler();
    handler.onMessage({ kind: 'start', setup: setup() });
    advance(0);
    advance(100);
    expect(snapshots()).toHaveLength(1);
    expect(snapshots()[0]?.snapshot.tick).toBe(1);
  });

  it('throttles stats posts to 250 ms', () => {
    const { handler, advance, stats } = makeHandler();
    handler.onMessage({ kind: 'start', setup: setup() });
    advance(0);
    advance(250);
    advance(250);
    advance(120);
    expect(stats()).toHaveLength(2);
  });

  it('posts every layer on the first snapshot', () => {
    const { handler, advance, snapshots } = makeHandler();
    handler.onMessage({ kind: 'start', setup: setup() });
    advance(0);
    advance(50);
    const layers = snapshots()[0]?.snapshot.layers ?? {};
    expect(Object.keys(layers).sort()).toEqual([READ_KEY, WRITE_KEY]);
  });

  it('posts only changed layers on later snapshots', () => {
    const { handler, advance, snapshots } = makeHandler();
    handler.onMessage({ kind: 'start', setup: setup() });
    advance(0);
    advance(50); // tick 0: write only (first post carries all layers)
    advance(50); // tick 1: write + read changed
    advance(50); // tick 2: write only
    const second = snapshots()[1]?.snapshot.layers ?? {};
    expect(Object.keys(second).sort()).toEqual([READ_KEY, WRITE_KEY]);
    const third = snapshots()[2]?.snapshot.layers ?? {};
    expect(Object.keys(third)).toEqual([WRITE_KEY]);
    expect(snapshots()).toHaveLength(3);
  });

  it('unions changed layers across ticks skipped between posts', () => {
    const { handler, advance, snapshots } = makeHandler();
    handler.onMessage({ kind: 'start', setup: setup() });
    advance(0);
    advance(50); // tick 0 — first post carries all layers
    advance(150); // ticks 1,2,3 in one pump; their changes must union
    const second = snapshots()[1]?.snapshot.layers ?? {};
    expect(Object.keys(second).sort()).toEqual([READ_KEY, WRITE_KEY]);
  });

  it('dispatches set_speed and toggle_pause without errors', () => {
    const { handler, advance, errors } = makeHandler();
    handler.onMessage({ kind: 'start', setup: setup() });
    handler.onMessage({ kind: 'toggle_pause' });
    advance(0);
    advance(200);
    handler.onMessage({ kind: 'set_speed', index: 3 });
    advance(100);
    expect(errors()).toHaveLength(0);
  });
});
