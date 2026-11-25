// Orbital camera rig (ADR 0028, ADR 0051, ADR 0060): owns the perspective
// + orthographic cameras, applies held-key yaw-aligned panning and rotation,
// smoothly damps focus/yaw/distance/pitch, and animates 400 ms ease-in-out
// mode transitions while keeping current yaw.
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCameraStore } from '../../client/camera-store';
import type { PanTracker } from '../../input/pan';
import type { SceneLayerProps } from '../scene';
import {
  SPECTATE_FOV_DEG,
  TRANSITION_MS,
  clampCenter,
  clampSpectateDist,
  clampTacticalHeight,
  easeInOut,
  effectiveSpectatePitchDeg,
  frameDampingAlpha,
  matchZoomForMode,
  orbitalCameraPose,
  orthoClipPlanes,
  perspectiveClipPlanes,
  perspectiveDistAtPitch,
  rotatePanVector,
  visibleGroundHeight,
} from '../../client/camera-math';
import { terrainY } from '../world';

const ORTHO_HEIGHT = 200;
// Pan speed: one full visible ground height per second.
const PAN_SPEED = 1.0;
// Keyboard yaw rotation speed (Q / E) in radians per second.
const YAW_KEY_SPEED = 1.85;

const TAU_CENTER = 0.025;
const TAU_HEIGHT = 0.08;
const TAU_ORBIT = 0.045;
const TAU_ZOOM = 0.055;

function syncPerspClip(
  persp: THREE.PerspectiveCamera,
  dist: number,
  mapWidth: number,
  mapHeight: number,
): void {
  const clip = perspectiveClipPlanes(dist, mapWidth, mapHeight);
  if (Math.abs(persp.near - clip.near) > 1e-3 || Math.abs(persp.far - clip.far) > 1e-3) {
    persp.near = clip.near;
    persp.far = clip.far;
    persp.updateProjectionMatrix();
  }
}

interface Transition {
  startedAt: number;
  fromPitch: number;
  toPitch: number;
  extent: number;
}

interface Cameras {
  persp: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
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
  const set = useThree((s) => s.set);
  const size = useThree((s) => s.size);

  const cameras = useRef<Cameras | null>(null);
  const transition = useRef<Transition | null>(null);
  const lastMode = useRef<'spectate' | 'tactical'>(useCameraStore.getState().mode);
  const activeCamera = useRef<THREE.Camera | null>(null);
  const smoothed = useRef<SmoothedState>({
    initialized: false,
    x: 0,
    y: 0,
    centerY: 0,
    yaw: 0,
    dist: 30,
    pitchDeg: 55,
    orthoHeight: 30,
  });

  // Create both cameras once with singularity-free YXZ Euler ordering.
  useEffect(() => {
    if (cameras.current === null) {
      const initialClip = perspectiveClipPlanes(
        clampSpectateDist(useCameraStore.getState().zoom),
        1,
        1,
      );
      const persp = new THREE.PerspectiveCamera(
        SPECTATE_FOV_DEG,
        1,
        initialClip.near,
        initialClip.far,
      );
      persp.rotation.order = 'YXZ';
      const ortho = new THREE.OrthographicCamera();
      ortho.rotation.order = 'YXZ';
      cameras.current = { persp, ortho };
    }
    activeCamera.current = cameras.current.persp;
    set({ camera: cameras.current.persp });
  }, [set]);

  // Keep the perspective aspect in sync with the canvas size.
  useEffect(() => {
    const c = cameras.current;
    if (c === null) {
      return;
    }
    c.persp.aspect = size.width / size.height;
    c.persp.updateProjectionMatrix();
  }, [size]);

  useFrame((_, delta) => {
    const c = cameras.current;
    if (c === null) {
      return;
    }
    const { persp, ortho } = c;
    const cam = useCameraStore.getState();
    const aspect = size.height > 0 ? size.width / size.height : 16 / 9;
    const dt = Math.min(0.1, Math.max(0, delta));
    const s = smoothed.current;

    const activate = (camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void => {
      if (activeCamera.current !== camera) {
        activeCamera.current = camera;
        set({ camera });
      }
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
    const targetCenterY = terrainY(heights, mapWidth, mapHeight, targetCenter.x, targetCenter.y);
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
      s.centerY = targetCenterY;
      s.yaw = latest.yaw;
      s.dist = targetDist;
      s.pitchDeg = targetPitchDeg;
      s.orthoHeight = targetOrthoH;
    } else {
      const aCenter = frameDampingAlpha(dt, TAU_CENTER);
      const aHeight = frameDampingAlpha(dt, TAU_HEIGHT);
      const aOrbit = frameDampingAlpha(dt, TAU_ORBIT);
      const aZoom = frameDampingAlpha(dt, TAU_ZOOM);
      s.x += (targetCenter.x - s.x) * aCenter;
      s.y += (targetCenter.y - s.y) * aCenter;
      s.centerY += (targetCenterY - s.centerY) * aHeight;
      s.yaw += (latest.yaw - s.yaw) * aOrbit;
      s.dist += (targetDist - s.dist) * aZoom;
      s.pitchDeg += (targetPitchDeg - s.pitchDeg) * aZoom;
      s.orthoHeight += (targetOrthoH - s.orthoHeight) * aZoom;
    }

    if (latest.mode !== lastMode.current) {
      const toTactical = latest.mode === 'tactical';
      transition.current = {
        startedAt: performance.now(),
        fromPitch: toTactical ? s.pitchDeg : 90,
        toPitch: toTactical ? 90 : targetPitchDeg,
        extent: visibleGroundHeight(latest.mode, latest.zoom, latest.pitchOffsetDeg),
      };
      lastMode.current = latest.mode;
      activate(persp);
    }

    const t = transition.current;
    if (t !== null) {
      const k = easeInOut((performance.now() - t.startedAt) / TRANSITION_MS);
      const finished = k >= 1;
      t.extent = visibleGroundHeight(latest.mode, latest.zoom, latest.pitchOffsetDeg);
      if (latest.mode === 'spectate') {
        t.toPitch = targetPitchDeg;
      }
      if (!(finished && latest.mode === 'tactical')) {
        const pitch = t.fromPitch + (t.toPitch - t.fromPitch) * k;
        const dist = perspectiveDistAtPitch(t.extent, pitch);
        syncPerspClip(persp, dist, mapWidth, mapHeight);
        const pose = orbitalCameraPose({ x: s.x, y: s.y }, s.centerY, dist, s.yaw, pitch);
        persp.position.set(pose.position.x, pose.position.y, pose.position.z);
        persp.rotation.set(pose.eulerYXZ.x, pose.eulerYXZ.y, 0);
        persp.updateMatrixWorld();
      }
      if (finished) {
        transition.current = null;
        if (latest.mode === 'tactical') {
          activate(ortho);
        }
      }
      return;
    }

    if (latest.mode === 'tactical') {
      const h = s.orthoHeight;
      const clip = orthoClipPlanes(ORTHO_HEIGHT + s.centerY);
      ortho.left = (-h * aspect) / 2;
      ortho.right = (h * aspect) / 2;
      ortho.top = h / 2;
      ortho.bottom = -h / 2;
      ortho.near = clip.near;
      ortho.far = clip.far;
      ortho.updateProjectionMatrix();
      ortho.position.set(s.x, ORTHO_HEIGHT + s.centerY, s.y);
      ortho.rotation.set(-Math.PI / 2, -s.yaw, 0);
      ortho.updateMatrixWorld();
      activate(ortho);
    } else {
      syncPerspClip(persp, s.dist, mapWidth, mapHeight);
      const pose = orbitalCameraPose({ x: s.x, y: s.y }, s.centerY, s.dist, s.yaw, s.pitchDeg);
      persp.position.set(pose.position.x, pose.position.y, pose.position.z);
      persp.rotation.set(pose.eulerYXZ.x, pose.eulerYXZ.y, 0);
      persp.updateMatrixWorld();
      activate(persp);
    }
  });

  return null;
}
