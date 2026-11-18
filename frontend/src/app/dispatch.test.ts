// The single intent router: global intents act on stores/client here,
// canvas-dependent intents reach the registered canvas handler, and the
// road order submits at the content-defined buildable level.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBuildStore } from '../client/build-store';
import { resetClientState } from '../client/reset';
import { useSelectionStore } from '../client/selection-store';
import type { SimClient, SnapshotPair } from '../client/sim-client';
import { loadContent } from '../content/index';
import type { Snapshot } from '../core/index';
import { ActivateCommand, UpgradeLinksCommand } from '../features/construction/protocol';
import { LogisticsNetworkChannel } from '../features/logistics/protocol';
import type { Intent } from '../input/intents';
import { createIntentRouter } from './dispatch';

function fakeClient(latest: Snapshot | null): SimClient & { submitted: { type: string }[] } {
  const submitted: { type: string }[] = [];
  return {
    submitted,
    start: vi.fn(),
    restart: vi.fn(),
    submit: (command) => {
      submitted.push(command);
    },
    setSpeedIndex: vi.fn(),
    togglePause: vi.fn(),
    snapshots: (): SnapshotPair => ({ previous: null, latest, receivedAt: 0, intervalMs: 0 }),
    inspect: vi.fn(),
    inspection: () => null,
    eventsSince: () => ({ events: [], cursor: 0 }),
  };
}

const db = loadContent();

describe('intent router', () => {
  beforeEach(() => {
    resetClientState();
  });

  it('handles store-level intents without a canvas handler', () => {
    const router = createIntentRouter({ client: fakeClient(null), db });
    router.dispatch({ kind: 'build.select', kindId: 'frontline_td:turret' });
    expect(useBuildStore.getState().kind).toBe('frontline_td:turret');
    router.dispatch({ kind: 'road.toggle' });
    expect(useBuildStore.getState().roadMode).toBe(true);
    expect(useBuildStore.getState().kind).toBeNull();
    router.dispatch({ kind: 'road.toggle' });
    expect(useBuildStore.getState().roadMode).toBe(false);
  });

  it('forwards unhandled intents to the registered canvas handler', () => {
    const router = createIntentRouter({ client: fakeClient(null), db });
    const seen: Intent[] = [];
    router.setCanvasHandler((intent) => {
      seen.push(intent);
    });
    router.dispatch({ kind: 'camera.pan_px', dx: 4, dy: -2 });
    router.dispatch({ kind: 'select.click', x: 10, y: 20, additive: false });
    expect(seen.map((i) => i.kind)).toEqual(['camera.pan_px', 'select.click']);
    // Global intents never reach the canvas.
    router.dispatch({ kind: 'build.cancel' });
    expect(seen).toHaveLength(2);
    // Unregistering drops canvas intents silently.
    router.setCanvasHandler(null);
    router.dispatch({ kind: 'camera.pan_px', dx: 1, dy: 1 });
    expect(seen).toHaveLength(2);
  });

  it('road.confirm submits upgrade_links at the content road level', () => {
    const latest = {
      observer: 1,
      channels: {
        [LogisticsNetworkChannel.id]: {
          nodes: { handles: [10, 20] },
          links: { a: [0], b: [1], pathOffsets: [0, 2], pathCells: [0, 1] },
        },
      },
      layers: {},
      events: [],
      tick: 0,
    } as unknown as Snapshot;
    const client = fakeClient(latest);
    const router = createIntentRouter({ client, db });
    useBuildStore.getState().enterRoad();
    useBuildStore.getState().setRoadSel([{ a: 10, b: 20 }]);
    router.dispatch({ kind: 'road.confirm' });
    expect(client.submitted).toHaveLength(1);
    const command = client.submitted[0];
    expect(command?.type).toBe(UpgradeLinksCommand.type);
    const payload = (command as unknown as { payload: { links: unknown[]; level: number } })
      .payload;
    expect(payload.level).toBe(1);
    expect(payload.links).toEqual([{ a: 10, b: 20 }]);
    // Selection cleared; stays in road mode.
    expect(useBuildStore.getState().roadSel).toEqual([]);
    expect(useBuildStore.getState().roadMode).toBe(true);
  });

  it('road.confirm with an empty selection submits nothing', () => {
    const client = fakeClient(null);
    const router = createIntentRouter({ client, db });
    useBuildStore.getState().enterRoad();
    router.dispatch({ kind: 'road.confirm' });
    expect(client.submitted).toHaveLength(0);
  });

  it('selection.activate submits the selected blueprints', () => {
    const client = fakeClient(null);
    const router = createIntentRouter({ client, db });
    useSelectionStore.getState().setSelection(new Set([11, 22]), false);
    router.dispatch({ kind: 'selection.activate' });
    expect(client.submitted).toHaveLength(1);
    expect(client.submitted[0]?.type).toBe(ActivateCommand.type);
  });
});
