// The single app-level intent router: keyboard, pointer and UI buttons
// all feed dispatch(). Global intents (runtime, squads, build/road mode,
// selection commands) are handled here; everything else is forwarded to
// the canvas handler the input bridge registers while mounted.
import { useBuildStore } from '../client/build-store';
import { useCameraStore } from '../client/camera-store';
import type { IntentDispatch, IntentRouter } from '../client/intent';
import { nextSpeedIndex } from '../client/match-info';
import { submitRoadOrder } from '../client/road-order';
import { useRuntimeStore } from '../client/runtime-store';
import { useSelectionStore } from '../client/selection-store';
import type { SimClient } from '../client/sim-client';
import {
  digitPress,
  playerSquadTag,
  squadForDigit,
  type DigitPress,
} from '../client/squad-controls';
import { useUiStore } from '../client/ui-store';
import type { ContentDb } from '../content/index';
import { ActivateCommand, CancelCommand } from '../features/construction/protocol';
import { SquadsChannel, SquadsCreate, type SquadsSnapshot } from '../features/squads/protocol';
import { SPEED_STEPS } from '../protocol/index';

export interface AppIntentRouter extends IntentRouter {
  // Restart also clears the double-press squad-centre tracking.
  resetLastDigit(): void;
}

export function createIntentRouter(deps: { client: SimClient; db: ContentDb }): AppIntentRouter {
  const { client, db } = deps;
  let canvas: IntentDispatch | null = null;
  let lastDigit: DigitPress | null = null;

  const dispatch: IntentDispatch = (intent) => {
    switch (intent.kind) {
      case 'runtime.toggle_pause':
        client.togglePause();
        return;
      case 'runtime.speed_step': {
        const stats = useRuntimeStore.getState().stats;
        const index = nextSpeedIndex(stats?.speedIndex ?? 1, intent.delta, SPEED_STEPS.length);
        client.setSpeedIndex(index);
        return;
      }
      case 'squad.digit': {
        const latest = client.snapshots().latest;
        const squads =
          (latest?.channels[SquadsChannel.id] as SquadsSnapshot | undefined)?.squads ?? [];
        const observer = latest?.observer ?? -1;
        if (intent.ctrl) {
          // Ctrl+digit: create/re-bind a squad from the current selection.
          const selected = [...useSelectionStore.getState().selected];
          if (selected.length > 0) {
            client.submit({
              type: SquadsCreate.type,
              payload: { units: selected, tag: playerSquadTag(intent.digit) },
            });
          }
          return;
        }
        const bound = squadForDigit(squads, observer, intent.digit);
        if (bound?.members === undefined) {
          return;
        }
        const press = digitPress(lastDigit, intent.digit, performance.now());
        lastDigit = press.last;
        if (press.action === 'center') {
          useCameraStore.getState().setCenter(bound.centroid);
        } else {
          useSelectionStore.getState().setSelection(new Set(bound.members), false);
        }
        return;
      }
      case 'dev.toggle_panel':
        useUiStore.getState().toggleDebugPanel();
        return;
      case 'camera.toggle_mode':
        useCameraStore.getState().toggleMode();
        return;
      case 'overlay.toggle_logistics':
        useUiStore.getState().toggleLogisticsOverlay();
        return;
      case 'build.select':
        useBuildStore.getState().select(intent.kindId);
        return;
      case 'build.cancel':
        useBuildStore.getState().cancel();
        return;
      case 'road.toggle': {
        const build = useBuildStore.getState();
        if (build.roadMode) {
          build.cancel();
        } else {
          build.enterRoad();
        }
        return;
      }
      case 'road.confirm':
        submitRoadOrder(client, db);
        return;
      case 'selection.activate': {
        const selected = [...useSelectionStore.getState().selected];
        if (selected.length > 0) {
          client.submit({ type: ActivateCommand.type, payload: { blueprints: selected } });
        }
        return;
      }
      case 'selection.cancel': {
        const selected = [...useSelectionStore.getState().selected];
        if (selected.length > 0) {
          client.submit({ type: CancelCommand.type, payload: { targets: selected } });
        }
        return;
      }
      default:
        // Canvas-dependent intents (camera raycasts, cursor tracking,
        // picks, build placement, move orders) go to the registered
        // canvas handler — dropped until the canvas mounts.
        canvas?.(intent);
    }
  };

  return {
    dispatch,
    setCanvasHandler: (handler) => {
      canvas = handler;
    },
    resetLastDigit: () => {
      lastDigit = null;
    },
  };
}
