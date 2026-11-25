// Selection canvas intent handlers (ADR 0062 step 4b): cursor.move feeds
// cursor state + hover subjects (+ road/demolish tool hovers via the
// owning features' public pickers), select.click picks a subject and
// selects/pins it, select.box projects own units/structures into the
// marquee. Moved verbatim from render/input-dispatch.ts.
import { readChannel } from '../../../core/index';
import { cursorState } from '../../../client/cursor';
import { useInspectorStore } from '../../../client/inspector-store';
import { useInteractionStore } from '../../../client/interaction-store';
import { useSelectionStore } from '../../../client/selection-store';
import {
  defineCanvasIntentHandler,
  type CanvasIntentHandlerDef,
} from '../../../render/canvas-input';
import { pickGround, type Ray } from '../../../render/picking';
import { HEIGHT_STEP } from '../../../render/world';
import { StructuresChannel } from '../../construction/protocol';
import { pickDemolishableByRay } from '../../construction/ui/index';
import { LogisticsNetworkChannel, type LogisticsNetwork } from '../../logistics/protocol';
import { nearestLink, useRoadToolStore } from '../../logistics/ui/index';
import { interpolatedUnits } from '../../units/render/index';
import { ownSubjectForHandle } from './pick';
import { pickSubjectByRay } from './pick-ray';

const CLICK_RADIUS_CELLS = 0.6;

const cursorMove = defineCanvasIntentHandler({
  id: 'selection.cursor_move',
  kind: 'cursor.move',
  handle(intent, env, nowMs) {
    const { width: mapWidth, height: mapHeight } = env.map.grid;
    cursorState.setScreen(intent.x, intent.y);
    const ray: Ray = env.rayAt(intent.x, intent.y);
    const ground = pickGround(ray, env.heights, mapWidth, mapHeight);
    cursorState.setGround(ground);
    const latest = env.client.snapshots().latest;
    const observer = latest?.observer ?? -1;
    const units = interpolatedUnits(env.client.snapshots(), nowMs);
    const picked = pickSubjectByRay(
      env.db,
      { width: mapWidth, height: mapHeight },
      env.heights,
      HEIGHT_STEP,
      ray,
      ground,
      latest,
      observer,
      units,
      CLICK_RADIUS_CELLS,
    );
    useInspectorStore.getState().setHovered(picked.subject);

    const interaction = useInteractionStore.getState();
    if (interaction.tool.kind === 'road') {
      const links: LogisticsNetwork['links'] | { a: []; pathOffsets: []; pathCells: [] } =
        readChannel(latest, LogisticsNetworkChannel)?.links ?? {
          a: [],
          pathOffsets: [],
          pathCells: [],
        };
      const link = ground === null ? -1 : nearestLink(links, mapWidth, ground.x, ground.y);
      useRoadToolStore.getState().setRoadHover(link);
    } else if (interaction.tool.kind === 'demolish') {
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
      interaction.setDemolishHover(
        hit === null ? null : { handle: hit.handle, refunds: hit.refunds },
      );
    }
  },
});

const selectClick = defineCanvasIntentHandler({
  id: 'selection.select_click',
  kind: 'select.click',
  handle(intent, env, nowMs) {
    const { width: mapWidth, height: mapHeight } = env.map.grid;
    const ray: Ray = env.rayAt(intent.x, intent.y);
    const ground = pickGround(ray, env.heights, mapWidth, mapHeight);
    const selection = useSelectionStore.getState();
    const inspector = useInspectorStore.getState();
    const latest = env.client.snapshots().latest;
    const observer = latest?.observer ?? -1;
    const units = interpolatedUnits(env.client.snapshots(), nowMs);
    const picked = pickSubjectByRay(
      env.db,
      { width: mapWidth, height: mapHeight },
      env.heights,
      HEIGHT_STEP,
      ray,
      ground,
      latest,
      observer,
      units,
      CLICK_RADIUS_CELLS,
    );
    if (picked.subject === null) {
      if (!intent.additive) {
        selection.clear();
        inspector.unpin();
        useInteractionStore.getState().clearDemolishConfirm();
      }
      return;
    }
    if (picked.ownHandle !== null && picked.subject.kind !== 'cell') {
      selection.setSelection(new Set([picked.ownHandle]), intent.additive);
      useInteractionStore.getState().clearDemolishConfirm();
      const nextSelected = useSelectionStore.getState().selected;
      if (nextSelected.size > 1) {
        inspector.pin({ kind: 'multi_own', count: nextSelected.size });
      } else {
        inspector.pin(picked.subject);
      }
      return;
    }
    if (picked.subject.kind === 'cell') {
      if (!intent.additive) {
        selection.clear();
        useInteractionStore.getState().clearDemolishConfirm();
      }
      inspector.unpin();
      return;
    }
    // Hostile / ruin / salvage / memory: pin for inspection without altering own selection.
    useInteractionStore.getState().clearDemolishConfirm();
    inspector.pin(picked.subject);
  },
});

const selectBox = defineCanvasIntentHandler({
  id: 'selection.select_box',
  kind: 'select.box',
  handle(intent, env, nowMs) {
    const { client, db } = env;
    const latest = client.snapshots().latest;
    const observer = latest?.observer ?? -1;
    const mode = useInteractionStore.getState().mode;
    const units = interpolatedUnits(client.snapshots(), nowMs);
    const box = {
      x0: Math.min(intent.x0, intent.x1),
      y0: Math.min(intent.y0, intent.y1),
      x1: Math.max(intent.x0, intent.x1),
      y1: Math.max(intent.y0, intent.y1),
    };
    const inside = (px: number, py: number): boolean =>
      px >= box.x0 && px <= box.x1 && py >= box.y0 && py <= box.y1;
    const picked = new Set<number>();

    if (mode !== 'build') {
      for (const [handle, u] of units) {
        if (u.faction !== observer) {
          continue;
        }
        const p = env.project(u.x, u.y, 0.3);
        if (p.inFront && inside(p.x, p.y)) {
          picked.add(handle);
        }
      }
    }
    if (mode === 'build' || picked.size === 0) {
      const structures = readChannel(latest, StructuresChannel);
      if (structures !== null) {
        for (let i = 0; i < structures.handles.length; i++) {
          if ((structures.faction[i] ?? 0) !== observer) {
            continue;
          }
          const kind = db.structures.byIndex(structures.kind[i] ?? 0);
          if (kind === undefined) {
            continue;
          }
          const cx = (structures.x[i] ?? 0) + kind.footprint.w / 2;
          const cy = (structures.y[i] ?? 0) + kind.footprint.h / 2;
          const p = env.project(cx, cy, kind.visual.height * 0.45);
          if (p.inFront && inside(p.x, p.y)) {
            picked.add(structures.handles[i] ?? 0);
          }
        }
      }
    }
    const selection = useSelectionStore.getState();
    selection.setSelection(picked, intent.additive);
    useInteractionStore.getState().clearDemolishConfirm();
    const nextSelected = useSelectionStore.getState().selected;
    const inspector = useInspectorStore.getState();
    if (nextSelected.size > 1) {
      inspector.pin({ kind: 'multi_own', count: nextSelected.size });
    } else if (nextSelected.size === 1) {
      const single = [...nextSelected][0];
      if (single !== undefined) {
        inspector.pin(ownSubjectForHandle(latest, observer, units, single));
      }
    } else {
      inspector.unpin();
    }
  },
});

export const selectionCanvasIntents: readonly CanvasIntentHandlerDef[] = [
  cursorMove,
  selectClick,
  selectBox,
];
