import { describe, expect, it } from 'vitest';
import { defineSnapshotChannel } from '../core/index';
import { defineGridLayer } from '../kernel/index';
import type { SimModule } from '../kernel/index';
import { createQueuedController, createSimulation } from '../kernel/index';
import { Faction, InWorld } from '../kernel/index';
import type { EntityHandle } from '../core/index';
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
      const config = baseConfig({
        factions: [{ id: F1 }, { id: toFactionId(2) }],
        controllers: [localQueue],
      });
      const sim = createSimulation(config, modules);
      return { sim, localQueue, observer: F1, config, modules };
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

  it('never transfers kernel-held buffers: channel/layer arrays are copies', () => {
    // Channel returns the SAME typed array every snapshot (as a shared
    // live-state channel would); the posted snapshot must carry a copy and
    // the transfer list must never contain a kernel-held buffer.
    interface Chan {
      v: Float32Array;
    }
    const CH = defineSnapshotChannel<Chan>('frontline_td:testwh');
    const shared = new Float32Array(4);
    const channelModule: SimModule = {
      id: 'frontline_td:testwh',
      install(builder) {
        builder.snapshotChannel(CH, () => ({ v: shared }));
      },
    };
    const simBox: { current: ReturnType<typeof createSimulation> | null } = { current: null };
    const posts: WorkerToMain[] = [];
    const transfers: (Transferable[] | undefined)[] = [];
    let now = 0;
    const handler = createWorkerHandler({
      post: (message, transfer) => {
        posts.push(message);
        transfers.push(transfer);
      },
      resolve: (): Resolved => {
        const localQueue = createQueuedController(F1);
        const config = baseConfig({
          factions: [{ id: F1 }, { id: toFactionId(2) }],
          controllers: [localQueue],
        });
        const modules = [layerModule(), channelModule];
        simBox.current = createSimulation(config, modules);
        return { sim: simBox.current, localQueue, observer: F1, config, modules };
      },
      now: () => now,
    });
    handler.onMessage({ kind: 'start', setup: setup() });
    handler.pump(); // establishes the time baseline
    now += 50;
    handler.pump(); // runs tick 0 and posts the snapshot
    const snapIndex = posts.findIndex((m) => m.kind === 'snapshot');
    expect(snapIndex).toBeGreaterThanOrEqual(0);
    const message = posts[snapIndex];
    const transfer = transfers[snapIndex] ?? [];
    if (message === undefined || message.kind !== 'snapshot') {
      throw new Error('no snapshot posted');
    }
    const resolvedSim = simBox.current;
    if (resolvedSim === null) {
      throw new Error('sim was not created');
    }
    // No duplicate buffers in the transfer list.
    expect(new Set(transfer).size).toBe(transfer.length);
    // Buffers held by the kernel snapshot must not appear in the transfer.
    const kernel = resolvedSim.snapshot(F1);
    const kernelBuffers = new Set<ArrayBufferLike>();
    for (const layer of Object.values(kernel.layers)) {
      kernelBuffers.add(layer.buffer);
    }
    for (const value of Object.values(kernel.channels)) {
      for (const prop of Object.values(value as object)) {
        if (ArrayBuffer.isView(prop)) {
          kernelBuffers.add(prop.buffer);
        }
      }
    }
    for (const item of transfer) {
      expect(kernelBuffers.has(item as ArrayBuffer)).toBe(false);
    }
    // Posted channel array is a copy with identical contents.
    const posted = message.snapshot.channels[CH.id] as Chan | undefined;
    expect(posted?.v).not.toBe(shared);
    expect(Array.from(posted?.v ?? [])).toEqual(Array.from(shared));
    expect(transfer).toContain(posted?.v.buffer);
  });

  it('attaches the inspection for the current target to every snapshot', () => {
    let spawned: EntityHandle | null = null;
    const inspectModule: SimModule = {
      id: 'frontline_td:test.wh.inspect',
      install(builder) {
        builder.onStart((ctx) => {
          spawned = ctx.spawn([[Faction, { id: F1 }], [InWorld]]);
        });
        builder.inspector('frontline_td:test.wh.inspect.section', () => ({ tag: 'unit' }));
      },
    };
    const { handler, advance, snapshots } = makeHandler([layerModule(), inspectModule]);
    handler.onMessage({ kind: 'start', setup: setup() });
    advance(0);
    advance(50);
    expect(snapshots()[0]?.inspection).toBeNull();
    handler.onMessage({ kind: 'inspect', handle: spawned });
    advance(50);
    const inspection = snapshots()[1]?.inspection;
    expect(inspection?.handle).toBe(spawned);
    expect(inspection?.sections['frontline_td:test.wh.inspect.section']).toEqual({
      tag: 'unit',
    });
    handler.onMessage({ kind: 'inspect', handle: null });
    advance(50);
    expect(snapshots()[2]?.inspection).toBeNull();
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
