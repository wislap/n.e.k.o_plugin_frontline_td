// Split-tone grade: multiplicative tints — shadows multiply toward cool
// blue, highlights toward warm; value range and midtone neutrality are
// preserved, so white paint stays near-neutral and nothing can go olive.
// Disabled in the tactical info view: the flat slate map must stay untinted.
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BlendFunction, Effect } from 'postprocessing';
import { Uniform, Vector3 } from 'three';
import { useCameraStore } from '../../client/camera-store';

class SplitToneEffect extends Effect {
  constructor() {
    super(
      'SplitToneEffect',
      `
        uniform float uStrength;
        uniform float uTactical;
        uniform vec3 uCool;
        uniform vec3 uWarm;
        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          vec3 c = inputColor.rgb;
          float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float coolW = smoothstep(0.45, 0.05, luma);
          float warmW = smoothstep(0.55, 1.0, luma);
          c *= mix(vec3(1.0), uCool, coolW * uStrength);
          c *= mix(vec3(1.0), uWarm, warmW * uStrength);
          // Tactical info view: strip the warm grade from low-saturation
          // surfaces (terrain, structures) — pull them toward a neutral
          // cool slate while keeping luma. Saturated pixels (unit
          // markers, coverage, signal accents) keep their colour.
          float sat = (max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b))) / max(luma, 1e-3);
          vec3 neutral = vec3(luma) * vec3(0.9, 0.97, 0.94);
          c = mix(c, neutral, uTactical * 0.9 * (1.0 - smoothstep(0.35, 0.9, sat)));
          outputColor = vec4(c, inputColor.a);
        }
      `,
      {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, Uniform>([
          ['uStrength', new Uniform(0)],
          ['uTactical', new Uniform(0)],
          // Slight blue in shadows, slight warm in highlights; both stay
          // close to 1 so neither pushes midtones toward brown or olive.
          ['uCool', new Uniform(new Vector3(0.93, 0.97, 1.08))],
          ['uWarm', new Uniform(new Vector3(1.06, 1.0, 0.93))],
        ]),
      },
    );
  }
}

export function SplitTone({ strength }: { strength: number }) {
  const effect = useMemo(() => new SplitToneEffect(), []);
  useFrame(() => {
    const tactical = useCameraStore.getState().mode === 'tactical';
    const u = effect.uniforms.get('uStrength');
    if (u !== undefined) {
      u.value = tactical ? 0 : strength * 0.85;
    }
    const t = effect.uniforms.get('uTactical');
    if (t !== undefined) {
      t.value = tactical ? 1 : 0;
    }
  });
  return <primitive object={effect} />;
}
