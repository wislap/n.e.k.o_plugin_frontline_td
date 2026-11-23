// Cel shading helper (language 2): composes a luminance-band quantizer
// onto a material's existing onBeforeCompile — lit surfaces collapse into
// hard anime bands instead of smooth PBR gradients.
import * as THREE from 'three';

const BAND_QUANTIZE = `#include <opaque_fragment>
      {
        // Partial luminance quantize: hard anime bands over ~70% of the
        // luminance delta, keeping a smooth floor so dim regions stay a
        // cool desaturated tint instead of collapsing to black.
        float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        float band = floor(lum * 3.0 + 0.5) / 3.0;
        gl_FragColor.rgb *= mix(1.0, band / max(lum, 1e-3), 0.7);
      }`;

export function applyToonBands(material: THREE.Material): void {
  const prev = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      BAND_QUANTIZE,
    );
  };
}
