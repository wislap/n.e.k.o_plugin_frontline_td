// Theme background: a sky dome (vertical gradient, optional procedural
// nebula + stars) plus a far ground platform fading out radially toward
// the map edge. All GPU objects are memoized per theme and disposed on
// change/unmount (ADR 0050).
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useRenderTheme } from './useTheme';
import type { RenderTheme } from './themes';

const DOME_RADIUS = 380;

function buildDomeMaterial(theme: RenderTheme): THREE.ShaderMaterial {
  const bg = theme.background;
  const isNebula = bg.kind === 'nebula';
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(bg.top) },
      uHorizon: { value: new THREE.Color(bg.horizon) },
      uBottom: { value: new THREE.Color(bg.bottom) },
      uNebula: { value: new THREE.Color(bg.nebula) },
      uNebula2: { value: new THREE.Color(bg.nebula2) },
      uStars: { value: isNebula ? 1 : 0 },
      uNebulaAmt: { value: isNebula ? 1 : 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uBottom;
      uniform vec3 uNebula;
      uniform vec3 uNebula2;
      uniform float uStars;
      uniform float uNebulaAmt;
      varying vec3 vDir;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      void main() {
        float h = vDir.y;
        vec3 col = h > 0.0
          ? mix(uHorizon, uTop, pow(min(h * 1.6, 1.0), 0.7))
          : mix(uHorizon, uBottom, min(-h * 2.5, 1.0));
        if (uNebulaAmt > 0.0) {
          vec2 p = vDir.xz / max(0.25, abs(vDir.y) + 0.35);
          // 4-octave fbm nebula; hue mixes between two tints by large-scale
          // variation so clouds read as layered gas, not noise.
          float n = vnoise(p * 1.6) * 0.45
            + vnoise(p * 3.7 + 13.1) * 0.3
            + vnoise(p * 8.3 + 29.7) * 0.15
            + vnoise(p * 17.0 + 47.3) * 0.1;
          float hueMix = vnoise(p * 0.8 + 7.7);
          vec3 neb = mix(uNebula, uNebula2, hueMix);
          float cloud = smoothstep(0.45, 0.9, n);
          col += neb * cloud * 0.55;
          col += uNebula2 * smoothstep(0.75, 0.98, n) * 0.35;
        }
        if (uStars > 0.0 && h > 0.02) {
          vec2 sp = vDir.xz / max(vDir.y, 0.05) * 60.0;
          vec2 cellId = floor(sp);
          vec2 f = fract(sp) - 0.5;
          float r = hash21(cellId);
          float star = step(0.992, r) * smoothstep(0.08, 0.0, length(f));
          col += vec3(star) * (0.4 + 0.6 * hash21(cellId + 7.0)) * smoothstep(0.0, 0.25, h);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function buildPlatformMaterial(theme: RenderTheme): THREE.ShaderMaterial {
  const bg = theme.background;
  const hasGrid = bg.platformGrid !== '#000000';
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(bg.platform) },
      uGrid: { value: new THREE.Color(bg.platformGrid) },
      uHasGrid: { value: hasGrid ? 1 : 0 },
      uGridAlpha: { value: bg.platformGridAlpha },
      uFadeStart: { value: bg.platformFadeStart },
      uFadeEnd: { value: bg.platformFadeEnd },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uRadius: { value: 1 },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uGrid;
      uniform float uHasGrid;
      uniform float uGridAlpha;
      uniform float uFadeStart;
      uniform float uFadeEnd;
      uniform vec2 uCenter;
      uniform float uRadius;
      varying vec3 vWorld;
      void main() {
        float d = length(vWorld.xz - uCenter) / uRadius;
        float alpha = 1.0 - smoothstep(uFadeStart, uFadeEnd, d);
        vec3 col = uColor;
        if (uHasGrid > 0.0) {
          vec2 g = abs(fract(vWorld.xz / 4.0 - 0.5) - 0.5) / max(fwidth(vWorld.xz / 4.0), vec2(1e-4));
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          col = mix(col, uGrid, line * uGridAlpha);
        }
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export function ThemeBackground({ mapWidth, mapHeight }: { mapWidth: number; mapHeight: number }) {
  const theme = useRenderTheme();

  const dome = useMemo(() => {
    if (theme.background.kind === 'none') {
      return null;
    }
    const geo = new THREE.SphereGeometry(DOME_RADIUS, 32, 16);
    const mat = buildDomeMaterial(theme);
    return { geo, mat };
  }, [theme]);

  const platform = useMemo(() => {
    if (theme.background.kind === 'none') {
      return null;
    }
    const radius = DOME_RADIUS * 0.98;
    const geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
    const mat = buildPlatformMaterial(theme);
    const uRadius = mat.uniforms['uRadius'] as { value: number } | undefined;
    const uCenter = mat.uniforms['uCenter'] as { value: THREE.Vector2 } | undefined;
    if (uRadius !== undefined) {
      uRadius.value = radius;
    }
    uCenter?.value.set(mapWidth / 2, mapHeight / 2);
    return { geo, mat, radius };
  }, [theme, mapWidth, mapHeight]);

  useEffect(() => {
    return () => {
      dome?.geo.dispose();
      dome?.mat.dispose();
    };
  }, [dome]);

  useEffect(() => {
    return () => {
      platform?.geo.dispose();
      platform?.mat.dispose();
    };
  }, [platform]);

  if (theme.background.kind === 'none' || dome === null || platform === null) {
    return null;
  }
  return (
    <group key={theme.id}>
      <mesh
        geometry={dome.geo}
        material={dome.mat}
        position={[mapWidth / 2, 0, mapHeight / 2]}
        renderOrder={-10}
        frustumCulled={false}
      />
      <mesh
        geometry={platform.geo}
        material={platform.mat}
        position={[mapWidth / 2, -0.4, mapHeight / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={-9}
        frustumCulled={false}
      />
    </group>
  );
}
