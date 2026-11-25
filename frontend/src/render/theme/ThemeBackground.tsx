// Background: a sky dome (vertical gradient) plus a far ground platform
// fading out radially toward the map edge. GPU objects are memoized and
// disposed on unmount (ADR 0050).
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { SceneLayerProps } from '../scene';
import { useGpuResource } from '../use-gpu-resource';
import { VISUAL } from './visual';
import type { RenderVisual } from './visual';

const DOME_RADIUS = 380;

function buildDomeMaterial(theme: RenderVisual): THREE.ShaderMaterial {
  const bg = theme.background;
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(bg.top) },
      uHorizon: { value: new THREE.Color(bg.horizon) },
      uBottom: { value: new THREE.Color(bg.bottom) },
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
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        // Smooth three-stop gradient: a continuous bottom→top ramp plus a
        // wide gaussian horizon glow. The old two-sided exp blend pinned
        // uHorizon to a thin stripe at h=0 that read as a stray ribbon at
        // eye level wherever no platform/skirt hides it.
        vec3 col = mix(uBottom, uTop, smoothstep(-0.55, 0.8, h));
        col = mix(col, uHorizon, exp(-h * h * 5.0) * 0.42);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function buildPlatformMaterial(theme: RenderVisual): THREE.ShaderMaterial {
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

export function ThemeBackground({ ctx }: SceneLayerProps) {
  const { width: mapWidth, height: mapHeight } = ctx.map.grid;
  const theme = VISUAL;
  const domeRef = useRef<THREE.Mesh>(null);
  // Skybox-style: the dome follows the camera so its far limb can never
  // expose the clear color — before, at max zoom-out the camera sat
  // outside the map-centered sphere and the void showed through.
  useFrame(({ camera }) => {
    domeRef.current?.position.copy(camera.position);
  });

  const dome = useMemo(() => {
    const geo = new THREE.SphereGeometry(DOME_RADIUS, 32, 16);
    const mat = buildDomeMaterial(theme);
    return { geo, mat };
  }, [theme]);

  const platform = useMemo(() => {
    const radius = DOME_RADIUS * 0.98;
    const geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
    const mat = buildPlatformMaterial(theme);
    const uRadius = mat.uniforms['uRadius'] as { value: number } | undefined;
    const uCenter = mat.uniforms['uCenter'] as { value: THREE.Vector2 } | undefined;
    if (uRadius !== undefined) {
      uRadius.value = radius;
    }
    uCenter?.value.set(mapWidth / 2, mapHeight / 2);
    return { geo, mat };
  }, [theme, mapWidth, mapHeight]);

  useGpuResource(dome);
  useGpuResource(platform);

  return (
    <group>
      <mesh
        ref={domeRef}
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
