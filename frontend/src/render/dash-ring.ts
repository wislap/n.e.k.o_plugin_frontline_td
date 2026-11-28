// Animated/static ground-ring shader (visual-slice item 6, M2B 1.2c):
// supports plain meshes and InstancedMesh (USE_INSTANCING + optional
// USE_INSTANCING_COLOR, USE_ARC via `attribute vec2 aArc`, and
// USE_INSTANCED_DASH via `attribute float aDash`). The visible line keeps
// a constant world-cell width (uWidth) regardless of ring radius.
import * as THREE from 'three';

export interface DashRingOptions {
  dash?: number;
  width?: number;
  opacity?: number;
  instancedArc?: boolean;
  instancedDash?: boolean;
}

export interface DashRingMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uColor: { value: THREE.Color };
    uTime: { value: number };
    uDash: { value: number };
    uWidth: { value: number };
    uOpacity: { value: number };
  };
}

export function createDashRingMaterial(color: string, options?: DashRingOptions): DashRingMaterial {
  const defines: Record<string, number> = {};
  if (options?.instancedArc === true) {
    defines['USE_ARC'] = 1;
  }
  if (options?.instancedDash === true) {
    defines['USE_INSTANCED_DASH'] = 1;
  }

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    defines,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uDash: { value: options?.dash ?? 1 },
      uWidth: { value: options?.width ?? 0.06 },
      uOpacity: { value: options?.opacity ?? 0.55 },
    },
    vertexShader: `
      varying vec2 vPos;
      varying float vScale;
      varying vec3 vInstanceColor;
      #ifdef USE_ARC
        attribute vec2 aArc;
        varying vec2 vArc;
      #endif
      #ifdef USE_INSTANCED_DASH
        attribute float aDash;
        varying float vDash;
      #endif
      void main() {
        vPos = position.xy;
        vInstanceColor = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vInstanceColor = instanceColor;
        #endif
        #ifdef USE_ARC
          vArc = aArc;
        #endif
        #ifdef USE_INSTANCED_DASH
          vDash = aDash;
        #endif
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
      uniform float uOpacity;
      varying vec2 vPos;
      varying float vScale;
      varying vec3 vInstanceColor;
      #ifdef USE_ARC
        varying vec2 vArc;
      #endif
      #ifdef USE_INSTANCED_DASH
        varying float vDash;
      #endif
      void main() {
        // Distance from the ring's outer rim in world cells.
        float edgeDist = (1.0 - length(vPos)) * vScale;
        float aa = max(fwidth(edgeDist) * 1.2, 0.01);
        float band = 1.0 - smoothstep(uWidth * 0.6, uWidth + aa, edgeDist);
        if (band < 0.02) discard;

        float arcMask = 1.0;
        #ifdef USE_ARC
          float absSweep = abs(vArc.y);
          if (absSweep <= 1e-4) discard;
          if (absSweep < 6.2831853 - 1e-4) {
            // Map XY ring plane laid flat via rotation.x = -PI/2 to XZ clockwise angle.
            vec2 p = vec2(vPos.x, -vPos.y);
            float mid = vArc.x + vArc.y * 0.5;
            float c = cos(mid);
            float s = sin(mid);
            vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
            float theta = abs(atan(q.y, q.x));
            float arcDist = (absSweep * 0.5 - theta) * vScale;
            float tanGrad = (abs(q.y) * fwidth(q.x) + abs(q.x) * fwidth(q.y)) / max(dot(q, q), 1e-4) * vScale;
            float arcAa = max(tanGrad * 1.2, 0.01);
            arcMask = smoothstep(-arcAa, arcAa * 0.5, arcDist);
            if (arcMask < 0.02) discard;
          }
        #endif

        float dashAmt = uDash;
        #ifdef USE_INSTANCED_DASH
          dashAmt = vDash;
        #endif
        float dashMask = 1.0;
        if (dashAmt > 0.01) {
          float ang = atan(vPos.y, vPos.x) / 6.2831853 + 0.5;
          float phase = fract(ang * 20.0 - uTime);
          float daa = max(fwidth(phase), 0.02);
          float dashes = smoothstep(0.62, 0.62 - daa, phase);
          dashMask = mix(1.0, dashes, dashAmt);
        }

        float m = dashMask * band * arcMask;
        if (m < 0.02) discard;
        gl_FragColor = vec4(uColor * vInstanceColor, m * uOpacity);
      }
    `,
  }) as DashRingMaterial;
  return mat;
}
