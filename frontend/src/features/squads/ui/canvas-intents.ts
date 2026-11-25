// Squads canvas intent handlers (ADR 0062 step 4b): command.move_to
// resolves the ground cell and routes the order — squads with selected
// members get the squad order, loose units get a plain MoveCommand.
// Moved verbatim from render/input-dispatch.ts.
import { useSelectionStore } from '../../../client/selection-store';
import {
  defineCanvasIntentHandler,
  type CanvasIntentHandlerDef,
} from '../../../render/canvas-input';
import { submitMoveOrder } from './squad-controls';

const commandMoveTo = defineCanvasIntentHandler({
  id: 'squads.command_move_to',
  kind: 'command.move_to',
  handle(intent, env, nowMs) {
    const ground = env.groundAt(intent.x, intent.y);
    if (ground === null) {
      return;
    }
    const selected = [...useSelectionStore.getState().selected];
    if (selected.length === 0) {
      return;
    }
    submitMoveOrder(
      env.client,
      env.client.snapshots().latest,
      selected,
      Math.floor(ground.x),
      Math.floor(ground.y),
      intent.guard,
    );
    useSelectionStore.getState().markMoveTarget(ground.x, ground.y, nowMs);
  },
});

export const squadsCanvasIntents: readonly CanvasIntentHandlerDef[] = [commandMoveTo];
