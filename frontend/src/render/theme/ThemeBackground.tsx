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
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(bg.top) },
      uHorizon: { value: new THREE.Color(bg.horizon) },
      uBottom: { value: new THREE.Color(bg.bottom) },
      uClouds: { value: bg.clouds === true ? 1 : 0 },
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
      uniform float uClouds;
      varying vec3 vDir;

      float cloudHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float cloudNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), f.x),
          mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      void main() {
        float h = vDir.y;
        vec3 col = h > 0.0
          ? mix(uHorizon, uTop, pow(min(h * 1.6, 1.0), 0.7))
          : mix(uHorizon, uBottom, min(-h * 2.5, 1.0));
        if (uClouds > 0.5 && h > 0.02) {
          // Stylized anime cloud band: flat-bottomed blobs drifting with
          // azimuth, denser near the horizon, white against the gradient.
          float az = atan(vDir.z, vDir.x);
          vec2 cp = vec2(az * 3.0, h * 9.0);
          float n = cloudNoise(cp) * 0.55 + cloudNoise(cp * 2.3 + 7.1) * 0.45;
          float band = smoothstep(0.55, 0.72, n) * smoothstep(0.75, 0.2, h);
          col = mix(col, vec3(1.0), band * 0.75);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function buildPlatformMaterial(theme: RenderTheme): THREE.ShaderMaterial {
  const bg = theme.background;
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(bg.platform) },
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
      uniform float uFadeStart;
      uniform float uFadeEnd;
      uniform vec2 uCenter;
      uniform float uRadius;
      varying vec3 vWorld;
      void main() {
        float d = length(vWorld.xz - uCenter) / uRadius;
        float alpha = 1.0 - smoothstep(uFadeStart, uFadeEnd, d);
        gl_FragColor = vec4(uColor, alpha);
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
