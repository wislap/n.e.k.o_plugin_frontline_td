// Scatter prop assets (split from ScatterLayer): deterministic per-cell
// prop placement, low-poly geometries, the wind-swaying grass material,
// per-theme prop palettes and the per-frame instanced-matrix writer.
import * as THREE from 'three';
import { InstanceWriter } from '../../../render/instance-writer';
import { renderNowMs } from '../../../client/capture-mode';
import type { ContentDb } from '../../../content/index';
import type { RenderVisual } from '../../../render/theme/index';
import { terrainY } from '../../../render/world';

export interface PropInstance {
  x: number;
  z: number;
  cell: number;
  rotY: number;
  lean: number;
  scale: number;
  tint: number;
}

export type PropKind = 'grass' | 'flower' | 'stone';

export const SCATTER_MESH_PREFIX = 'scatter-';
const FLOWER_COLORS = ['#f4f2e8', '#ffd94d', '#e8ecf4', '#d7e8ff'] as const;
// Spawn cap is generous — the per-frame camera-distance cull decides how
// many instances actually get written, so dense fields don't truncate
// partway through the scan order.
const MAX_MEADOW_PROPS = 64000;
// Explored-but-not-visible cells dim props to roughly match the fog film;
// unexplored cells hide them entirely (state 0/1/2 mirrors FogLayer).
const EXPLORED_DIM = 0.45;
// Meadow grass is culled by distance from the camera focus so dense
// fields stay cheap; stones/clutter are sparse enough to keep everywhere.
const MEADOW_VIEW_DIST = 85;
const U32 = 1 / 4294967296;

function cellHash(x: number, y: number, salt: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

// Irregular low-poly rock: icosahedron with deterministic per-vertex jitter
// and a flattened base so props read as stone, not dice.
export function createRockGeometry(radius: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const h = cellHash(i + seed, i * 7 + seed, 11) * U32;
    const h2 = cellHash(i * 3 + seed, i + seed, 13) * U32;
    const f = 0.78 + h * 0.4;
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * (0.62 + h2 * 0.28), pos.getZ(i) * f);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Grass clump: six thin tapered blades fanned around the origin,
// ~0.2–0.34 cells tall (far below a robot). Vertex colors carry a
// dark-root → light-tip gradient; wind sway displaces tips in the
// material shader by instance world position.
export function createGrassGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const BLADES = 6;
  for (let i = 0; i < BLADES; i++) {
    const a = (i / BLADES) * Math.PI * 2 + i * 0.73;
    const lean = 0.16 + (i % 3) * 0.12;
    const h = 0.2 + (i % 4) * 0.045;
    const w = 0.022;
    const dx = Math.cos(a) * 0.05;
    const dz = Math.sin(a) * 0.05;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    const lx = Math.cos(a) * lean;
    const lz = Math.sin(a) * lean;
    const base = pos.length / 3;
    pos.push(
      dx - px,
      0,
      dz - pz,
      dx + px,
      0,
      dz + pz,
      dx + lx - px * 0.3,
      h,
      dz + lz - pz * 0.3,
      dx + lx + px * 0.3,
      h,
      dz + lz + pz * 0.3,
    );
    col.push(0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 1.15, 1.15, 1.15, 1.15, 1.15, 1.15);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export interface MeadowTint {
  rampLow: THREE.Color;
  rampHigh: THREE.Color;
  hMin: number;
  hMax: number;
}

export function applyScatter(
  group: THREE.Group,
  props: Readonly<Record<PropKind, PropInstance[]>>,
  occupied: Uint8Array,
  vision: ArrayLike<number> | undefined,
  heights: ArrayLike<number>,
  mapWidth: number,
  mapHeight: number,
  writer: InstanceWriter,
  scratchColor: THREE.Color,
  grassScale: number,
  meadowTint: MeadowTint | null,
  camX: number,
  camZ: number,
): void {
  const hSpan = meadowTint === null ? 1 : Math.max(meadowTint.hMax - meadowTint.hMin, 1e-3);
  for (const kind of Object.keys(props) as PropKind[]) {
    const mesh = group.getObjectByName(`${SCATTER_MESH_PREFIX}${kind}`);
    if (mesh === undefined || !(mesh instanceof THREE.InstancedMesh)) {
      continue;
    }
    let count = 0;
    const lift = kind === 'grass' || kind === 'flower' ? 0.02 : 0.1;
    for (const p of props[kind]) {
      if (occupied[p.cell] !== 0) {
        continue;
      }
      if (kind === 'grass' && p.rotY > grassScale * Math.PI * 2) {
        continue;
      }
      const scale = p.scale;
      if (kind === 'grass' || kind === 'flower') {
        const ddx = p.x - camX;
        const ddz = p.z - camZ;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > MEADOW_VIEW_DIST * MEADOW_VIEW_DIST) {
          continue;
        }
      }
      const state = vision?.[p.cell] ?? 2;
      if (state === 0) {
        continue;
      }
      const dim = state === 1 ? EXPLORED_DIM : 1;
      writer.setEuler(
        mesh,
        count,
        p.x,
        terrainY(heights, mapWidth, mapHeight, p.x, p.z) + lift,
        p.z,
        p.lean,
        p.rotY,
        0,
        scale,
        scale,
        scale,
      );
      const t = p.tint * dim;
      if (kind === 'flower') {
        const ci = Math.floor((p.rotY / (Math.PI * 2)) * FLOWER_COLORS.length);
        scratchColor.set(FLOWER_COLORS[ci % FLOWER_COLORS.length] ?? '#ffffff');
        scratchColor.multiplyScalar(t);
      } else if (kind === 'grass' && meadowTint !== null) {
        // Match the terrain ramp at the prop's height so blades grow out
        // of the same ground colour, then keep the vertex root→tip shade.
        const hNorm = Math.min(1, Math.max(0, ((heights[p.cell] ?? 0) - meadowTint.hMin) / hSpan));
        scratchColor.copy(meadowTint.rampLow).lerp(meadowTint.rampHigh, hNorm);
        scratchColor.multiplyScalar(t);
      } else {
        scratchColor.setRGB(t, t, t);
      }
      mesh.setColorAt(count, scratchColor);
      count += 1;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true;
    }
  }
}

// Deterministic prop placement over walkable cells: clutter themes get
// rocks/crates/tufts; meadow themes get grass clumps, rare stones and
// clustered flower specks.
export function computeProps(
  density: number,
  grid: { width: number; height: number; surfaces: ArrayLike<number> },
  db: ContentDb,
): Record<PropKind, PropInstance[]> {
  const empty: Record<PropKind, PropInstance[]> = { grass: [], flower: [], stone: [] };
  const surfaces = grid.surfaces;
  const list = db.surfaces.list;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = y * grid.width + x;
      const surface = list[surfaces[cell] ?? 0];
      if (surface === undefined) {
        continue;
      }
      const walkable = surface.costs.some((c) => c >= 0);
      if (!walkable) {
        continue;
      }
      const h1 = cellHash(x, y, 1) * U32;
      const h2 = cellHash(x, y, 2) * U32;
      const h3 = cellHash(x, y, 3) * U32;
      const h4 = cellHash(x, y, 4) * U32;
      const px = x + 0.5 + (h2 - 0.5) * 0.6;
      const pz = y + 0.5 + (h3 - 0.5) * 0.6;
      const rotY = h4 * Math.PI * 2;
      const tint = 0.92 + cellHash(x, y, 6) * U32 * 0.16;
      if (h1 >= density) {
        continue;
      }
      const bucket = cellHash(x, y, 5) * U32;
      const scale = 0.7 + h4 * 0.6;
      if (empty.grass.length < MAX_MEADOW_PROPS) {
        // Meadow: several small grass clumps per cell, rare stones, and
        // flower specks gathered into clusters instead of scattered
        // uniformly — the field reads as tufts and drifts, not dots.
        if (bucket < 0.8) {
          const tufts = 3 + Math.floor(h2 * 3);
          for (let ti = 0; ti < tufts; ti++) {
            if (empty.grass.length >= MAX_MEADOW_PROPS) {
              break;
            }
            const jx = cellHash(x, y, 21 + ti) * U32;
            const jz = cellHash(x, y, 41 + ti) * U32;
            const jr = cellHash(x, y, 61 + ti) * U32;
            empty.grass.push({
              x: x + 0.12 + jx * 0.76,
              z: y + 0.12 + jz * 0.76,
              cell,
              rotY: jr * Math.PI * 2,
              lean: (cellHash(x, y, 81 + ti) * U32 - 0.5) * 0.22,
              scale: 0.75 + jx * 0.55,
              tint: 0.85 + jr * 0.3,
            });
          }
        } else if (bucket < 0.92) {
          empty.stone.push({ x: px, z: pz, cell, rotY, lean: 0, scale, tint });
        } else {
          const fx = x + 0.3 + h2 * 0.4;
          const fz = y + 0.3 + h3 * 0.4;
          const specks = 2 + Math.floor(h4 * 3);
          for (let fi = 0; fi < specks; fi++) {
            if (empty.flower.length >= MAX_MEADOW_PROPS) {
              break;
            }
            const fjx = cellHash(x, y, 91 + fi) * U32;
            const fjz = cellHash(x, y, 111 + fi) * U32;
            empty.flower.push({
              x: fx + (fjx - 0.5) * 0.5,
              z: fz + (fjz - 0.5) * 0.5,
              cell,
              rotY: fjx * Math.PI * 2,
              lean: 0,
              scale: 0.5 + fjz * 0.45,
              tint: 0.9 + fjx * 0.2,
            });
          }
        }
      }
    }
  }
  return empty;
}

export interface PropPalette {
  stone: string;
  grass: string;
}

// Prop palette from the theme: rocks/tufts take the terrain ramp so they
// sit in the same ground; crates share the structure palette.
export function propPalette(theme: RenderVisual): PropPalette {
  const mid = new THREE.Color(theme.terrain.rampLow).lerp(
    new THREE.Color(theme.terrain.rampHigh),
    0.5,
  );
  return {
    stone: `#${mid.clone().multiplyScalar(0.85).getHexString()}`,
    grass: `#${new THREE.Color(theme.terrain.rampHigh).multiplyScalar(1.08).getHexString()}`,
  };
}

// Meadow grass material: vertex-colored tapered blades with a wind-sway
// vertex displacement keyed on the instance's world offset; the uTime
// uniform is fed per frame via material.userData.
export function createGrassMaterial(tint: string): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    // White base: the per-instance color carries the terrain-matched
    // tint and the vertex color carries the root→tip gradient.
    color: '#ffffff',
    vertexColors: true,
    roughness: 1,
    side: THREE.DoubleSide,
    // Slight self-illumination keeps the backlit side of thin blades
    // from reading as black spikes against the bright terrain.
    emissive: tint,
    emissiveIntensity: 0.3,
  });
  mat.onBeforeCompile = (shader) => {
    // Seed with the render clock (not 0): recompiles create a fresh
    // uniform object, and the per-frame ref may still point at the old
    // one — starting at the live time keeps every compile on the same
    // phase instead of jumping to a zeroed wind.
    shader.uniforms['uTime'] = { value: renderNowMs() / 1000 };
    mat.userData['uTime'] = shader.uniforms['uTime'];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float swayPh = instanceMatrix[3][0] * 2.31 + instanceMatrix[3][2] * 1.73;
          float swayW = smoothstep(0.05, 0.25, position.y);
          transformed.x += sin(uTime * 1.9 + swayPh) * 0.07 * swayW;
          transformed.z += cos(uTime * 1.35 + swayPh * 1.7) * 0.05 * swayW;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'meadow-grass';
  return mat;
}

// Solid prop materials (stone/flower) as owned objects; callers dispose
// the map's values.
export function createPropMaterials(
  palette: PropPalette,
): Record<'stone' | 'flower', THREE.MeshStandardMaterial> {
  const mk = (color: string | undefined, roughness: number): THREE.MeshStandardMaterial => {
    const mat = new THREE.MeshStandardMaterial({ roughness });
    if (color !== undefined) {
      mat.color.set(color);
    }
    return mat;
  };
  return {
    stone: mk(palette.stone, 1),
    flower: mk(undefined, 0.8),
  };
}
