// Postprocessing chain: N8AO + bloom + SMAA + optional film
// grain, parameterized by the render visual. N8AO and bloom are too
// expensive for software rasterizers (SwiftShader/llvmpipe), so they
// are skipped there; every other pass stays at full quality.
import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
  EffectComposer,
  Bloom,
  BrightnessContrast,
  HueSaturation,
  N8AO,
  Noise,
  SMAA,
} from '@react-three/postprocessing';
import { useRenderTheme } from './useTheme';

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software/i;

function isSoftwareRenderer(gl: WebGLRenderingContext): boolean {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const param = info?.['UNMASKED_RENDERER_WEBGL'] ?? gl.RENDERER;
  return SOFTWARE_RENDERER.test(String(gl.getParameter(param)));
}

export function PostEffects() {
  const gl = useThree((s) => s.gl);
  const theme = useRenderTheme();
  const { post } = theme;
  const software = useMemo(() => isSoftwareRenderer(gl.getContext()), [gl]);
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
      <BrightnessContrast contrast={post.contrast - 1} />
      <HueSaturation saturation={post.saturation - 1} />
      {post.noiseOpacity > 0 ? <Noise opacity={post.noiseOpacity} /> : <></>}
      <SMAA />
    </EffectComposer>
  );
}
