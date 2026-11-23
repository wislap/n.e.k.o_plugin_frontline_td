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

const FOG_COLOR = '#05070d';
const LIFT = 0.045;
// Minimum film margin (cells) so the dark film always dissolves into a
// smooth falloff several cells beyond the border instead of ending in a
// straight edge at the map rect or skirt rim.
const FOG_RIM_MARGIN = 10;
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
  fogStyle: 'plain' | 'survey' | 'dim';
  fogWash?: boolean | undefined;
  background: { haze: string };
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
  const dim = theme.fogStyle === 'dim';
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(theme.fogColor) },
      uExplored: { value: explored },
      uPattern: { value: pattern },
      uHaze: { value: new THREE.Color(theme.background.haze || theme.fogColor) },
      // Distance haze is spectate-only: the tactical info view must stay
      // a flat dark slate, so uHazeAmt is driven by camera mode per frame.
      uHazeAmt: { value: 1 },
      uMap: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uMapSize: { value: new THREE.Vector2(1, 1) },
      uStyle: { value: theme.fogStyle === 'survey' ? 3 : dim ? 4 : 0 },
      uWash: { value: theme.fogWash === true ? 1 : 0 },
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
      uniform vec3 uExplored;
      uniform vec3 uPattern;
      uniform vec3 uHaze;
      uniform float uHazeAmt;
      uniform sampler2D uMap;
      uniform vec2 uTexel;
      uniform vec2 uMapSize;
      uniform float uStyle;
      uniform float uWash;
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
        // Outside the rect the film keeps the border state for ~1.5 cells,
        // then blends smoothly to full unexplored — the darkening reads as
        // a radial falloff starting beyond the edge, never a hard line.
        a = mix(a, 0.85, smoothstep(1.5, 7.0, oob));
        // And dissolves entirely before the film's outer rim so it never
        // ends in a visible hard edge against the void or horizon.
        a *= 1.0 - smoothstep(uMargin * 0.55, uMargin * 0.95, oob);
        // 0 in visible cells, ramps through explored (~0.45 alpha) to
        // unexplored (~0.85); used to fade edge patterns near the boundary.
        float unexplored = smoothstep(0.55, 0.8, a);
        if (uStyle > 3.5) {
          // 'dim' (field): the terrain itself reads through a translucent
          // dark slate film — darkened and desaturated, never painted
          // paper — and the film drifts toward the sky haze with camera
          // distance so far fog merges into the horizon.
          float hz = smoothstep(35.0, 110.0, vDist) * uHazeAmt;
          vec3 col = mix(uColor, uHaze, hz * 0.65);
          float alpha = a * mix(0.35, mix(0.6, 0.42, uWash), unexplored);
          gl_FragColor = vec4(col, alpha);
          return;
        }
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
        float exploredA = uStyle > 2.5 ? 0.26 : 0.72;
        float alpha = a * mix(exploredA, 1.0, unexplored);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  return mat;
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
      // Extend the film past the map rect so it can dissolve over a few
      // cells instead of ending at a straight edge: out-of-range UV clamps
      // to the border texels, and the shader fades alpha over the outer
      // half of the margin.
      const margin = theme.fogSoft
        ? Math.max(theme.terrain.skirtCells, FOG_RIM_MARGIN)
        : theme.terrain.skirtCells;
      const skirt =
        margin > 0
          ? buildOutskirtsGeometry(grid.width, grid.height, grid.heights, grid.ramps, margin)
          : null;
      const vertCount = data.positions.length / 3 + (skirt?.positions.length ?? 0) / 3;
      const positions = new Float32Array(vertCount * 3);
      const uvs = new Float32Array(vertCount * 2);
      const indices = new Uint32Array(data.indices.length + (skirt?.indices.length ?? 0));
      positions.set(data.positions);
      indices.set(data.indices);
      const skirtVertBase = data.positions.length / 3;
      if (skirt !== null) {
        positions.set(skirt.positions, data.positions.length);
        for (let i = 0; i < skirt.indices.length; i++) {
          indices[data.indices.length + i] = (skirt.indices[i] ?? 0) + skirtVertBase;
        }
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
        const uMargin = mat.uniforms['uMargin'] as { value: number } | undefined;
        if (uMargin !== undefined) {
          uMargin.value = margin;
        }
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
    const soft = softMatRef.current;
    if (soft !== null) {
      // Tactical info view keeps the dark slate; only the 3D spectate
      // camera fades far fog into the sky haze.
      const uHazeAmt = soft.uniforms['uHazeAmt'] as { value: number } | undefined;
      if (uHazeAmt !== undefined) {
        uHazeAmt.value = useCameraStore.getState().mode === 'tactical' ? 0 : 1;
      }
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
