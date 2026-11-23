// Postprocessing chain: N8AO + bloom + SMAA + vignette + optional film
// grain, parameterized by the render visual.
import {
  EffectComposer,
  Bloom,
  BrightnessContrast,
  HueSaturation,
  N8AO,
  Noise,
  SMAA,
  Vignette,
} from '@react-three/postprocessing';
import { useRenderTheme } from './useTheme';

export function PostEffects() {
  const { post } = useRenderTheme();
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={post.aoRadius} intensity={post.aoIntensity} quality="medium" />
      <Bloom
        intensity={post.bloomIntensity}
        luminanceThreshold={post.bloomThreshold}
        luminanceSmoothing={0.15}
        mipmapBlur
      />
      <BrightnessContrast contrast={post.contrast - 1} />
      <HueSaturation saturation={post.saturation - 1} />
      <Vignette offset={0.25} darkness={post.vignette} />
      {post.noiseOpacity > 0 ? <Noise opacity={post.noiseOpacity} /> : <></>}
      <SMAA />
    </EffectComposer>
  );
}
