// Construction canvas intent handlers (ADR 0062 step 4b): build.place
// resolves the ground cell and submits a PlaceCommand; demolish.click
// ray-picks a cancellable target and submits a CancelCommand. Moved
// verbatim from render/input-dispatch.ts.
import { useInteractionStore } from '../../../client/interaction-store';
import {
  defineCanvasIntentHandler,
  type CanvasIntentHandlerDef,
} from '../../../render/canvas-input';
import { pickGround, type Ray } from '../../../render/picking';
import { HEIGHT_STEP } from '../../../render/world';
import { CancelCommand, PlaceCommand } from '../protocol';
import { centeredFootprint } from '../rules/index';
import { pickDemolishableByRay } from './demolish-pick';

const CLICK_RADIUS_CELLS = 0.6;

const buildPlace = defineCanvasIntentHandler({
  id: 'construction.build_place',
  kind: 'build.place',
  handle(intent, env) {
    const interaction = useInteractionStore.getState();
    if (interaction.tool.kind !== 'place') {
      return;
    }
    const ground = env.groundAt(intent.x, intent.y);
    if (ground === null) {
      return;
    }
    const kind = interaction.tool.structureKindId;
    const resolved = env.db.structures.byId(kind);
    if (resolved === undefined) {
      interaction.exitTool();
      return;
    }
    const { x, y } = centeredFootprint(ground.x, ground.y, resolved.footprint);
    env.client.submit({
      type: PlaceCommand.type,
      payload: { kind, x, y, blueprint: intent.blueprint },
    });
    // Blueprint placement (Shift) stays in place tool; direct placement exits it.
    if (!intent.blueprint) {
      interaction.exitTool();
    }
  },
});

const demolishClick = defineCanvasIntentHandler({
  id: 'construction.demolish_click',
  kind: 'demolish.click',
  handle(intent, env) {
    const { width: mapWidth, height: mapHeight } = env.map.grid;
    const ray: Ray = env.rayAt(intent.x, intent.y);
    const ground = pickGround(ray, env.heights, mapWidth, mapHeight);
    const latest = env.client.snapshots().latest;
    const observer = latest?.observer ?? -1;
    const hit = pickDemolishableByRay(
      env.db,
      { width: mapWidth, height: mapHeight },
      env.heights,
      HEIGHT_STEP,
      ray,
      ground,
      latest,
      observer,
      CLICK_RADIUS_CELLS,
    );
    if (hit !== null) {
      env.client.submit({
        type: CancelCommand.type,
        payload: { targets: [hit.handle] },
      });
    }
  },
});

export const constructionCanvasIntents: readonly CanvasIntentHandlerDef[] = [
  buildPlace,
  demolishClick,
];
