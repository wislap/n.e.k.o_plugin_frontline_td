// Canvas input dispatch (M3 D): turns screen-space intents into picks,
// selections, build placements, and commands. Split out of GameCanvas to
// keep it under the file-size ratchet; picking helpers live in
// client/pick.ts so the priority rules stay unit-testable.
import * as THREE from 'three';
import { useBuildStore } from '../client/build-store';
import { useCameraStore } from '../client/camera-store';
import { cursorGround, cursorScreen } from '../client/cursor';
import { pickAt, structuresChannel } from '../client/pick';
import type { SimClient } from '../client/sim-client';
import { useSelectionStore } from '../client/selection-store';
import type { ContentDb } from '../content/index';
import {
  ActivateCommand,
  CancelCommand,
  PlaceCommand,
  UpgradeLinksCommand,
} from '../features/construction/protocol';
import { LogisticsNetworkChannel, type LogisticsNetwork } from '../features/logistics/protocol';
import { linkFlow } from '../features/logistics/render/index';
import { extendRoute, linkPairs, nearestLink } from '../features/logistics/ui/index';
import { MoveCommand } from '../features/movement/protocol';
import { SquadsChannel, SquadsOrder, type SquadsSnapshot } from '../features/squads/protocol';
import { routeMoveSelection } from '../client/squad-controls';
import type { Intent } from '../input/intents';
import { pickGround, type Ray } from './picking';
import { interpolatedUnits } from './unit-pos';
import { visibleGroundHeight } from './camera/math';
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

  // Smoothed per-link flow (volOut + volIn) from the shared holder that
  // also feeds the overlay, updated once per snapshot.
  const flowedLinks = (): { a: number; b: number; flow: number }[] => {
    const latest = client.snapshots().latest;
    const net = roadNetwork();
    if (latest === null || net === null) {
      return [];
    }
    const vol = linkFlow(latest, net).vol;
    const out: { a: number; b: number; flow: number }[] = [];
    for (let i = 0; i < net.links.a.length; i++) {
      out.push({ a: net.links.a[i] ?? 0, b: net.links.b[i] ?? 0, flow: vol[i] ?? 0 });
    }
    return out;
  };

  // Node indices (into the network's nodes arrays) of the observer's
  // warehouse structures: extension never continues past them.
  const warehouseNodes = (): Set<number> => {
    const net = roadNetwork();
    const structures = structuresChannel(client.snapshots().latest);
    if (net === null || structures === null) {
      return new Set();
    }
    const warehouses = new Set<number>();
    for (let i = 0; i < structures.handles.length; i++) {
      const kind = db.structures.byIndex(structures.kind[i] ?? 0);
      if (kind?.node?.warehouse === true) {
        warehouses.add(structures.handles[i] ?? 0);
      }
    }
    const nodes = new Set<number>();
    for (let i = 0; i < net.nodes.handles.length; i++) {
      if (warehouses.has(net.nodes.handles[i] ?? 0)) {
        nodes.add(i);
      }
    }
    return nodes;
  };

  const submitRoadOrder = (): void => {
    const build = useBuildStore.getState();
    const net = roadNetwork();
    if (net === null || build.roadSel.length === 0) {
      return;
    }
    const links = linkPairs(net, build.roadSel);
    if (links.length > 0) {
      client.submit({ type: UpgradeLinksCommand.type, payload: { links, level: 1 } });
    }
    // Stay in road mode after submitting.
    build.setRoadSel([]);
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
        cursorScreen.x = intent.x;
        cursorScreen.y = intent.y;
        const ground = groundAt(intent.x, intent.y);
        cursorGround.valid = ground !== null;
        if (ground !== null) {
          cursorGround.x = ground.x;
          cursorGround.y = ground.y;
        }
        const build = useBuildStore.getState();
        if (build.roadMode) {
          const link =
            ground === null ? -1 : nearestLink(roadLinks(), mapWidth, ground.x, ground.y);
          if (link !== build.roadHover) {
            build.setRoadHover(link);
          }
        }
        return;
      }
      case 'road.toggle': {
        const build = useBuildStore.getState();
        if (build.roadMode) {
          build.cancel();
        } else {
          build.enterRoad();
        }
        return;
      }
      case 'road.confirm': {
        submitRoadOrder();
        return;
      }
      case 'road.click': {
        const ground = groundAt(intent.x, intent.y);
        if (ground === null) {
          return;
        }
        const build = useBuildStore.getState();
        const link = nearestLink(roadLinks(), mapWidth, ground.x, ground.y);
        if (link === -1) {
          return;
        }
        if (intent.additive) {
          build.toggleRoadLink(link);
          return;
        }
        if (build.roadSel.includes(link)) {
          submitRoadOrder();
          return;
        }
        const route = extendRoute(flowedLinks(), link, warehouseNodes());
        build.setRoadSel(route.includes(link) ? route : [link]);
        return;
      }
      case 'build.place': {
        const ground = groundAt(intent.x, intent.y);
        const kind = useBuildStore.getState().kind;
        if (ground === null || kind === null) {
          return;
        }
        const resolved = db.structures.byId(kind);
        if (resolved === undefined) {
          useBuildStore.getState().cancel();
          return;
        }
        // Top-left of the footprint centred on the cursor cell.
        const x = Math.floor(ground.x - resolved.footprint.w / 2);
        const y = Math.floor(ground.y - resolved.footprint.h / 2);
        client.submit({
          type: PlaceCommand.type,
          payload: { kind, x, y, blueprint: intent.blueprint },
        });
        // Blueprint placement (Shift) stays in build mode; a direct site
        // placement ends it.
        if (!intent.blueprint) {
          useBuildStore.getState().cancel();
        }
        return;
      }
      case 'build.cancel': {
        useBuildStore.getState().cancel();
        return;
      }
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
      case 'select.click': {
        const ground = groundAt(intent.x, intent.y);
        const store = useSelectionStore.getState();
        if (ground === null) {
          if (!intent.additive) {
            store.clear();
          }
          return;
        }
        const latest = client.snapshots().latest;
        const observer = latest?.observer ?? -1;
        const units = interpolatedUnits(client.snapshots(), now);
        // Unit wins; structure/blueprint/salvage only when no unit is near.
        const picked = pickAt(db, latest, observer, units, ground.x, ground.y, CLICK_RADIUS_CELLS);
        if (picked !== null) {
          store.setSelection(new Set([picked]), intent.additive);
        } else if (!intent.additive) {
          store.clear();
        }
        return;
      }
      case 'select.box': {
        const latest = client.snapshots().latest;
        const observer = latest?.observer ?? -1;
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
        for (const [handle, u] of units) {
          if (u.faction !== observer) {
            continue;
          }
          const p = project(u.x, u.y);
          if (inside(p.x, p.y)) {
            picked.add(handle);
          }
        }
        if (picked.size === 0) {
          // No units in the box: own structures/blueprints by centre.
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
        useSelectionStore.getState().setSelection(picked, intent.additive);
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
        const x = Math.floor(ground.x);
        const y = Math.floor(ground.y);
        // Squad members are ordered through their squad — a plain
        // MoveCommand on a member removes it from the squad (M4).
        const latest = client.snapshots().latest;
        const squads =
          (latest?.channels[SquadsChannel.id] as SquadsSnapshot | undefined)?.squads ?? [];
        const routing = routeMoveSelection(selected, squads, latest?.observer ?? -1);
        for (const squad of routing.squads) {
          client.submit({
            type: SquadsOrder.type,
            payload: intent.guard
              ? { squad, kind: 'guard', x, y }
              : { squad, kind: 'advance', x, y },
          });
        }
        if (routing.plain.length > 0) {
          client.submit({
            type: MoveCommand.type,
            payload: { units: routing.plain, x, y },
          });
        }
        useSelectionStore.getState().markMoveTarget(ground.x, ground.y, now);
        return;
      }
      default:
    }
  };
}
