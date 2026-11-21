// App-level intent router tests (ADR 0048): mode selection, camera
// auto-sync & lock, escape priority order, command-only squad digits,
// dual-mode demolish confirmation, road tool toggle/confirm, and canvas
// forwarding.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCameraStore } from '../client/camera-store';
import { useInspectorStore } from '../client/inspector-store';
import { DEMOLISH_CONFIRM_MS, useInteractionStore } from '../client/interaction-store';
import { useSelectionStore } from '../client/selection-store';
import { resetClientState } from '../client/session';
import type { SimClient, SnapshotPair } from '../client/sim-client';
import { useUiStore } from '../client/ui-store';
import { loadContent } from '../content/index';
import type { Snapshot } from '../core/index';
import {
  ActivateCommand,
  CancelCommand,
  STATE_BLUEPRINT,
  STATE_OPERATIONAL,
  StructuresChannel,
  UpgradeLinksCommand,
} from '../features/construction/protocol';
import { LogisticsNetworkChannel } from '../features/logistics/protocol';
import { SquadsChannel, SquadsCreate } from '../features/squads/protocol';
import type { Intent } from '../input/intents';
import { createIntentRouter } from './dispatch';

function fakeClient(
  latest: Snapshot | null,
): SimClient & { submitted: { type: string; payload: unknown }[] } {
  const submitted: { type: string; payload: unknown }[] = [];
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

function structureIndex(id: string): number {
  const s = db.structures.byId(id);
  if (s === undefined) {
    throw new Error(`missing structure '${id}'`);
  }
  return s.index;
}

describe('intent router', () => {
  beforeEach(() => {
    resetClientState();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('handles mode selection and camera sync/lock toggles', () => {
    const router = createIntentRouter({ client: fakeClient(null), db });
    expect(useInteractionStore.getState().mode).toBe('command');
    expect(useCameraStore.getState().mode).toBe('spectate');

    router.dispatch({ kind: 'mode.select', mode: 'build' });
    expect(useInteractionStore.getState().mode).toBe('build');
    expect(useCameraStore.getState().mode).toBe('tactical');

    router.dispatch({ kind: 'mode.select', mode: 'command' });
    expect(useInteractionStore.getState().mode).toBe('command');
    expect(useCameraStore.getState().mode).toBe('spectate');

    router.dispatch({ kind: 'camera.toggle_lock' });
    expect(useCameraStore.getState().locked).toBe(true);
    router.dispatch({ kind: 'mode.select', mode: 'logistics' });
    expect(useInteractionStore.getState().mode).toBe('logistics');
    expect(useCameraStore.getState().mode).toBe('spectate');

    router.dispatch({ kind: 'camera.toggle_mode' });
    expect(useCameraStore.getState().mode).toBe('tactical');
  });

  it('handles build.select, road.toggle, and tool.exit', () => {
    const router = createIntentRouter({ client: fakeClient(null), db });
    router.dispatch({ kind: 'build.select', kindId: 'frontline_td:turret' });
    expect(useInteractionStore.getState().mode).toBe('build');
    expect(useInteractionStore.getState().tool).toEqual({
      kind: 'place',
      structureKindId: 'frontline_td:turret',
    });
    expect(useCameraStore.getState().mode).toBe('tactical');

    router.dispatch({ kind: 'road.toggle' });
    expect(useInteractionStore.getState().mode).toBe('logistics');
    expect(useInteractionStore.getState().tool).toEqual({ kind: 'road' });

    router.dispatch({ kind: 'road.toggle' });
    expect(useInteractionStore.getState().tool).toEqual({ kind: 'none' });

    router.dispatch({ kind: 'build.select', kindId: 'frontline_td:turret' });
    router.dispatch({ kind: 'tool.exit' });
    expect(useInteractionStore.getState().tool).toEqual({ kind: 'none' });
  });

  it('resolves escape in priority order: tool -> pinned inspector, leaving keymapHelpOpen untouched', () => {
    const router = createIntentRouter({ client: fakeClient(null), db });
    useInteractionStore.getState().enterPlace('frontline_td:turret');
    expect(useUiStore.getState().keymapHelpOpen).toBe(true);
    useInspectorStore.getState().pin({ kind: 'own_unit', handle: 7 });

    // (1) Exits active tool first, leaving pinned and keymapHelpOpen untouched.
    router.dispatch({ kind: 'escape' });
    expect(useInteractionStore.getState().tool).toEqual({ kind: 'none' });
    expect(useUiStore.getState().keymapHelpOpen).toBe(true);
    expect(useInspectorStore.getState().pinned).toEqual({ kind: 'own_unit', handle: 7 });

    // (2) Unpins inspector next, leaving keymapHelpOpen untouched.
    router.dispatch({ kind: 'escape' });
    expect(useInspectorStore.getState().pinned).toBeNull();
    expect(useUiStore.getState().keymapHelpOpen).toBe(true);

    // (3) Further escape leaves keymapHelpOpen untouched (toggled via K / rail button).
    router.dispatch({ kind: 'escape' });
    expect(useUiStore.getState().keymapHelpOpen).toBe(true);
  });

  it('toggles keymap help and unpins inspector via direct intents', () => {
    const router = createIntentRouter({ client: fakeClient(null), db });
    expect(useUiStore.getState().keymapHelpOpen).toBe(true);
    router.dispatch({ kind: 'ui.toggle_keymap_help' });
    expect(useUiStore.getState().keymapHelpOpen).toBe(false);
    router.dispatch({ kind: 'ui.toggle_keymap_help' });
    expect(useUiStore.getState().keymapHelpOpen).toBe(true);
    useInspectorStore.getState().pin({ kind: 'ruin', handle: 42 });
    router.dispatch({ kind: 'inspector.unpin' });
    expect(useInspectorStore.getState().pinned).toBeNull();
  });

  it('gates squad.digit to command mode, updates inspector, and centers on double-press', () => {
    const latest = {
      observer: 1,
      channels: {
        [SquadsChannel.id]: {
          squads: [
            {
              id: 5,
              faction: 1,
              tag: 'player:1',
              members: [101, 102],
              centroid: { x: 18, y: 24 },
              strength: 2,
              phase: 'holding',
              order: { kind: 'idle' },
            },
            {
              id: 6,
              faction: 1,
              tag: 'player:2',
              members: [201],
              centroid: { x: 8, y: 12 },
              strength: 1,
              phase: 'holding',
              order: { kind: 'idle' },
            },
          ],
        },
      },
      layers: {},
      events: [],
      tick: 0,
    } as unknown as Snapshot;
    const client = fakeClient(latest);
    const router = createIntentRouter({ client, db });

    // Ignored outside command mode.
    router.dispatch({ kind: 'mode.select', mode: 'build' });
    router.dispatch({ kind: 'squad.digit', digit: 1, ctrl: false });
    expect(useSelectionStore.getState().selected.size).toBe(0);
    expect(useInspectorStore.getState().pinned).toBeNull();

    // build.category_digit is a reserved no-op in F1.
    router.dispatch({ kind: 'build.category_digit', slot: 1 });
    expect(useSelectionStore.getState().selected.size).toBe(0);

    // Back to command mode: bare digit selects members and pins multi_own.
    router.dispatch({ kind: 'mode.select', mode: 'command' });
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    router.dispatch({ kind: 'squad.digit', digit: 1, ctrl: false });
    expect([...useSelectionStore.getState().selected]).toEqual([101, 102]);
    expect(useInspectorStore.getState().pinned).toEqual({ kind: 'multi_own', count: 2 });

    // Double-press within window centers camera.
    vi.spyOn(performance, 'now').mockReturnValue(1150);
    router.dispatch({ kind: 'squad.digit', digit: 1, ctrl: false });
    expect(useCameraStore.getState().center).toEqual({ x: 18, y: 24 });

    // Single-member squad pins own_unit.
    vi.spyOn(performance, 'now').mockReturnValue(2000);
    router.dispatch({ kind: 'squad.digit', digit: 2, ctrl: false });
    expect([...useSelectionStore.getState().selected]).toEqual([201]);
    expect(useInspectorStore.getState().pinned).toEqual({ kind: 'own_unit', handle: 201 });

    // Ctrl+digit creates a squad from current selection.
    router.dispatch({ kind: 'squad.digit', digit: 3, ctrl: true });
    expect(client.submitted).toHaveLength(1);
    expect(client.submitted[0]?.type).toBe(SquadsCreate.type);
    expect(client.submitted[0]?.payload).toEqual({ units: [201], tag: 'player:3' });
  });

  it('implements D3 dual-mode demolish in build mode only', () => {
    const turretIdx = structureIndex('frontline_td:turret');
    const latest = {
      observer: 1,
      channels: {
        [StructuresChannel.id]: {
          handles: new Float64Array([10, 20]),
          kind: new Uint16Array([turretIdx, turretIdx]),
          x: new Uint16Array([2, 6]),
          y: new Uint16Array([2, 6]),
          faction: new Uint16Array([1, 1]),
          state: new Uint8Array([STATE_BLUEPRINT, STATE_OPERATIONAL]),
          progressBp: new Uint16Array([0, 10000]),
          hpBp: new Uint16Array([10000, 10000]),
        },
      },
      layers: {},
      events: [],
      tick: 0,
    } as unknown as Snapshot;
    const client = fakeClient(latest);
    const router = createIntentRouter({ client, db });

    // Ignored outside build mode.
    router.dispatch({ kind: 'demolish.press' });
    expect(useInteractionStore.getState().tool).toEqual({ kind: 'none' });

    // Enter build mode with empty selection -> toggles demolish tool on/off.
    router.dispatch({ kind: 'mode.select', mode: 'build' });
    router.dispatch({ kind: 'demolish.press' });
    expect(useInteractionStore.getState().tool).toEqual({ kind: 'demolish' });
    router.dispatch({ kind: 'demolish.press' });
    expect(useInteractionStore.getState().tool).toEqual({ kind: 'none' });

    // Blueprint selected -> cancels immediately without confirmation.
    useSelectionStore.getState().setSelection(new Set([10]), false);
    router.dispatch({ kind: 'demolish.press' });
    expect(client.submitted).toHaveLength(1);
    expect(client.submitted[0]).toEqual({
      type: CancelCommand.type,
      payload: { targets: [10] },
    });
    expect(useInteractionStore.getState().demolishConfirm).toBeNull();

    // Operational building selected -> arms 2.5s confirmation on 1st press, cancels on 2nd.
    useSelectionStore.getState().setSelection(new Set([20]), false);
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    router.dispatch({ kind: 'demolish.press' });
    expect(client.submitted).toHaveLength(1);
    expect(useInteractionStore.getState().demolishConfirm?.targets).toEqual([20]);

    // Expired confirmation re-arms instead of submitting.
    vi.spyOn(performance, 'now').mockReturnValue(5000 + DEMOLISH_CONFIRM_MS + 1);
    router.dispatch({ kind: 'demolish.press' });
    expect(client.submitted).toHaveLength(1);
    expect(useInteractionStore.getState().demolishConfirm?.expiresAt).toBe(
      5000 + DEMOLISH_CONFIRM_MS + 1 + DEMOLISH_CONFIRM_MS,
    );

    // Second press within window submits CancelCommand and clears confirm.
    vi.spyOn(performance, 'now').mockReturnValue(5000 + DEMOLISH_CONFIRM_MS + 500);
    router.dispatch({ kind: 'demolish.press' });
    expect(client.submitted).toHaveLength(2);
    expect(client.submitted[1]).toEqual({
      type: CancelCommand.type,
      payload: { targets: [20] },
    });
    expect(useInteractionStore.getState().demolishConfirm).toBeNull();

    // Explicit demolish.confirm button submits while armed and valid.
    vi.spyOn(performance, 'now').mockReturnValue(10_000);
    router.dispatch({ kind: 'demolish.press' });
    expect(useInteractionStore.getState().demolishConfirm).not.toBeNull();
    vi.spyOn(performance, 'now').mockReturnValue(11_000);
    router.dispatch({ kind: 'demolish.confirm' });
    expect(client.submitted).toHaveLength(3);
    expect(client.submitted[2]).toEqual({
      type: CancelCommand.type,
      payload: { targets: [20] },
    });
    expect(useInteractionStore.getState().demolishConfirm).toBeNull();
  });

  it('auto-cancels demolishConfirm on selection change and 2.5s timeout', () => {
    const turretIdx = structureIndex('frontline_td:turret');
    const latest = {
      observer: 1,
      channels: {
        [StructuresChannel.id]: {
          handles: new Float64Array([20, 30]),
          kind: new Uint16Array([turretIdx, turretIdx]),
          x: new Uint16Array([2, 8]),
          y: new Uint16Array([2, 8]),
          faction: new Uint16Array([1, 1]),
          state: new Uint8Array([STATE_OPERATIONAL, STATE_OPERATIONAL]),
          progressBp: new Uint16Array([10000, 10000]),
          hpBp: new Uint16Array([10000, 10000]),
        },
      },
      layers: {},
      events: [],
      tick: 0,
    } as unknown as Snapshot;
    const client = fakeClient(latest);
    const router = createIntentRouter({ client, db });

    router.dispatch({ kind: 'mode.select', mode: 'build' });
    useSelectionStore.getState().setSelection(new Set([20]), false);
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    router.dispatch({ kind: 'demolish.press' });
    expect(useInteractionStore.getState().demolishConfirm?.targets).toEqual([20]);

    // Switching selection to operational building B (30) clears confirm for A (20).
    useSelectionStore.getState().setSelection(new Set([30]), false);
    expect(useInteractionStore.getState().demolishConfirm).toBeNull();
    router.dispatch({ kind: 'demolish.confirm' });
    expect(client.submitted).toHaveLength(0);

    // Pressing C again arms B (30) instead of cancelling A (20).
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(2000);
    router.dispatch({ kind: 'demolish.press' });
    expect(useInteractionStore.getState().demolishConfirm?.targets).toEqual([30]);
    expect(client.submitted).toHaveLength(0);

    // Waiting > DEMOLISH_CONFIRM_MS clears demolishConfirm automatically.
    vi.advanceTimersByTime(DEMOLISH_CONFIRM_MS + 1);
    expect(useInteractionStore.getState().demolishConfirm).toBeNull();
    router.dispatch({ kind: 'demolish.confirm' });
    expect(client.submitted).toHaveLength(0);
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
    router.dispatch({ kind: 'tool.exit' });
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
    useInteractionStore.getState().enterRoad();
    useInteractionStore.getState().setRoadSel([{ a: 10, b: 20 }]);
    router.dispatch({ kind: 'road.confirm' });
    expect(client.submitted).toHaveLength(1);
    const command = client.submitted[0];
    expect(command?.type).toBe(UpgradeLinksCommand.type);
    const payload = command?.payload as { links: unknown[]; level: number };
    expect(payload.level).toBe(1);
    expect(payload.links).toEqual([{ a: 10, b: 20 }]);
    // Selection cleared; stays in road tool.
    expect(useInteractionStore.getState().roadSel).toEqual([]);
    expect(useInteractionStore.getState().tool).toEqual({ kind: 'road' });
  });

  it('road.confirm with an empty selection submits nothing', () => {
    const client = fakeClient(null);
    const router = createIntentRouter({ client, db });
    useInteractionStore.getState().enterRoad();
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
