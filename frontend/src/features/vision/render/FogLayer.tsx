// Fog-of-war overlay: one terrain-shaped mesh (same geometry builder as
// TerrainMesh, so slopes and cliffs follow the ground) shaded by a
// per-cell alpha texture. An RGBA DataTexture of mapWidth×mapHeight
// carries each cell's alpha in its green channel — state 0 unexplored
// (0.85), 1 explored (0.45), 2 visible (0). The texture is rewritten in
// place only when the layer array identity changes (one small upload);
// mutable GPU objects live in refs and are disposed on unmount.
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ResolvedMap } from '../../../content/index';
import type { SimClient } from '../../../client/sim-client';
import { useRenderTheme } from '../../../render/theme/index';
import { buildTerrainGeometry } from '../../terrain/render/index';
import { VISION_STATE_LAYER_ID } from '../protocol';

const FOG_COLOR = '#05070d';
const LIFT = 0.045;
const STATE_ALPHA = [Math.round(0.85 * 255), Math.round(0.45 * 255), 0] as const;

// Texture uploads live in a module-scope helper: the react-compiler lint
// treats hook-derived objects (refs) as immutable, so mutations of the
// texture happen inside a plain function whose params are not tracked.
function uploadFog(texture: THREE.DataTexture, layer: ArrayLike<number>, cells: number): void {
  const buf = texture.image.data as Uint8Array;
  for (let i = 0; i < cells; i++) {
    const a = STATE_ALPHA[layer[i] ?? 0] ?? 0;
    buf[i * 4] = a;
    buf[i * 4 + 1] = a;
    buf[i * 4 + 2] = a;
    buf[i * 4 + 3] = 255;
  }
  texture.needsUpdate = true;
}

export interface FogLayerProps {
  client: SimClient;
  map: ResolvedMap;
}

// Themed fog uses a dedicated shader: a 5-tap blur over the linear-filtered
// alpha smooths cell edges over ~1.5 cells (no staircase), explored cells
// get a lower-alpha desaturated-darkening treatment instead of a flat film,
// and unexplored regions can carry a faint pattern (survey paper:
// height-contour lines + dot grid) driven by theme.fogStyle.
function createSoftFogMaterial(theme: {
  fogColor: string;
  fogStyle: 'plain' | 'survey';
}): THREE.ShaderMaterial {
  // Survey paper: explored cells get a dark ink film so dimmed terrain and
  // structure footprints still read through; other styles lift slightly.
  const explored =
    theme.fogStyle === 'survey'
      ? new THREE.Color(theme.fogColor).multiplyScalar(0.55)
      : new THREE.Color(theme.fogColor).lerp(new THREE.Color('#ffffff'), 0.08);
  // Survey paper draws darker ink lines on a pale ground; dark themes draw
  // lighter pattern lines on their fog color.
  const pattern =
    theme.fogStyle === 'survey'
      ? new THREE.Color(theme.fogColor).multiplyScalar(0.62)
      : new THREE.Color(theme.fogColor).lerp(new THREE.Color('#ffffff'), 0.22);
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(theme.fogColor) },
      uExplored: { value: explored },
      uPattern: { value: pattern },
      uMap: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uMapSize: { value: new THREE.Vector2(1, 1) },
      uStyle: { value: theme.fogStyle === 'survey' ? 3 : 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vWorld = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uExplored;
      uniform vec3 uPattern;
      uniform sampler2D uMap;
      uniform vec2 uTexel;
      uniform vec2 uMapSize;
      uniform float uStyle;
      varying vec2 vUv;
      varying vec3 vWorld;
      float fogA(vec2 uv) { return texture2D(uMap, uv).g; }
      void main() {
        vec2 o = uTexel * 0.8;
        float a = fogA(vUv) * 0.44
          + (fogA(vUv + vec2(o.x, 0.0)) + fogA(vUv - vec2(o.x, 0.0))
           + fogA(vUv + vec2(0.0, o.y)) + fogA(vUv - vec2(0.0, o.y))) * 0.14;
        a = smoothstep(0.05, 0.95, a);
        // 0 in visible cells, ramps through explored (~0.45 alpha) to
        // unexplored (~0.85); used to fade edge patterns near the boundary.
        float unexplored = smoothstep(0.55, 0.8, a);
        float pat = 0.0;
        vec2 cell = vUv * uMapSize;
        if (uStyle > 2.5) {
          // Survey paper: height-contour lines plus a faint dot grid.
          float c = abs(fract(vWorld.y * 2.0) - 0.5);
          float cont = 1.0 - min(c / 0.05, 1.0);
          vec2 dg = fract(cell) - 0.5;
          float dotG = 1.0 - min(length(dg) / 0.09, 1.0);
          pat = cont * 0.8 + dotG * 0.45;
        }
        // Explored cells: dim with a slightly lifted tone at reduced alpha
        // so terrain stays readable through the film.
        vec3 col = mix(uExplored, uColor, unexplored);
        col = mix(col, uPattern, pat * unexplored * 0.6);
        // Survey keeps the explored film thinner so the info2d treatment
        // (desaturated/darkened world + bright markers) stays readable.
        float exploredA = uStyle > 2.5 ? 0.45 : 0.72;
        float alpha = a * mix(exploredA, 1.0, unexplored);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export function FogLayer({ client, map }: FogLayerProps) {
  const theme = useRenderTheme();
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const softMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const built = useRef<{ geometry: THREE.BufferGeometry; texture: THREE.DataTexture } | null>(null);
  const builtFor = useRef<{ map: ResolvedMap; theme: string; layer: ArrayLike<number> | null }>({
    map,
    theme: theme.id,
    layer: null,
  });

  useEffect(() => {
    return () => {
      built.current?.geometry.dispose();
      built.current?.texture.dispose();
      built.current = null;
      softMatRef.current?.dispose();
      softMatRef.current = null;
    };
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (mesh === null || material === null) {
      return;
    }
    if (
      built.current === null ||
      builtFor.current.map !== map ||
      builtFor.current.theme !== theme.id
    ) {
      built.current?.geometry.dispose();
      built.current?.texture.dispose();
      const grid = map.grid;
      const data = buildTerrainGeometry(
        grid.width,
        grid.height,
        grid.heights,
        grid.surfaces,
        grid.ramps,
        [{ r: 1, g: 1, b: 1 }],
      );
      for (let i = 1; i < data.positions.length; i += 3) {
        data.positions[i] = (data.positions[i] ?? 0) + LIFT;
      }
      const uvs = new Float32Array((data.positions.length / 3) * 2);
      for (let i = 0; i < data.positions.length; i += 3) {
        uvs[(i / 3) * 2] = (data.positions[i] ?? 0) / grid.width;
        uvs[(i / 3) * 2 + 1] = (data.positions[i + 2] ?? 0) / grid.height;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
      const texData = new Uint8Array(grid.width * grid.height * 4);
      const texture = new THREE.DataTexture(texData, grid.width, grid.height, THREE.RGBAFormat);
      if (theme.fogSoft) {
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
      } else {
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
      }
      texture.needsUpdate = true;
      built.current = { geometry, texture };
      builtFor.current.map = map;
      builtFor.current.theme = theme.id;
      mesh.geometry = geometry;
      if (theme.fogSoft) {
        if (softMatRef.current === null) {
          softMatRef.current = createSoftFogMaterial(theme);
        }
        const mat = softMatRef.current;
        const uColor = mat.uniforms['uColor'] as { value: THREE.Color } | undefined;
        uColor?.value.set(theme.fogColor);
        const uExplored = mat.uniforms['uExplored'] as { value: THREE.Color } | undefined;
        uExplored?.value.set(theme.fogColor).lerp(new THREE.Color('#ffffff'), 0.08);
        const uPattern = mat.uniforms['uPattern'] as { value: THREE.Color } | undefined;
        if (theme.fogStyle === 'survey') {
          uPattern?.value.set(theme.fogColor).multiplyScalar(0.62);
        } else {
          uPattern?.value.set(theme.fogColor).lerp(new THREE.Color('#ffffff'), 0.22);
        }
        const uTexel = mat.uniforms['uTexel'] as { value: THREE.Vector2 } | undefined;
        uTexel?.value.set(1 / grid.width, 1 / grid.height);
        const uMapSize = mat.uniforms['uMapSize'] as { value: THREE.Vector2 } | undefined;
        uMapSize?.value.set(grid.width, grid.height);
        const uMap = mat.uniforms['uMap'] as { value: THREE.DataTexture } | undefined;
        if (uMap !== undefined) {
          uMap.value = texture;
        }
        mesh.material = mat;
      } else {
        mesh.material = material;
        material.alphaMap = texture;
        material.needsUpdate = true;
      }
      builtFor.current.layer = null;
    }
    const latest = client.snapshots().latest;
    if (latest === null) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const layer = latest.layers[`${VISION_STATE_LAYER_ID}#${latest.observer}`] as
      ArrayLike<number> | undefined;
    if (layer === undefined || layer === builtFor.current.layer) {
      return;
    }
    builtFor.current.layer = layer;
    uploadFog(built.current.texture, layer, map.grid.width * map.grid.height);
  });

  return (
    <mesh ref={meshRef} renderOrder={2} frustumCulled={false}>
      <meshBasicMaterial
        ref={materialRef}
        color={FOG_COLOR}
        transparent
        depthWrite={false}
        opacity={1}
      />
    </mesh>
  );
}
