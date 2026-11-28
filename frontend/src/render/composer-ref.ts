// Shared handles for the postprocessing EffectComposer and the per-renderer
// Perspective + Orthographic camera pair so CameraRig, PostEffects and
// PerfProbe stay synchronized on the exact same frame without rebuilding
// EffectComposer or N8AOPostPass on camera mode switches.
import * as THREE from 'three';
import type { EffectComposer } from 'postprocessing';
import {
  SPECTATE_DEFAULT_DIST,
  SPECTATE_FOV_DEG,
  perspectiveClipPlanes,
} from '../client/camera-math';

export interface SceneCameras {
  readonly persp: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
}

const camerasByRenderer = new WeakMap<object, SceneCameras>();

export function getSceneCameras(rendererKey: object): SceneCameras {
  let pair = camerasByRenderer.get(rendererKey);
  if (pair === undefined) {
    const initialClip = perspectiveClipPlanes(SPECTATE_DEFAULT_DIST, 1, 1);
    const persp = new THREE.PerspectiveCamera(
      SPECTATE_FOV_DEG,
      1,
      initialClip.near,
      initialClip.far,
    );
    persp.rotation.order = 'YXZ';
    const ortho = new THREE.OrthographicCamera();
    ortho.rotation.order = 'YXZ';
    pair = { persp, ortho };
    camerasByRenderer.set(rendererKey, pair);
  }
  return pair;
}

export const effectComposerRef: { current: EffectComposer | null } = { current: null };
export const activeSceneCameraRef: { current: THREE.Camera | null } = { current: null };
let lastSyncedComposer: EffectComposer | null = null;
let lastSyncedCamera: THREE.Camera | null = null;

export function syncActiveSceneCamera(camera: THREE.Camera): void {
  activeSceneCameraRef.current = camera;
  const composer = effectComposerRef.current;
  if (composer !== null && (lastSyncedComposer !== composer || lastSyncedCamera !== camera)) {
    composer.setMainCamera(camera);
    lastSyncedComposer = composer;
    lastSyncedCamera = camera;
  }
}

export function setEffectComposer(composer: EffectComposer | null | undefined): void {
  const resolved = composer ?? null;
  effectComposerRef.current = resolved;
  if (resolved === null) {
    lastSyncedComposer = null;
    lastSyncedCamera = null;
    return;
  }
  if (activeSceneCameraRef.current !== null) {
    resolved.setMainCamera(activeSceneCameraRef.current);
    lastSyncedComposer = resolved;
    lastSyncedCamera = activeSceneCameraRef.current;
  }
}
