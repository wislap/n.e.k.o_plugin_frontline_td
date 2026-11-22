// Theme-driven postprocessing (visual-slice item 3): N8AO + bloom + SMAA +
// vignette + optional film grain, parameterized per theme. Not mounted for
// `legacy`, which stays post-free. The composer is fully recreated on theme
// change; @react-three/postprocessing disposes its GPU resources on unmount.
import {
  EffectComposer,
  Bloom,
  BrightnessContrast,
  HueSaturation,
  N8AO,
  Noise,
  Pixelation,
  SMAA,
  Vignette,
} from '@react-three/postprocessing';
import { useRenderTheme } from './useTheme';

export function PostEffects() {
  const theme = useRenderTheme();
  const { post } = theme;
  if (!post.enabled) {
    return null;
  }
  return (
    <EffectComposer key={theme.id} multisampling={0}>
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
      {post.pixelation > 0 ? <Pixelation granularity={post.pixelation} /> : <SMAA />}
    </EffectComposer>
  );
}
