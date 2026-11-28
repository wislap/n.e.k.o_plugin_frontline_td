import type { EffectComposer } from 'postprocessing';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPECTATE_PITCH_DEG } from '../client/camera-math';
import { cameraTransitionState, writeCameraTransitionState } from './camera-transition';
import { createFogUniforms, GLSL_FOG } from './shaders';
import {
  activeSceneCameraRef,
  effectComposerRef,
  getSceneCameras,
  setEffectComposer,
  syncActiveSceneCamera,
} from './composer-ref';

function makeComposerMock(): {
  composer: EffectComposer;
  setMainCamera: ReturnType<typeof vi.fn<(camera: THREE.Camera) => void>>;
} {
  const setMainCamera = vi.fn<(camera: THREE.Camera) => void>();
  const composer = { setMainCamera } as unknown as EffectComposer;
  return { composer, setMainCamera };
}

describe('getSceneCameras', () => {
  it('returns a stable { persp, ortho } pair per renderer key with YXZ rotation order', () => {
    const rendererA = {};
    const rendererB = {};

    const firstA = getSceneCameras(rendererA);
    const secondA = getSceneCameras(rendererA);
    expect(secondA).toBe(firstA);
    expect(firstA.persp).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(firstA.ortho).toBeInstanceOf(THREE.OrthographicCamera);
    expect(firstA.persp.rotation.order).toBe('YXZ');
    expect(firstA.ortho.rotation.order).toBe('YXZ');

    const firstB = getSceneCameras(rendererB);
    expect(firstB).not.toBe(firstA);
    expect(firstB.persp).not.toBe(firstA.persp);
    expect(firstB.ortho).not.toBe(firstA.ortho);
    expect(firstB.persp.rotation.order).toBe('YXZ');
    expect(firstB.ortho.rotation.order).toBe('YXZ');
  });
});

describe('syncActiveSceneCamera and setEffectComposer', () => {
  beforeEach(() => {
    setEffectComposer(null);
    activeSceneCameraRef.current = null;
  });

  afterEach(() => {
    setEffectComposer(null);
    activeSceneCameraRef.current = null;
  });

  it('stores activeSceneCameraRef before composer mounts and syncs once on setEffectComposer', () => {
    const camA = new THREE.PerspectiveCamera();
    const { composer, setMainCamera } = makeComposerMock();

    syncActiveSceneCamera(camA);
    expect(activeSceneCameraRef.current).toBe(camA);
    expect(effectComposerRef.current).toBeNull();
    expect(setMainCamera).not.toHaveBeenCalled();

    setEffectComposer(composer);
    expect(effectComposerRef.current).toBe(composer);
    expect(setMainCamera).toHaveBeenCalledTimes(1);
    expect(setMainCamera).toHaveBeenCalledWith(camA);
  });

  it('skips redundant sync for the same camera and immediately syncs a new camera', () => {
    const camA = new THREE.PerspectiveCamera();
    const camB = new THREE.OrthographicCamera();
    const { composer, setMainCamera } = makeComposerMock();

    syncActiveSceneCamera(camA);
    setEffectComposer(undefined);
    expect(effectComposerRef.current).toBeNull();

    setEffectComposer(composer);
    expect(setMainCamera).toHaveBeenCalledTimes(1);

    syncActiveSceneCamera(camA);
    expect(setMainCamera).toHaveBeenCalledTimes(1);

    syncActiveSceneCamera(camB);
    expect(activeSceneCameraRef.current).toBe(camB);
    expect(setMainCamera).toHaveBeenCalledTimes(2);
    expect(setMainCamera).toHaveBeenLastCalledWith(camB);
  });

  it('clears sync cache when setEffectComposer(null) is called so re-attaching syncs again', () => {
    const camA = new THREE.PerspectiveCamera();
    const { composer, setMainCamera } = makeComposerMock();

    syncActiveSceneCamera(camA);
    setEffectComposer(undefined);
    expect(effectComposerRef.current).toBeNull();

    setEffectComposer(composer);
    expect(setMainCamera).toHaveBeenCalledTimes(1);

    setEffectComposer(null);
    expect(effectComposerRef.current).toBeNull();

    setEffectComposer(composer);
    expect(setMainCamera).toHaveBeenCalledTimes(2);
    expect(setMainCamera).toHaveBeenLastCalledWith(camA);
  });
});

describe('writeCameraTransitionState', () => {
  afterEach(() => {
    writeCameraTransitionState(0, 0, SPECTATE_PITCH_DEG);
  });

  it('updates cameraTransitionState fields in place', () => {
    const stateRef = cameraTransitionState;
    writeCameraTransitionState(0.65, 14.5, 76);

    expect(cameraTransitionState).toBe(stateRef);
    expect(cameraTransitionState.blend).toBe(0.65);
    expect(cameraTransitionState.extraDist).toBe(14.5);
    expect(cameraTransitionState.visualPitchDeg).toBe(76);
  });
});

describe('fog extra-distance compensation', () => {
  it('initializes uFtdFogExtraDist to 0 and subtracts it in GLSL_FOG', () => {
    const fog = createFogUniforms();
    expect(fog.uFtdFogExtraDist.value).toBe(0);
    expect(GLSL_FOG).toContain('uniform float uFtdFogExtraDist;');
    expect(GLSL_FOG).toContain('float effDist = max(0.0, vDist - uFtdFogExtraDist);');
  });
});
