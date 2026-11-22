// Themed service-coverage shader (visual-slice item 6): the coverage mask
// lives in the texture's red channel (1 per covered cell, linear-filtered).
// The fragment draws a ~5% fill inside covered cells plus a thin crisp
// contour line where the interpolated mask crosses 0.5 — constant screen
// width via fwidth, no wide blurred band, and dim enough to stay under the
// bloom threshold.
import * as THREE from 'three';

export interface CoverMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uCover: { value: THREE.Texture | null };
    uColor: { value: THREE.Color };
    uFill: { value: number };
    uEdge: { value: number };
  };
}

export function createCoverMaterial(color: string): CoverMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uCover: { value: null },
      uColor: { value: new THREE.Color(color) },
      uFill: { value: 0.05 },
      uEdge: { value: 0.6 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uCover;
      uniform vec3 uColor;
      uniform float uFill;
      uniform float uEdge;
      varying vec2 vUv;
      void main() {
        float c = texture2D(uCover, vUv).r;
        // Thin iso-contour at the covered/uncovered boundary (~0.08 cell).
        float w = max(fwidth(c) * 1.5, 0.03);
        float line = 1.0 - smoothstep(0.01, 0.035 + w, abs(c - 0.5));
        float fill = step(0.5, c) * uFill;
        float alpha = max(fill, line * uEdge);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  }) as CoverMaterial;
}
