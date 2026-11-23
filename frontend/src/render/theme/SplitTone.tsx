// Split-tone grade: warms highlights and cools shadows without veiling
// midtones — the non-veiling half of the borrowed diorama atmosphere.
import { useMemo } from 'react';
import { BlendFunction, Effect } from 'postprocessing';
import { Uniform, Vector3 } from 'three';

class SplitToneEffect extends Effect {
  constructor() {
    super(
      'SplitToneEffect',
      `
        uniform float uStrength;
        uniform vec3 uWarm;
        uniform vec3 uCool;
        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          vec3 c = inputColor.rgb;
          float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
          // Shadows cool, highlights warm; the mid pivot keeps edges and
          // micro-contrast untouched (strength only tints the extremes).
          float warmW = smoothstep(0.35, 1.0, luma);
          float coolW = smoothstep(0.55, 0.0, luma);
          c += (uWarm * warmW - uCool * coolW) * uStrength;
          outputColor = vec4(c, inputColor.a);
        }
      `,
      {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, Uniform>([
          ['uStrength', new Uniform(0)],
          ['uWarm', new Uniform(new Vector3(0.1, 0.05, -0.02))],
          ['uCool', new Uniform(new Vector3(0.02, 0.06, 0.12))],
        ]),
      },
    );
  }
}

export function SplitTone({ strength }: { strength: number }) {
  const effect = useMemo(() => new SplitToneEffect(), []);
  const u = effect.uniforms.get('uStrength');
  if (u !== undefined) {
    u.value = strength * 0.9;
  }
  return <primitive object={effect} />;
}
