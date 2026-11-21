// Camera rig (M2 C4): owns the perspective + orthographic cameras, applies
// held-key panning and zoom every frame, and animates 400 ms ease-in-out
// mode transitions (pitch to 90°, swap, pitch back down).
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCameraStore } from '../../client/camera-store';
import type { PanTracker } from '../../input/pan';
import {
  CAMERA_UP,
  SPECTATE_FOV_DEG,
  SPECTATE_PITCH_DEG,
  TRANSITION_MS,
  clampCenter,
  clampSpectateDist,
  clampTacticalHeight,
  easeInOut,
  perspectiveDistAtPitch,
  spectateCameraPosition,
  visibleGroundHeight,
} from '../../client/camera-math';

const FAR = 500;
const ORTHO_HEIGHT = 200;
// Pan speed: one full visible height per second.
const PAN_SPEED = 1.0;

interface Transition {
  startedAt: number;
  // Pitch degrees the animation runs between (55→90 or 90→55).
  fromPitch: number;
  toPitch: number;
  // Constant ground extent kept during the transition.
  extent: number;
}

interface Cameras {
  persp: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
}

export function CameraRig({
  mapWidth,
  mapHeight,
  panTracker,
}: {
  mapWidth: number;
  mapHeight: number;
  panTracker: PanTracker;
}) {
  const set = useThree((s) => s.set);
  const size = useThree((s) => s.size);

  const cameras = useRef<Cameras | null>(null);
  const transition = useRef<Transition | null>(null);
  const lastMode = useRef<'spectate' | 'tactical'>(useCameraStore.getState().mode);
  const activeCamera = useRef<THREE.Camera | null>(null);

  // Create both cameras once and register the perspective camera.
  useEffect(() => {
    if (cameras.current === null) {
      const persp = new THREE.PerspectiveCamera(SPECTATE_FOV_DEG, 1, 0.1, FAR);
      // Map north (-Z) as the up reference: never parallel to the view for
      // pitch in (0°, 90°], so lookAt stays defined all through the
      // transition (the tactical→spectate leg starts exactly at 90°).
      persp.up.set(CAMERA_UP.x, CAMERA_UP.y, CAMERA_UP.z);
      const ortho = new THREE.OrthographicCamera();
      ortho.up.set(CAMERA_UP.x, CAMERA_UP.y, CAMERA_UP.z);
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
    const aspect = size.width / size.height;

    // Register the active camera only when it actually changes.
    const activate = (camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void => {
      if (activeCamera.current !== camera) {
        activeCamera.current = camera;
        set({ camera });
      }
    };

    // Held-key pan: speed proportional to the visible extent.
    const pan = panTracker.panVector();
    let center = clampCenter(cam.center, mapWidth, mapHeight);
    if (pan.x !== 0 || pan.y !== 0) {
      const extent = visibleGroundHeight(cam.mode, cam.zoom);
      const speed = extent * PAN_SPEED * delta;
      center = clampCenter(
        { x: center.x + pan.x * speed, y: center.y + pan.y * speed },
        mapWidth,
        mapHeight,
      );
      cam.setCenter(center);
    }

    if (cam.mode !== lastMode.current) {
      // Mode changed: run the pitch animation on the perspective camera.
      // The store zoom was already converted to the new mode by
      // matchZoomForMode; visibleGroundHeight gives the common extent the
      // transition keeps constant.
      const toTactical = cam.mode === 'tactical';
      transition.current = {
        startedAt: performance.now(),
        fromPitch: toTactical ? SPECTATE_PITCH_DEG : 90,
        toPitch: toTactical ? 90 : SPECTATE_PITCH_DEG,
        extent: visibleGroundHeight(cam.mode, cam.zoom),
      };
      lastMode.current = cam.mode;
      activate(persp);
    }

    const t = transition.current;
    if (t !== null) {
      const k = easeInOut((performance.now() - t.startedAt) / TRANSITION_MS);
      const finished = k >= 1;
      // Drive the perspective camera until the very last frame; on the
      // final frame of a →tactical transition the ortho camera takes over.
      if (!(finished && cam.mode === 'tactical')) {
        const pitch = t.fromPitch + (t.toPitch - t.fromPitch) * k;
        const dist = perspectiveDistAtPitch(t.extent, pitch);
        const pos = spectateCameraPosition(center, dist, pitch);
        persp.position.set(pos.x, pos.y, pos.z);
        persp.lookAt(center.x, 0, center.y);
      }
      if (finished) {
        transition.current = null;
        if (cam.mode === 'tactical') {
          activate(ortho);
        }
      }
      return;
    }

    if (cam.mode === 'tactical') {
      const h = clampTacticalHeight(cam.zoom);
      ortho.left = (-h * aspect) / 2;
      ortho.right = (h * aspect) / 2;
      ortho.top = h / 2;
      ortho.bottom = -h / 2;
      ortho.near = 0.1;
      ortho.far = FAR;
      ortho.updateProjectionMatrix();
      // Straight down; screen-up is scene -Z (up set once at creation).
      ortho.position.set(center.x, ORTHO_HEIGHT, center.y);
      ortho.lookAt(center.x, 0, center.y);
      activate(ortho);
    } else {
      const dist = clampSpectateDist(cam.zoom);
      const pos = spectateCameraPosition(center, dist, SPECTATE_PITCH_DEG);
      persp.position.set(pos.x, pos.y, pos.z);
      persp.lookAt(center.x, 0, center.y);
      activate(persp);
    }
  });

  return null;
}
