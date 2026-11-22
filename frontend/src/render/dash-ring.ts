// Animated dashed-ring shader (visual-slice item 6): range rings draw as
// rotating dashed arcs instead of solid circles. Works on plain meshes and
// InstancedMesh (project_vertex handles USE_INSTANCING). uTime is updated
// per frame by the caller; uDash < 0.5 renders a solid ring. The visible
// line keeps a constant world-cell width (uWidth) regardless of the ring
// radius: the mesh/instance scale is recovered from the transform so the
// fragment shader can discard everything beyond a thin outer rim.
import * as THREE from 'three';

export interface DashRingMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uColor: { value: THREE.Color };
    uTime: { value: number };
    uDash: { value: number };
    uWidth: { value: number };
  };
}

export function createDashRingMaterial(color: string): DashRingMaterial {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uDash: { value: 1 },
      uWidth: { value: 0.06 },
    },
    vertexShader: `
      varying vec2 vPos;
      varying float vScale;
      void main() {
        vPos = position.xy;
        vec3 transformed = position;
        vec4 mvPosition = vec4(transformed, 1.0);
        vScale = length(modelMatrix[0].xyz);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vScale *= length(instanceMatrix[0].xyz);
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uDash;
      uniform float uWidth;
      varying vec2 vPos;
      varying float vScale;
      void main() {
        // Distance from the ring's outer rim in world cells.
        float edgeDist = (1.0 - length(vPos)) * vScale;
        float aa = max(fwidth(edgeDist) * 1.2, 0.01);
        float band = 1.0 - smoothstep(uWidth * 0.6, uWidth + aa, edgeDist);
        if (band < 0.02) discard;
        float ang = atan(vPos.y, vPos.x) / 6.2831853 + 0.5;
        float phase = fract(ang * 20.0 - uTime);
        float daa = max(fwidth(phase), 0.02);
        float dashes = smoothstep(0.62, 0.62 - daa, phase);
        float m = mix(1.0, dashes, uDash) * band;
        if (m < 0.02) discard;
        gl_FragColor = vec4(uColor, m * 0.55);
      }
    `,
  }) as DashRingMaterial;
  return mat;
}
