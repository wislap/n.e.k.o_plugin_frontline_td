// Canvas input dispatch (ADR 0048/0062): the canvas-dependent half of the
// single intent router. The shell keeps the camera.* cases; every other
// canvas intent is delegated to a handler from the registry assembled in
// app/ (selection, construction, logistics, squads contributions).
import * as THREE from 'three';
import {
  clampCenter,
  intersectHorizontalPlane,
  rotatePanVector,
  spectateFocusElevation,
  visibleGroundHeight,
} from '../client/camera-math';
import { useCameraStore } from '../client/camera-store';
import { renderNowMs } from '../client/capture-mode';
import type { SimClient } from '../client/sim-client';
import type { ContentDb, ResolvedMap } from '../content/index';
import type { Intent } from '../input/intents';
import { pickGround, type Ray } from '../client/picking';
import type { CanvasInputEnv, CanvasIntentHandlerDef } from '../client/canvas-input';
import { getCameraElevationField, sampleCameraElevation, terrainY } from '../client/world';

export interface DispatchEnv {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  heights: ArrayLike<number>;
  camera: THREE.Camera | (() => THREE.Camera);
  size: { height: number };
  // Canvas element bounds for screen → NDC/box projection.
  rect: () => { left: number; top: number; width: number; height: number };
}

export function makeDispatch(
  env: DispatchEnv,
  canvasIntents: ReadonlyMap<Intent['kind'], CanvasIntentHandlerDef>,
): (intent: Intent) => void {
  const { client, db, map, heights } = env;
  const { width: mapWidth, height: mapHeight } = map.grid;
  const raycaster = new THREE.Raycaster();
  const camOrGetter = env.camera;
  const getCamera: () => THREE.Camera =
    typeof camOrGetter === 'function' ? camOrGetter : () => camOrGetter;
  let panPlaneY = 0;

  const rayAt = (sx: number, sy: number): Ray => {
    const rect = env.rect();
    const ndc = new THREE.Vector2(
      rect.width > 0 ? ((sx - rect.left) / rect.width) * 2 - 1 : 0,
      rect.height > 0 ? -((sy - rect.top) / rect.height) * 2 + 1 : 0,
    );
    raycaster.setFromCamera(ndc, getCamera());
    return {
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
  };

  const groundAt = (sx: number, sy: number): { x: number; y: number } | null => {
    return pickGround(rayAt(sx, sy), heights, mapWidth, mapHeight);
  };

  // Screen-pixel projection of a world point (box selection), checking frustum Z depth.
  const project = (
    x: number,
    y: number,
    elevOffset = 0,
  ): { x: number; y: number; inFront: boolean } => {
    const rect = env.rect();
    const v = new THREE.Vector3(x, terrainY(heights, mapWidth, mapHeight, x, y) + elevOffset, y);
    v.project(getCamera());
    return {
      x: ((v.x + 1) / 2) * rect.width + rect.left,
      y: ((1 - v.y) / 2) * rect.height + rect.top,
      inFront: v.z >= -1 && v.z <= 1,
    };
  };

  const inputEnv: CanvasInputEnv = { client, db, map, heights, rayAt, groundAt, project };

  return (intent: Intent): void => {
    const now = renderNowMs();
    switch (intent.kind) {
      case 'camera.zoom': {
        const cam = useCameraStore.getState();
        const ground = groundAt(intent.x, intent.y);
        const rect = env.rect();
        const ndcX = rect.width > 0 ? ((intent.x - rect.left) / rect.width) * 2 - 1 : 0;
        const ndcY = rect.height > 0 ? -((intent.y - rect.top) / rect.height) * 2 + 1 : 0;
        const aspect = rect.height > 0 && rect.width > 0 ? rect.width / rect.height : 16 / 9;
        const elevField = getCameraElevationField(heights, mapWidth, mapHeight);
        const localSmoothY = sampleCameraElevation(elevField, cam.center.x, cam.center.y);
        const centerY = spectateFocusElevation(cam.zoom, elevField.baseY, localSmoothY);
        const planeY =
          ground !== null ? terrainY(heights, mapWidth, mapHeight, ground.x, ground.y) : centerY;
        cam.zoomToward(intent.delta, ground, {
          ndcX,
          ndcY,
          aspect,
          centerY,
          baseY: elevField.baseY,
          localSmoothY,
          planeY,
        });
        const next = useCameraStore.getState();
        next.setCenter(clampCenter(next.center, mapWidth, mapHeight));
        return;
      }
      case 'camera.pan_start': {
        const g = groundAt(intent.x, intent.y);
        const cam = useCameraStore.getState();
        if (g !== null) {
          panPlaneY = terrainY(heights, mapWidth, mapHeight, g.x, g.y);
        } else {
          const elevField = getCameraElevationField(heights, mapWidth, mapHeight);
          panPlaneY = spectateFocusElevation(
            cam.zoom,
            elevField.baseY,
            sampleCameraElevation(elevField, cam.center.x, cam.center.y),
          );
        }
        return;
      }
      case 'camera.pan_px': {
        const cam = useCameraStore.getState();
        const hit0 = intersectHorizontalPlane(rayAt(intent.prevX, intent.prevY), panPlaneY);
        const hit1 = intersectHorizontalPlane(rayAt(intent.x, intent.y), panPlaneY);
        const extent = visibleGroundHeight(cam.mode, cam.zoom, cam.pitchOffsetDeg);
        let dx: number;
        let dy: number;
        if (hit0 !== null && hit1 !== null) {
          dx = hit0.x - hit1.x;
          dy = hit0.y - hit1.y;
          const step = Math.hypot(dx, dy);
          const maxStep = Math.max(4, extent * 0.75);
          if (step > maxStep) {
            const s = maxStep / step;
            dx *= s;
            dy *= s;
          }
        } else {
          const cpp = extent / Math.max(1, env.size.height);
          const fallback = rotatePanVector(
            { x: (intent.prevX - intent.x) * cpp, y: (intent.prevY - intent.y) * cpp },
            cam.yaw,
          );
          dx = fallback.x;
          dy = fallback.y;
        }
        cam.setCenter(
          clampCenter({ x: cam.center.x + dx, y: cam.center.y + dy }, mapWidth, mapHeight),
        );
        return;
      }
      default: {
        canvasIntents.get(intent.kind)?.handle(intent, inputEnv, now);
        return;
      }
    }
  };
}
