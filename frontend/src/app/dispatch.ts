// The single app-level intent router: keyboard, pointer and UI buttons
// all feed dispatch(). Global intents (runtime, modes, tools, camera,
// squads, demolish confirmation, selection commands) are handled here;
// everything else is forwarded to the canvas handler while mounted.
import { useCameraStore } from '../client/camera-store';
import { useInspectorStore } from '../client/inspector-store';
import { targetKeyForHandles, useInteractionStore } from '../client/interaction-store';
import type { IntentDispatch, IntentRouter } from '../client/intent';
import { nextSpeedIndex } from '../client/match-info';
import { structuresChannel } from '../client/pick';
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
import {
  ActivateCommand,
  CancelCommand,
  RoadWorksChannel,
  type RoadWorks,
} from '../features/construction/protocol';
import { classifyCancelSelection } from '../features/construction/rules/index';
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
      case 'mode.select':
        useInteractionStore.getState().setMode(intent.mode);
        useCameraStore.getState().syncForPrimaryMode(intent.mode);
        return;
      case 'tool.exit':
        useInteractionStore.getState().exitTool();
        return;
      case 'escape': {
        const interaction = useInteractionStore.getState();
        if (interaction.tool.kind !== 'none') {
          interaction.exitTool();
          return;
        }
        const ui = useUiStore.getState();
        if (ui.keymapHelpOpen) {
          ui.closeKeymapHelp();
          return;
        }
        const inspector = useInspectorStore.getState();
        if (inspector.pinned !== null) {
          inspector.unpin();
        }
        return;
      }
      case 'squad.digit': {
        if (useInteractionStore.getState().mode !== 'command') {
          return;
        }
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
          const inspector = useInspectorStore.getState();
          if (bound.members.length === 1) {
            const single = bound.members[0];
            if (single !== undefined) {
              inspector.pin({ kind: 'own_unit', handle: single });
            }
          } else if (bound.members.length > 1) {
            inspector.pin({ kind: 'multi_own', count: bound.members.length });
          } else {
            inspector.unpin();
          }
        }
        return;
      }
      case 'build.category_digit':
        // Intentionally reserved for build category slots in a later batch.
        return;
      case 'dev.toggle_panel':
        useUiStore.getState().toggleDebugPanel();
        return;
      case 'camera.toggle_mode':
        useCameraStore.getState().toggleMode();
        return;
      case 'camera.toggle_lock':
        useCameraStore.getState().toggleLocked();
        return;
      case 'ui.toggle_keymap_help':
        useUiStore.getState().toggleKeymapHelp();
        return;
      case 'overlay.toggle_logistics':
        useUiStore.getState().toggleLogisticsOverlay();
        return;
      case 'inspector.unpin':
        useInspectorStore.getState().unpin();
        return;
      case 'build.select':
        useInteractionStore.getState().enterPlace(intent.kindId);
        useCameraStore.getState().syncForPrimaryMode('build');
        return;
      case 'demolish.press': {
        const interaction = useInteractionStore.getState();
        if (interaction.mode !== 'build') {
          return;
        }
        const latest = client.snapshots().latest;
        const observer = latest?.observer ?? -1;
        const roadWorks = (latest?.channels[RoadWorksChannel.id] as RoadWorks | undefined) ?? null;
        const selected = useSelectionStore.getState().selected;
        const { cancellable, operational } = classifyCancelSelection(
          db,
          structuresChannel(latest),
          roadWorks,
          observer,
          selected,
        );
        if (cancellable.length === 0) {
          if (interaction.tool.kind === 'demolish') {
            interaction.exitTool();
          } else {
            interaction.enterDemolish();
          }
          return;
        }
        if (operational.length === 0) {
          client.submit({ type: CancelCommand.type, payload: { targets: cancellable } });
          interaction.clearDemolishConfirm();
          return;
        }
        const now = performance.now();
        const key = targetKeyForHandles(cancellable);
        const confirm = interaction.demolishConfirm;
        if (confirm !== null && now <= confirm.expiresAt && confirm.targetKey === key) {
          client.submit({ type: CancelCommand.type, payload: { targets: cancellable } });
          interaction.clearDemolishConfirm();
        } else {
          interaction.armDemolishConfirm(cancellable, now);
        }
        return;
      }
      case 'demolish.confirm': {
        const interaction = useInteractionStore.getState();
        const confirm = interaction.demolishConfirm;
        if (confirm === null) {
          return;
        }
        const now = performance.now();
        if (now <= confirm.expiresAt) {
          client.submit({ type: CancelCommand.type, payload: { targets: [...confirm.targets] } });
        }
        interaction.clearDemolishConfirm();
        return;
      }
      case 'road.toggle': {
        const interaction = useInteractionStore.getState();
        if (interaction.tool.kind === 'road') {
          interaction.exitTool();
        } else {
          interaction.enterRoad();
          useCameraStore.getState().syncForPrimaryMode('logistics');
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
      default:
        // Canvas-dependent intents (camera raycasts, cursor tracking,
        // picks, build placement, demolish clicks, road clicks, move orders)
        // go to the registered canvas handler — dropped until the canvas mounts.
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
