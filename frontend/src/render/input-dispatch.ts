// Canvas input dispatch (ADR 0048): the canvas-dependent half of the single
// intent router — screen-space intents that need the camera/raycaster turn
// into hover subjects, selections, pinned inspection targets, build/demolish/road
// tool clicks, and move orders.
import * as THREE from 'three';
import { visibleGroundHeight } from '../client/camera-math';
import { useCameraStore } from '../client/camera-store';
import { cursorState } from '../client/cursor';
import { useInspectorStore, type PinnableSubject } from '../client/inspector-store';
import { useInteractionStore } from '../client/interaction-store';
import { pickDemolishableAt, pickSubjectAt, structuresChannel } from '../client/pick';
import { submitRoadOrder } from '../client/road-order';
import { useSelectionStore } from '../client/selection-store';
import type { SimClient } from '../client/sim-client';
import { submitMoveOrder } from '../client/squad-controls';
import type { ContentDb } from '../content/index';
import type { Snapshot } from '../core/index';
import {
  CancelCommand,
  PlaceCommand,
  RoadWorksChannel,
  type RoadWorks,
} from '../features/construction/protocol';
import { centeredFootprint } from '../features/construction/rules/index';
import { LogisticsNetworkChannel, type LogisticsNetwork } from '../features/logistics/protocol';
import { extendRoadSelection, linkKey, nearestLink, sameKey } from '../features/logistics/ui/index';
import type { Intent } from '../input/intents';
import { pickGround, type Ray } from './picking';
import { interpolatedUnits } from './unit-pos';
import { terrainY } from './world';

const CLICK_RADIUS_CELLS = 0.6;

export interface DispatchEnv {
  client: SimClient;
  db: ContentDb;
  mapWidth: number;
  mapHeight: number;
  heights: ArrayLike<number>;
  camera: THREE.Camera;
  size: { height: number };
  // Canvas element bounds for screen → NDC/box projection.
  rect: () => { left: number; top: number; width: number; height: number };
}

function ownSubjectForHandle(
  snapshot: Snapshot | null,
  observer: number,
  units: ReadonlyMap<number, { x: number; y: number; faction: number }>,
  handle: number,
): PinnableSubject {
  const unit = units.get(handle);
  if (unit !== undefined && unit.faction === observer) {
    return { kind: 'own_unit', handle };
  }
  const structures = structuresChannel(snapshot);
  if (structures !== null) {
    for (let i = 0; i < structures.handles.length; i++) {
      if (structures.handles[i] === handle && (structures.faction[i] ?? 0) === observer) {
        return { kind: 'own_structure', handle };
      }
    }
  }
  const roadWorks = (snapshot?.channels[RoadWorksChannel.id] as RoadWorks | undefined) ?? null;
  if (roadWorks !== null) {
    for (let i = 0; i < roadWorks.segments.handles.length; i++) {
      if (roadWorks.segments.handles[i] === handle) {
        return { kind: 'road_segment', handle };
      }
    }
  }
  return { kind: 'own_unit', handle };
}

export function makeDispatch(env: DispatchEnv): (intent: Intent) => void {
  const { client, db, mapWidth, mapHeight, heights } = env;
  const raycaster = new THREE.Raycaster();

  const roadNetwork = (): LogisticsNetwork | null => {
    const latest = client.snapshots().latest;
    return (latest?.channels[LogisticsNetworkChannel.id] as LogisticsNetwork | undefined) ?? null;
  };

  const roadLinks = (): LogisticsNetwork['links'] | { a: []; pathOffsets: []; pathCells: [] } => {
    return roadNetwork()?.links ?? { a: [], pathOffsets: [], pathCells: [] };
  };

  const groundAt = (sx: number, sy: number): { x: number; y: number } | null => {
    const rect = env.rect();
    const ndc = new THREE.Vector2(
      ((sx - rect.left) / rect.width) * 2 - 1,
      -((sy - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, env.camera);
    const ray: Ray = {
      origin: {
        x: raycaster.ray.origin.x,
        y: raycaster.ray.origin.y,
        z: raycaster.ray.origin.z,
      },
      dir: {
        x: raycaster.ray.direction.x,
        y: raycaster.ray.direction.y,
        z: raycaster.ray.direction.z,
      },
    };
    return pickGround(ray, heights, mapWidth, mapHeight);
  };

  // Screen-pixel projection of a world point (box selection).
  const project = (x: number, y: number): { x: number; y: number } => {
    const rect = env.rect();
    const v = new THREE.Vector3(x, terrainY(heights, mapWidth, mapHeight, x, y), y);
    v.project(env.camera);
    return {
      x: ((v.x + 1) / 2) * rect.width + rect.left,
      y: ((1 - v.y) / 2) * rect.height + rect.top,
    };
  };

  return (intent: Intent): void => {
    const now = performance.now();
    switch (intent.kind) {
      case 'camera.zoom': {
        useCameraStore.getState().zoomToward(intent.delta, groundAt(intent.x, intent.y));
        return;
      }
      case 'camera.pan_px': {
        const cam = useCameraStore.getState();
        const cpp = visibleGroundHeight(cam.mode, cam.zoom) / env.size.height;
        cam.panBy(intent.dx * cpp, intent.dy * cpp);
        return;
      }
      case 'cursor.move': {
        cursorState.setScreen(intent.x, intent.y);
        const ground = groundAt(intent.x, intent.y);
        cursorState.setGround(ground);
        const latest = client.snapshots().latest;
        const observer = latest?.observer ?? -1;
        const units = interpolatedUnits(client.snapshots(), now);
        const picked =
          ground !== null
            ? pickSubjectAt(
                db,
                { width: mapWidth, height: mapHeight },
                latest,
                observer,
                units,
                ground.x,
                ground.y,
                CLICK_RADIUS_CELLS,
              )
            : { ownHandle: null, subject: null };
        useInspectorStore.getState().setHovered(picked.subject);

        const interaction = useInteractionStore.getState();
        if (interaction.tool.kind === 'road') {
          const link =
            ground === null ? -1 : nearestLink(roadLinks(), mapWidth, ground.x, ground.y);
          interaction.setRoadHover(link);
        } else if (interaction.tool.kind === 'demolish') {
          const hit =
            ground === null
              ? null
              : pickDemolishableAt(db, latest, observer, ground.x, ground.y, CLICK_RADIUS_CELLS);
          interaction.setDemolishHover(
            hit === null ? null : { handle: hit.handle, refunds: hit.refunds },
          );
        }
        return;
      }
      case 'road.click': {
        const ground = groundAt(intent.x, intent.y);
        if (ground === null) {
          return;
        }
        const interaction = useInteractionStore.getState();
        const link = nearestLink(roadLinks(), mapWidth, ground.x, ground.y);
        if (link === -1) {
          return;
        }
        const net = roadNetwork();
        const key = net === null ? null : linkKey(net, link);
        if (key === null) {
          return;
        }
        if (intent.additive) {
          interaction.toggleRoadLink(key);
          return;
        }
        if (interaction.roadSel.some((k) => sameKey(k, key.a, key.b))) {
          submitRoadOrder(client, db);
          return;
        }
        const latest = client.snapshots().latest;
        interaction.setRoadSel(extendRoadSelection(db, latest, link));
        return;
      }
      case 'build.place': {
        const interaction = useInteractionStore.getState();
        if (interaction.tool.kind !== 'place') {
          return;
        }
        const ground = groundAt(intent.x, intent.y);
        if (ground === null) {
          return;
        }
        const kind = interaction.tool.structureKindId;
        const resolved = db.structures.byId(kind);
        if (resolved === undefined) {
          interaction.exitTool();
          return;
        }
        const { x, y } = centeredFootprint(ground.x, ground.y, resolved.footprint);
        client.submit({
          type: PlaceCommand.type,
          payload: { kind, x, y, blueprint: intent.blueprint },
        });
        // Blueprint placement (Shift) stays in place tool; direct placement exits it.
        if (!intent.blueprint) {
          interaction.exitTool();
        }
        return;
      }
      case 'demolish.click': {
        const ground = groundAt(intent.x, intent.y);
        if (ground === null) {
          return;
        }
        const latest = client.snapshots().latest;
        const observer = latest?.observer ?? -1;
        const hit = pickDemolishableAt(
          db,
          latest,
          observer,
          ground.x,
          ground.y,
          CLICK_RADIUS_CELLS,
        );
        if (hit !== null) {
          client.submit({
            type: CancelCommand.type,
            payload: { targets: [hit.handle] },
          });
        }
        return;
      }
      case 'select.click': {
        const ground = groundAt(intent.x, intent.y);
        const selection = useSelectionStore.getState();
        const inspector = useInspectorStore.getState();
        if (ground === null) {
          if (!intent.additive) {
            selection.clear();
            inspector.unpin();
            useInteractionStore.getState().clearDemolishConfirm();
          }
          return;
        }
        const latest = client.snapshots().latest;
        const observer = latest?.observer ?? -1;
        const units = interpolatedUnits(client.snapshots(), now);
        const picked = pickSubjectAt(
          db,
          { width: mapWidth, height: mapHeight },
          latest,
          observer,
          units,
          ground.x,
          ground.y,
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
        return;
      }
      case 'select.box': {
        const latest = client.snapshots().latest;
        const observer = latest?.observer ?? -1;
        const mode = useInteractionStore.getState().mode;
        const units = interpolatedUnits(client.snapshots(), now);
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
            const p = project(u.x, u.y);
            if (inside(p.x, p.y)) {
              picked.add(handle);
            }
          }
        }
        if (mode === 'build' || picked.size === 0) {
          const structures = structuresChannel(latest);
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
              const p = project(cx, cy);
              if (inside(p.x, p.y)) {
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
        return;
      }
      case 'command.move_to': {
        const ground = groundAt(intent.x, intent.y);
        if (ground === null) {
          return;
        }
        const selected = [...useSelectionStore.getState().selected];
        if (selected.length === 0) {
          return;
        }
        submitMoveOrder(
          client,
          client.snapshots().latest,
          selected,
          Math.floor(ground.x),
          Math.floor(ground.y),
          intent.guard,
        );
        useSelectionStore.getState().markMoveTarget(ground.x, ground.y, now);
        return;
      }
      default:
    }
  };
}
