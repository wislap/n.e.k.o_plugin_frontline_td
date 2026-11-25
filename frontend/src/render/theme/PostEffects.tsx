// Postprocessing chain: N8AO + bloom + SMAA, parameterized by the render
// visual. N8AO and bloom are too expensive for software rasterizers
// (SwiftShader/llvmpipe), so they are skipped there.
//
// The look is calibrated without tone mapping: EffectComposer forces
// gl.toneMapping = NoToneMapping, so any renderer-level tone-mapping
// setting is dead — keep it that way.
import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
  EffectComposer,
  Bloom,
  BrightnessContrast,
  HueSaturation,
  N8AO,
  SMAA,
} from '@react-three/postprocessing';
import { isCaptureMode } from '../../client/capture-mode';
import { useUiStore } from '../../client/ui-store';
import { setEffectComposer } from '../composer-ref';
import { VISUAL } from './visual';

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software/i;

function isSoftwareRenderer(gl: WebGLRenderingContext): boolean {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const param = info?.['UNMASKED_RENDERER_WEBGL'] ?? gl.RENDERER;
  return SOFTWARE_RENDERER.test(String(gl.getParameter(param)));
}

export function PostEffects() {
  const gl = useThree((s) => s.gl);
  const { post } = VISUAL;
  // Capture mode forces the full post chain on software rasterizers so
  // screenshot diffs cover every pass (N8AO/bloom are skipped only on real
  // software rendering).
  const software = useMemo(() => !isCaptureMode() && isSoftwareRenderer(gl.getContext()), [gl]);
  // Debug-panel render-cost toggles (all on by default).
  const cost = useUiStore((s) => s.renderCost);
  return (
    <EffectComposer multisampling={0} ref={setEffectComposer}>
      {software ? (
        <></>
      ) : (
        <>
          {cost.n8ao ? (
            <N8AO aoRadius={post.aoRadius} intensity={post.aoIntensity} quality="medium" />
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
