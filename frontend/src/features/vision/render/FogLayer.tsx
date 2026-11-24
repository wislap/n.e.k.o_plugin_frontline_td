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
import { useRenderTheme } from '../../../render/theme/index';
import { buildOutskirtsGeometry, buildTerrainGeometry } from '../../terrain/render/index';
import { VISION_STATE_LAYER_ID } from '../protocol';

// Lift + polygonOffset keep the film a hair above the ground: at grazing
// overview angles a tiny constant lift loses depth precision and the film
// z-fights the terrain, reading as dirty horizontal contour stripes.
const LIFT = 0.1;
// Film margin (cells): the film only hands the border vision state off to
// the terrain shader's out-of-bounds dim — extending it over the skirt
// hills made hill crests occlude the film, which read as contour stripes.
const FOG_RIM_MARGIN = 5;
const STATE_ALPHA = [Math.round(0.95 * 255), Math.round(0.55 * 255), 0] as const;

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

// Fog film shader: a 5-tap blur over the linear-filtered alpha smooths
// cell edges over ~1.5 cells (no staircase); the terrain reads through a
// translucent dark slate film — darkened and desaturated — and the film
// drifts toward the sky haze with camera distance so far fog merges into
// the horizon.
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
      uMargin: { value: FOG_RIM_MARGIN },
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
      uniform float uMargin;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDist;
      float fogA(vec2 uv) { return texture2D(uMap, uv).g; }
      void main() {
        // Cells beyond the map rect (UV clamps to border texels, so the
        // film holds the border state just past the edge, then dissolves
        // over the outer margin — never a straight-edged step.
        float oob = max(
          max(-vUv.x, vUv.x - 1.0) * uMapSize.x,
          max(-vUv.y, vUv.y - 1.0) * uMapSize.y);
        // Widen the blur kernel near the border so the vision-state
        // transition softens over ~2.5 cells instead of reading as a line.
        vec2 o = uTexel * mix(0.8, 2.5, smoothstep(-8.0, 2.0, oob));
        float a = fogA(vUv) * 0.44
          + (fogA(vUv + vec2(o.x, 0.0)) + fogA(vUv - vec2(o.x, 0.0))
           + fogA(vUv + vec2(0.0, o.y)) + fogA(vUv - vec2(0.0, o.y))) * 0.14;
        a = smoothstep(0.05, 0.95, a);
        // Outside the rect the border state would otherwise smear outward:
        // clamped border texels keep their per-cell alpha (explored vs
        // unexplored) as dirty radial streaks for the whole blend range.
        // Converge to full unexplored within ~5 cells so the smear dies
        // inside the falloff — the darkening still reads as a smooth
        // radial falloff starting just beyond the edge, never a hard line.
        a = mix(a, 0.85, smoothstep(1.5, 5.0, oob));
        // And dissolves entirely before the film's outer rim so it never
        // ends in a visible hard edge against the void or horizon.
        a *= 1.0 - smoothstep(uMargin * 0.55, uMargin * 0.95, oob);
        // 0 in visible cells, ramps through explored (~0.45 alpha) to
        // unexplored (~0.85); used to fade edge patterns near the boundary.
        float unexplored = smoothstep(0.55, 0.8, a);
        float hz = smoothstep(35.0, 110.0, vDist) * uHazeAmt;
        // The film converges to the haze colour only while it dissolves at
        // its outer rim — hazing earlier while still opaque paints a pale
        // ring hugging the border that reads as a wall around the map.
        float rim = smoothstep(uMargin * 0.5, uMargin * 0.95, oob);
        // Distance haze only applies out of bounds: inside the map the film
        // is a state overlay and must stay dark at any range — an opaque
        // pale film over far unexplored land stands up as a cream wall at
        // overview pitch. Past the border the film instead melts into the
        // horizon (colour first, then alpha) so the terrain's own dim
        // falloff carries the outskirts.
        float oobF = smoothstep(0.0, 2.0, oob);
        vec3 col = mix(uColor, uHaze, max(rim, hz * oobF));
        float alpha = a * mix(0.35, 0.85, unexplored);
        // Past the border nothing beneath the film needs to read: a
        // translucent film over lit skirt hills shows their shading as
        // dirty smears, so the film converges to near-opaque over the
        // same falloff band and the darkening stays smooth.
        alpha = mix(alpha, 0.92, smoothstep(1.0, 4.0, oob));
        alpha *= 1.0 - hz * 0.7 * oobF;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  return mat;
}

export function FogLayer({ client, map }: FogLayerProps) {
  const theme = useRenderTheme();
  const meshRef = useRef<THREE.Mesh>(null);
  const softMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const built = useRef<{ geometry: THREE.BufferGeometry; texture: THREE.DataTexture } | null>(null);
  const builtFor = useRef<{ map: ResolvedMap; layer: ArrayLike<number> | null }>({
    map,
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
    if (mesh === null) {
      return;
    }
    if (built.current === null || builtFor.current.map !== map) {
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
      // Extend the film past the map rect so it can dissolve over a few
      // cells instead of ending at a straight edge: out-of-range UV clamps
      // to the border texels, and the shader fades alpha over the outer
      // half of the margin.
      const skirt = buildOutskirtsGeometry(
        grid.width,
        grid.height,
        grid.heights,
        grid.ramps,
        FOG_RIM_MARGIN,
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
      builtFor.current.map = map;
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
      const uMargin = mat.uniforms['uMargin'] as { value: number } | undefined;
      if (uMargin !== undefined) {
        uMargin.value = FOG_RIM_MARGIN;
      }
      const uMap = mat.uniforms['uMap'] as { value: THREE.DataTexture } | undefined;
      if (uMap !== undefined) {
        uMap.value = texture;
      }
      mesh.material = mat;
      builtFor.current.layer = null;
    }
    const soft = softMatRef.current;
    if (soft !== null) {
      // Tactical info view keeps a neutral dark slate; only the 3D
      // spectate camera uses the (possibly warm) film color and fades
      // far fog into the sky haze.
      const tactical = useCameraStore.getState().mode === 'tactical';
      const uHazeAmt = soft.uniforms['uHazeAmt'] as { value: number } | undefined;
      if (uHazeAmt !== undefined) {
        uHazeAmt.value = tactical ? 0 : 1;
      }
      const uColor = soft.uniforms['uColor'] as { value: THREE.Color } | undefined;
      uColor?.value.set(tactical ? '#333c3a' : theme.fogColor);
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

  return <mesh ref={meshRef} renderOrder={2} frustumCulled={false} />;
}
