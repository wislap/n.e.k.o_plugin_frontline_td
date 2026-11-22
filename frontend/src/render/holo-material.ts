// Holographic placement-ghost shader (visual-slice item 6): fresnel rim +
// scrolling scanlines in the theme accent color; invalid placements switch
// to red with diagonal hazard stripes. uColor/uTime/uBad are driven per
// frame by GhostPreview.
import * as THREE from 'three';

export interface HoloMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uColor: { value: THREE.Color };
    uBadColor: { value: THREE.Color };
    uTime: { value: number };
    uBad: { value: number };
  };
}

export function createHoloMaterial(accent: string, invalid: string): HoloMaterial {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(accent) },
      uBadColor: { value: new THREE.Color(invalid) },
      uTime: { value: 0 },
      uBad: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vLocal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vLocal = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vView = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uBadColor;
      uniform float uTime;
      uniform float uBad;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vLocal;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        float scan = 0.85 + 0.15 * sin(vLocal.y * 26.0 - uTime * 4.0);
        vec3 col = uColor * scan;
        float alpha = 0.18 + fres * 0.55;
        // Invalid: red body + diagonal hazard stripes.
        float hazard = step(0.5, fract((vLocal.x + vLocal.z) * 5.0 + uTime * 0.3));
        vec3 bad = mix(uBadColor * 0.55, uBadColor, hazard);
        col = mix(col, bad, uBad);
        gl_FragColor = vec4(col, alpha + uBad * 0.12);
      }
    `,
  }) as HoloMaterial;
  return mat;
}
