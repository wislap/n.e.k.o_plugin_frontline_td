// Postprocessing chain: N8AO + bloom + SMAA, parameterized by the render
// visual. N8AO and bloom are too expensive for software rasterizers
// (SwiftShader/llvmpipe), so they are skipped there.
//
// The look is calibrated without tone mapping: EffectComposer forces
// gl.toneMapping = NoToneMapping, so any renderer-level tone-mapping
// setting is dead — keep it that way.
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  EffectComposer,
  Bloom,
  BrightnessContrast,
  HueSaturation,
  SMAA,
} from '@react-three/postprocessing';
import { N8AOPostPass } from 'n8ao';
import type * as THREE from 'three';
import { isCaptureMode } from '../../client/capture-mode';
import { useUiStore } from '../../client/ui-store';
import { cameraTransitionState } from '../camera-transition';
import { getSceneCameras, setEffectComposer } from '../composer-ref';
import { VISUAL } from './visual';

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software/i;

function isSoftwareRenderer(gl: WebGLRenderingContext): boolean {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const param = info?.['UNMASKED_RENDERER_WEBGL'] ?? gl.RENDERER;
  return SOFTWARE_RENDERER.test(String(gl.getParameter(param)));
}

function syncAoPassForTransition(pass: N8AOPostPass, baseIntensity: number, blend: number): void {
  const shouldEnable = blend < 1;
  if (pass.enabled !== shouldEnable) {
    pass.enabled = shouldEnable;
  }
  if (shouldEnable) {
    const target = baseIntensity * (1 - blend);
    if (Math.abs(pass.configuration.intensity - target) > 1e-4) {
      pass.configuration.intensity = target;
    }
  }
}

// Ambient occlusion as a plain <primitive> pass instead of the <N8AO>
// wrapper component: the wrapper registers its pass in the library's
// groupPasses set, which makes EffectComposer append a trailing CopyPass
// that only blits the finished frame to screen (~0.7 ms on iGPU).
function AoPass({
  camera,
  aoRadius,
  intensity,
}: {
  readonly camera: THREE.Camera;
  readonly aoRadius: number;
  readonly intensity: number;
}) {
  const scene = useThree((s) => s.scene);
  const pass = useMemo(() => {
    const p = new N8AOPostPass(scene, camera);
    const c = p.configuration;
    c.aoRadius = aoRadius;
    c.intensity = intensity;
    c.halfRes = true;
    c.depthAwareUpsampling = true;
    c.denoiseIterations = 1;
    p.setQualityMode('Medium');
    return p;
  }, [scene, camera, aoRadius, intensity]);
  useEffect(() => {
    return () => {
      pass.dispose();
    };
  }, [pass]);
  useFrame(() => {
    syncAoPassForTransition(pass, intensity, cameraTransitionState.blend);
  });
  return <primitive object={pass} />;
}

export function PostEffects() {
  const gl = useThree((s) => s.gl);
  const cameras = useMemo(() => getSceneCameras(gl), [gl]);
  const { post } = VISUAL;
  // Capture mode forces the full post chain on software rasterizers so
  // screenshot diffs cover every pass (N8AO/bloom are skipped only on real
  // software rendering).
  const software = useMemo(() => !isCaptureMode() && isSoftwareRenderer(gl.getContext()), [gl]);
  // Debug-panel render-cost toggles (all on by default).
  const cost = useUiStore((s) => s.renderCost);
  return (
    <EffectComposer camera={cameras.persp} multisampling={0} ref={setEffectComposer}>
      {software ? (
        <></>
      ) : (
        <>
          {cost.n8ao ? (
            <AoPass camera={cameras.persp} aoRadius={post.aoRadius} intensity={post.aoIntensity} />
          ) : (
            <></>
          )}
          {cost.bloom ? (
            <Bloom
              intensity={post.bloomIntensity}
              luminanceThreshold={post.bloomThreshold}
              luminanceSmoothing={0.15}
              mipmapBlur
            />
          ) : (
            <></>
          )}
        </>
      )}
      <BrightnessContrast contrast={post.contrast - 1} />
      <HueSaturation saturation={post.saturation - 1} />
      {cost.smaa ? <SMAA /> : <></>}
    </EffectComposer>
  );
}
