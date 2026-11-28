// Orbital camera rig (ADR 0028, ADR 0051, ADR 0060): owns the shared
// perspective + orthographic cameras, applies held-key yaw-aligned panning and
// rotation, smoothly damps focus/yaw/distance/pitch, and animates reversible
// Dolly-Zoom mode transitions at priority -500 while keeping current yaw.
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCameraStore } from '../../client/camera-store';
import type { PanTracker } from '../../input/pan';
import type { SceneLayerProps } from '../scene';
import {
  SPECTATE_FOV_DEG,
  SPECTATE_PITCH_DEG,
  TRANSITION_MS,
  clampCenter,
  clampSpectateDist,
  clampTacticalHeight,
  dollyZoomFovDeg,
  easeInOut,
  effectiveSpectatePitchDeg,
  frameDampingAlpha,
  matchZoomForMode,
  orbitalCameraPose,
  orthoClipPlanes,
  orthoHeightForPerspectiveDist,
  perspectiveClipPlanes,
  perspectiveDistAtPitch,
  perspectiveTransitionClipPlanes,
  rotatePanVector,
  spectateFocusElevation,
  visibleGroundHeight,
} from '../../client/camera-math';
import { getCameraElevationField, sampleCameraElevation } from '../../client/world';
import { writeCameraTransitionState } from '../camera-transition';
import { getSceneCameras, syncActiveSceneCamera } from '../composer-ref';

const ORTHO_HEIGHT = 200;
// Pan speed: one full visible ground height per second.
const PAN_SPEED = 1.0;
// Keyboard yaw rotation speed (Q / E) in radians per second.
const YAW_KEY_SPEED = 1.85;

const TAU_CENTER = 0.025;
const TAU_HEIGHT = 0.08;
const TAU_ORBIT = 0.045;
const TAU_ZOOM = 0.055;

function syncPerspAspect(persp: THREE.PerspectiveCamera, aspect: number): void {
  if (Math.abs(persp.aspect - aspect) > 1e-4) {
    persp.aspect = aspect;
    persp.updateProjectionMatrix();
  }
}

function resetPerspFov(persp: THREE.PerspectiveCamera): void {
  if (Math.abs(persp.fov - SPECTATE_FOV_DEG) > 1e-4) {
    persp.fov = SPECTATE_FOV_DEG;
    persp.updateProjectionMatrix();
  }
}

function syncPerspProjection(
  persp: THREE.PerspectiveCamera,
  fov: number,
  aspect: number,
  near: number,
  far: number,
): void {
  let dirty = false;
  if (Math.abs(persp.fov - fov) > 1e-4) {
    persp.fov = fov;
    dirty = true;
  }
  if (Math.abs(persp.aspect - aspect) > 1e-4) {
    persp.aspect = aspect;
    dirty = true;
  }
  if (Math.abs(persp.near - near) > 1e-3 || Math.abs(persp.far - far) > 1e-3) {
    persp.near = near;
    persp.far = far;
    dirty = true;
  }
  if (dirty) {
    persp.updateProjectionMatrix();
  }
}

function applyPerspOrbitalPose(
  persp: THREE.PerspectiveCamera,
  x: number,
  y: number,
  centerY: number,
  dist: number,
  yaw: number,
  pitchDeg: number,
): void {
  const pose = orbitalCameraPose({ x, y }, centerY, dist, yaw, pitchDeg);
  persp.position.set(pose.position.x, pose.position.y, pose.position.z);
  persp.rotation.set(pose.eulerYXZ.x, pose.eulerYXZ.y, 0);
  persp.updateMatrixWorld();
}

function applyOrthoPose(
  ortho: THREE.OrthographicCamera,
  h: number,
  aspect: number,
  x: number,
  y: number,
  centerY: number,
  yaw: number,
): void {
  const clip = orthoClipPlanes(ORTHO_HEIGHT + centerY);
  ortho.left = (-h * aspect) / 2;
  ortho.right = (h * aspect) / 2;
  ortho.top = h / 2;
  ortho.bottom = -h / 2;
  ortho.near = clip.near;
  ortho.far = clip.far;
  ortho.updateProjectionMatrix();
  ortho.position.set(x, ORTHO_HEIGHT + centerY, y);
  ortho.rotation.set(-Math.PI / 2, -yaw, 0);
  ortho.updateMatrixWorld();
}

interface Transition {
  startedAt: number;
  fromBlend: number;
  toBlend: 0 | 1;
  durationMs: number;
}

interface SmoothedState {
  initialized: boolean;
  x: number;
  y: number;
  centerY: number;
  yaw: number;
  dist: number;
  pitchDeg: number;
  orthoHeight: number;
}

export function CameraRig({ ctx, panTracker }: SceneLayerProps & { panTracker: PanTracker }) {
  const { heights } = ctx;
  const { width: mapWidth, height: mapHeight } = ctx.map.grid;
  const gl = useThree((s) => s.gl);
  const set = useThree((s) => s.set);
  const size = useThree((s) => s.size);

  const transition = useRef<Transition | null>(null);
  const lastMode = useRef<'spectate' | 'tactical'>(useCameraStore.getState().mode);
  const blendRef = useRef<number>(useCameraStore.getState().mode === 'tactical' ? 1 : 0);
  const activeCamera = useRef<THREE.Camera | null>(null);
  const smoothed = useRef<SmoothedState>({
    initialized: false,
    x: 0,
    y: 0,
    centerY: 0,
    yaw: 0,
    dist: 30,
    pitchDeg: SPECTATE_PITCH_DEG,
    orthoHeight: 30,
  });

  // Activate the initial mode's camera on the shared renderer camera pair.
  useEffect(() => {
    const { persp, ortho } = getSceneCameras(gl);
    const initialTactical = useCameraStore.getState().mode === 'tactical';
    blendRef.current = initialTactical ? 1 : 0;
    lastMode.current = initialTactical ? 'tactical' : 'spectate';
    const initialCam = initialTactical ? ortho : persp;
    activeCamera.current = initialCam;
    set({ camera: initialCam });
    syncActiveSceneCamera(initialCam);
    writeCameraTransitionState(blendRef.current, 0, initialTactical ? 90 : SPECTATE_PITCH_DEG);
  }, [gl, set]);

  // Keep the perspective aspect in sync with the canvas size.
  useEffect(() => {
    const { persp } = getSceneCameras(gl);
    const aspect = size.height > 0 ? size.width / size.height : 16 / 9;
    syncPerspAspect(persp, aspect);
  }, [gl, size.width, size.height]);

  useFrame((_, delta) => {
    const { persp, ortho } = getSceneCameras(gl);
    const cam = useCameraStore.getState();
    const aspect = size.height > 0 ? size.width / size.height : 16 / 9;
    const dt = Math.min(0.1, Math.max(0, delta));
    const s = smoothed.current;

    const activate = (camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void => {
      if (activeCamera.current !== camera) {
        activeCamera.current = camera;
        set({ camera });
      }
      syncActiveSceneCamera(camera);
    };

    // Continuous keyboard yaw orbit (Q / E).
    const yawDir = panTracker.yawDelta();
    if (yawDir !== 0) {
      cam.orbitBy(yawDir * YAW_KEY_SPEED * dt, 0);
    }

    // Continuous held-key pan aligned with current visual yaw.
    const pan = panTracker.panVector();
    if (pan.x !== 0 || pan.y !== 0) {
      const current = useCameraStore.getState();
      const extent = visibleGroundHeight(current.mode, current.zoom, current.pitchOffsetDeg);
      const speed = extent * PAN_SPEED * dt;
      const worldPan = rotatePanVector(pan, s.initialized ? s.yaw : current.yaw);
      const clamped = clampCenter(
        { x: current.center.x + worldPan.x * speed, y: current.center.y + worldPan.y * speed },
        mapWidth,
        mapHeight,
      );
      current.setCenter(clamped);
    }

    const latest = useCameraStore.getState();
    const targetCenter = clampCenter(latest.center, mapWidth, mapHeight);
    const elevField = getCameraElevationField(heights, mapWidth, mapHeight);
    const targetDist =
      latest.mode === 'spectate'
        ? clampSpectateDist(latest.zoom)
        : clampSpectateDist(matchZoomForMode('spectate', latest.zoom, latest.pitchOffsetDeg));
    const targetPitchDeg = effectiveSpectatePitchDeg(targetDist, latest.pitchOffsetDeg);
    const targetOrthoH =
      latest.mode === 'tactical'
        ? clampTacticalHeight(latest.zoom)
        : clampTacticalHeight(visibleGroundHeight('spectate', latest.zoom, latest.pitchOffsetDeg));

    if (!s.initialized) {
      s.initialized = true;
      s.x = targetCenter.x;
      s.y = targetCenter.y;
      s.yaw = latest.yaw;
      s.dist = targetDist;
      s.pitchDeg = targetPitchDeg;
      s.orthoHeight = targetOrthoH;
      s.centerY = spectateFocusElevation(
        s.dist,
        elevField.baseY,
        sampleCameraElevation(elevField, s.x, s.y),
      );
    } else {
      const aCenter = frameDampingAlpha(dt, TAU_CENTER);
      const aHeight = frameDampingAlpha(dt, TAU_HEIGHT);
      const aOrbit = frameDampingAlpha(dt, TAU_ORBIT);
      const aZoom = frameDampingAlpha(dt, TAU_ZOOM);
      s.x += (targetCenter.x - s.x) * aCenter;
      s.y += (targetCenter.y - s.y) * aCenter;
      s.yaw += (latest.yaw - s.yaw) * aOrbit;
      s.dist += (targetDist - s.dist) * aZoom;
      s.pitchDeg += (targetPitchDeg - s.pitchDeg) * aZoom;
      s.orthoHeight += (targetOrthoH - s.orthoHeight) * aZoom;
      const desiredCenterY = spectateFocusElevation(
        s.dist,
        elevField.baseY,
        sampleCameraElevation(elevField, s.x, s.y),
      );
      s.centerY += (desiredCenterY - s.centerY) * aHeight;
    }

    if (latest.mode !== lastMode.current) {
      const toBlend: 0 | 1 = latest.mode === 'tactical' ? 1 : 0;
      const cur = blendRef.current;
      const span = Math.abs(toBlend - cur);
      transition.current =
        span < 1e-4
          ? null
          : {
              startedAt: performance.now(),
              fromBlend: cur,
              toBlend,
              durationMs: Math.max(80, TRANSITION_MS * span),
            };
      lastMode.current = latest.mode;
    }

    let blend: number;
    const t = transition.current;
    if (t !== null) {
      const raw = (performance.now() - t.startedAt) / t.durationMs;
      if (raw >= 1) {
        blend = t.toBlend;
        transition.current = null;
      } else {
        blend = t.fromBlend + (t.toBlend - t.fromBlend) * easeInOut(raw);
      }
    } else {
      blend = latest.mode === 'tactical' ? 1 : 0;
    }
    blendRef.current = blend;

    if (blend >= 1) {
      applyOrthoPose(ortho, s.orthoHeight, aspect, s.x, s.y, s.centerY, s.yaw);
      resetPerspFov(persp);
      syncPerspAspect(persp, aspect);
      writeCameraTransitionState(1, 0, 90);
      activate(ortho);
    } else if (blend <= 0) {
      const clip = perspectiveClipPlanes(s.dist, mapWidth, mapHeight);
      syncPerspProjection(persp, SPECTATE_FOV_DEG, aspect, clip.near, clip.far);
      applyPerspOrbitalPose(persp, s.x, s.y, s.centerY, s.dist, s.yaw, s.pitchDeg);
      writeCameraTransitionState(0, 0, s.pitchDeg);
      activate(persp);
    } else {
      const extent3d =
        orthoHeightForPerspectiveDist(s.dist) / Math.sin((s.pitchDeg * Math.PI) / 180);
      const extent = extent3d + (s.orthoHeight - extent3d) * blend;
      const pitch = s.pitchDeg + (90 - s.pitchDeg) * blend;
      const fov = dollyZoomFovDeg(blend);
      const dist = perspectiveDistAtPitch(extent, pitch, fov);
      const clip = perspectiveTransitionClipPlanes(dist, mapWidth, mapHeight);
      syncPerspProjection(persp, fov, aspect, clip.near, clip.far);
      applyPerspOrbitalPose(persp, s.x, s.y, s.centerY, dist, s.yaw, pitch);
      const extraDist = Math.max(0, dist - s.dist);
      writeCameraTransitionState(blend, extraDist, pitch);
      activate(persp);
    }
  }, -500);

  return null;
}
