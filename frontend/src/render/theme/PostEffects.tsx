// Postprocessing chain: N8AO + bloom + tone mapping + SMAA + optional
// film grain, parameterized by the render visual. N8AO and bloom are
// too expensive for software rasterizers (SwiftShader/llvmpipe), so
// they are skipped there; every other pass stays at full quality.
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
  EffectComposer,
  Bloom,
  BrightnessContrast,
  HueSaturation,
  N8AO,
  Noise,
  SMAA,
  ToneMapping,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { WebGLRenderer } from 'three';
import { isCaptureMode } from '../../client/capture-mode';
import { useRenderTheme } from './useTheme';

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software/i;

function isSoftwareRenderer(gl: WebGLRenderingContext): boolean {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const param = info?.['UNMASKED_RENDERER_WEBGL'] ?? gl.RENDERER;
  return SOFTWARE_RENDERER.test(String(gl.getParameter(param)));
}

// Temporary owner A/B (deleted after the pick): ?tm=off|agx|aces selects
// the composer tone-mapping mode, default off (the historical look —
// EffectComposer forces gl.toneMapping = NoToneMapping). The exposure
// feeds the effect's toneMappingExposure uniform.
const TM_MODES = {
  agx: { mode: ToneMappingMode.AGX, exposure: 1.0 },
  aces: { mode: ToneMappingMode.ACES_FILMIC, exposure: 0.8 },
} as const;
type TmId = keyof typeof TM_MODES;

// Feeds the ToneMappingEffect's toneMappingExposure uniform — three.js
// uploads gl.toneMappingExposure into every program, including the
// composer's effect materials (mutated here because the react-compiler
// lint treats hook-derived objects as immutable).
function applyToneMappingExposure(gl: WebGLRenderer, exposure: number): () => void {
  const prev = gl.toneMappingExposure;
  gl.toneMappingExposure = exposure;
  return () => {
    gl.toneMappingExposure = prev;
  };
}

function tmFromSearch(search: string): TmId | 'off' {
  const p = new URLSearchParams(search).get('tm');
  return p === 'agx' || p === 'aces' ? p : 'off';
}

export function PostEffects() {
  const gl = useThree((s) => s.gl);
  const theme = useRenderTheme();
  const { post } = theme;
  // Capture mode forces the full post chain on software rasterizers so
  // screenshot diffs cover every pass (N8AO/bloom are skipped only on real
  // software rendering).
  const software = useMemo(() => !isCaptureMode() && isSoftwareRenderer(gl.getContext()), [gl]);
  const tm = useMemo(
    () => tmFromSearch(typeof location === 'undefined' ? '' : location.search),
    [],
  );
  const tmCfg = tm === 'off' ? undefined : TM_MODES[tm];
  useEffect(() => {
    return applyToneMappingExposure(gl, tmCfg?.exposure ?? 1);
  }, [gl, tmCfg]);
  return (
    <EffectComposer multisampling={0}>
      {software ? (
        <></>
      ) : (
        <>
          <N8AO aoRadius={post.aoRadius} intensity={post.aoIntensity} quality="medium" />
          <Bloom
            intensity={post.bloomIntensity}
            luminanceThreshold={post.bloomThreshold}
            luminanceSmoothing={0.15}
            mipmapBlur
          />
        </>
      )}
      {tmCfg !== undefined ? <ToneMapping mode={tmCfg.mode} /> : <></>}
      <BrightnessContrast contrast={post.contrast - 1} />
      <HueSaturation saturation={post.saturation - 1} />
      {post.noiseOpacity > 0 ? <Noise opacity={post.noiseOpacity} /> : <></>}
      <SMAA />
    </EffectComposer>
  );
}
