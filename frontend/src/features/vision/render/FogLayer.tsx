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
import { useCameraStore } from '../../../client/camera-store';
import type { ResolvedMap } from '../../../content/index';
import type { SimClient } from '../../../client/sim-client';
import { VISUAL } from '../../../render/theme/index';
import { buildOutskirtsGeometry, buildTerrainGeometry } from '../../terrain/render/index';
import { VISION_STATE_LAYER_ID } from '../protocol';
import { readLayer } from '../../../core/index';
import { glslFloat } from '../../../render/shaders';
import { markBuilt } from '../../../render/use-gpu-resource';

// Lift + polygonOffset keep the film a hair above the ground: at grazing
// overview angles a tiny constant lift loses depth precision and the film
// z-fights the terrain, reading as dirty horizontal contour stripes.
const LIFT = 0.1;
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

// Fog film shader ('dim' style, b8bd104): a 5-tap blur over the linear-
// filtered alpha smooths cell edges over ~1.5 cells (no staircase); the
// terrain reads through a translucent dark slate film — darkened and
// desaturated — and the film drifts toward the sky haze with camera
// distance so far fog merges into the horizon.
// Fog film tuning (b8bd104 values): blur tap radius in texels, tap
// weights, the alpha remap ranges, the camera-distance haze range/tint,
// and the visible→unexplored alpha mix.
const FOG_BLUR_TEXELS = 0.8;
const FOG_CENTER_WEIGHT = 0.44;
const FOG_NEIGHBOR_WEIGHT = 0.14;
const FOG_REMAP_LO = 0.05;
const FOG_REMAP_HI = 0.95;
const FOG_UNEXPLORED_LO = 0.55;
const FOG_UNEXPLORED_HI = 0.8;
const FOG_HAZE_START = 35;
const FOG_HAZE_END = 110;
const FOG_HAZE_TINT = 0.65;
const FOG_ALPHA_MIN = 0.35;
const FOG_ALPHA_MAX = 0.6;

function createSoftFogMaterial(theme: {
  fogColor: string;
  background: { haze: string };
}): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    uniforms: {
      uColor: { value: new THREE.Color(theme.fogColor) },
      uHaze: { value: new THREE.Color(theme.background.haze || theme.fogColor) },
      // Distance haze is spectate-only: the tactical info view must stay
      // a flat dark slate, so uHazeAmt is driven by camera mode per frame.
      uHazeAmt: { value: 1 },
      uMap: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uMapSize: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDist;
      void main() {
        vUv = uv;
        vWorld = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDist = distance(wp.xyz, cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uHaze;
      uniform float uHazeAmt;
      uniform sampler2D uMap;
      uniform vec2 uTexel;
      uniform vec2 uMapSize;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDist;
      float fogA(vec2 uv) { return texture2D(uMap, uv).g; }
      void main() {
        vec2 o = uTexel * ${FOG_BLUR_TEXELS};
        float a = fogA(vUv) * ${FOG_CENTER_WEIGHT}
          + (fogA(vUv + vec2(o.x, 0.0)) + fogA(vUv - vec2(o.x, 0.0))
           + fogA(vUv + vec2(0.0, o.y)) + fogA(vUv - vec2(0.0, o.y))) * ${FOG_NEIGHBOR_WEIGHT};
        a = smoothstep(${FOG_REMAP_LO}, ${FOG_REMAP_HI}, a);
        // 0 in visible cells, ramps through explored (~0.45 alpha) to
        // unexplored (~0.85); used to fade edge patterns near the boundary.
        float unexplored = smoothstep(${FOG_UNEXPLORED_LO}, ${FOG_UNEXPLORED_HI}, a);
        float hz = smoothstep(${glslFloat(FOG_HAZE_START)}, ${glslFloat(FOG_HAZE_END)}, vDist) * uHazeAmt;
        vec3 col = mix(uColor, uHaze, hz * ${FOG_HAZE_TINT});
        float alpha = a * mix(${FOG_ALPHA_MIN}, ${FOG_ALPHA_MAX}, unexplored);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  return mat;
}

export function FogLayer({ client, map }: FogLayerProps) {
  const theme = VISUAL;
  const meshRef = useRef<THREE.Mesh>(null);
  const softMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const built = useRef<{ geometry: THREE.BufferGeometry; texture: THREE.DataTexture } | null>(null);
  const builtForMap = useRef<ResolvedMap>(map);
  const builtForLayer = useRef<ArrayLike<number> | null>(null);

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
    if (mesh === null) {
      return;
    }
    if (built.current === null || markBuilt(builtForMap, map)) {
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
      // Extend the film over the whole out-of-bounds skirt: out-of-range
      // UV clamps to the border texels, so the dark film continues past
      // the map edge with no visible seam and the distance haze carries
      // it to the horizon.
      const skirt = buildOutskirtsGeometry(
        grid.width,
        grid.height,
        grid.heights,
        grid.ramps,
        theme.terrain.skirtCells,
      );
      const vertCount = data.positions.length / 3 + skirt.positions.length / 3;
      const positions = new Float32Array(vertCount * 3);
      const uvs = new Float32Array(vertCount * 2);
      const indices = new Uint32Array(data.indices.length + skirt.indices.length);
      positions.set(data.positions);
      indices.set(data.indices);
      const skirtVertBase = data.positions.length / 3;
      positions.set(skirt.positions, data.positions.length);
      for (let i = 0; i < skirt.indices.length; i++) {
        indices[data.indices.length + i] = (skirt.indices[i] ?? 0) + skirtVertBase;
      }
      for (let i = 1; i < positions.length; i += 3) {
        positions[i] = (positions[i] ?? 0) + LIFT;
      }
      for (let i = 0; i < positions.length; i += 3) {
        uvs[(i / 3) * 2] = (positions[i] ?? 0) / grid.width;
        uvs[(i / 3) * 2 + 1] = (positions[i + 2] ?? 0) / grid.height;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      const texData = new Uint8Array(grid.width * grid.height * 4);
      const texture = new THREE.DataTexture(texData, grid.width, grid.height, THREE.RGBAFormat);
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      built.current = { geometry, texture };

      mesh.geometry = geometry;
      if (softMatRef.current === null) {
        softMatRef.current = createSoftFogMaterial(theme);
      }
      const mat = softMatRef.current;
      const uColor = mat.uniforms['uColor'] as { value: THREE.Color } | undefined;
      uColor?.value.set(theme.fogColor);
      const uTexel = mat.uniforms['uTexel'] as { value: THREE.Vector2 } | undefined;
      uTexel?.value.set(1 / grid.width, 1 / grid.height);
      const uMapSize = mat.uniforms['uMapSize'] as { value: THREE.Vector2 } | undefined;
      uMapSize?.value.set(grid.width, grid.height);
      const uMap = mat.uniforms['uMap'] as { value: THREE.DataTexture } | undefined;
      if (uMap !== undefined) {
        uMap.value = texture;
      }
      mesh.material = mat;
      builtForLayer.current = null;
    }
    const soft = softMatRef.current;
    if (soft !== null) {
      // Tactical info view keeps a neutral dark slate; only the 3D
      // spectate camera uses the film color and the distance haze.
      const tactical = useCameraStore.getState().mode === 'tactical';
      const uColor = soft.uniforms['uColor'] as { value: THREE.Color } | undefined;
      uColor?.value.set(tactical ? '#333c3a' : theme.fogColor);
      const uHazeAmt = soft.uniforms['uHazeAmt'] as { value: number } | undefined;
      if (uHazeAmt !== undefined) {
        uHazeAmt.value = tactical ? 0 : 1;
      }
    }
    const latest = client.snapshots().latest;
    if (latest === null) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const layer = readLayer(latest, `${VISION_STATE_LAYER_ID}#${latest.observer}`) ?? undefined;
    if (layer === undefined || !markBuilt(builtForLayer, layer)) {
      return;
    }
    uploadFog(built.current.texture, layer, map.grid.width * map.grid.height);
  });

  return <mesh ref={meshRef} renderOrder={2} frustumCulled={false} />;
}
