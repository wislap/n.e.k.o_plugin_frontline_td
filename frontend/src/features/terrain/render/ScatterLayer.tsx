// Deterministic world dressing (visual-slice item 3): render-only scatter
// props placed by per-cell integer hash — never Math.random, so frames
// don't shimmer. One InstancedMesh per prop type keeps draw calls bounded.
// Props are hidden under structures, roads, roadworks and salvage by an
// occupancy mask rebuilt whenever those channel identities change.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb, ResolvedMap } from '../../../content/index';
import { bindOutline, createOutlineMaterial } from '../../../render/outline-material';
import { useRenderTheme } from '../../../render/theme/index';
import { useCameraStore } from '../../../client/camera-store';
import { useUiStore } from '../../../client/ui-store';
import { terrainY } from '../../../render/world';
import {
  RoadWorksChannel,
  SalvageChannel,
  StructuresChannel,
  type ConstructionSalvage,
  type ConstructionStructures,
  type RoadWorks,
} from '../../construction/protocol';
import { ROAD_LAYER_ID } from '../../logistics/protocol';
import { VISION_STATE_LAYER_ID } from '../../vision/protocol';

interface PropInstance {
  x: number;
  z: number;
  cell: number;
  rotY: number;
  lean: number;
  scale: number;
  tint: number;
}

type PropKind = 'rock' | 'crate' | 'tuft' | 'grass' | 'flower' | 'stone';

function cellHash(x: number, y: number, salt: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

const U32 = 1 / 4294967296;

const ATTACH_MATERIAL = 'material';
const SCATTER_MESH_PREFIX = 'scatter-';
const NO_RAYCAST: THREE.Object3D['raycast'] = () => {};
const TUFT_COLOR = '#5d6e38';
const FLOWER_COLORS = ['#f4f2e8', '#ffd94d', '#e8ecf4', '#d7e8ff'] as const;
// Grass instances are culled by a hash-fraction cutoff so the debug
// density slider removes a stable subset instead of popping.
// Spawn cap is generous — the per-frame camera-distance cull decides how
// many instances actually get written, so dense fields don't truncate
// partway through the scan order.
const MAX_MEADOW_PROPS = 64000;

// Irregular low-poly rock: icosahedron with deterministic per-vertex jitter
// and a flattened base so props read as stone, not dice.
function createRockGeometry(radius: number, seed: number): THREE.BufferGeometry {
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

// Grass clump: five thin tapered blades fanned around the origin,
// ~0.2–0.34 cells tall (far below a robot). Vertex colors carry a
// dark-root → light-tip gradient; wind sway displaces tips in the
// material shader by instance world position.
function createGrassGeometry(): THREE.BufferGeometry {
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

// Explored-but-not-visible cells dim props to roughly match the fog film;
// unexplored cells hide them entirely (state 0/1/2 mirrors FogLayer).
const EXPLORED_DIM = 0.45;

// Meadow grass is culled by distance from the camera focus so dense
// fields stay cheap; stones/clutter are sparse enough to keep everywhere.
const MEADOW_VIEW_DIST = 85;

interface MeadowTint {
  rampLow: THREE.Color;
  rampHigh: THREE.Color;
  hMin: number;
  hMax: number;
}

function applyScatter(
  group: THREE.Group,
  props: Readonly<Record<PropKind, PropInstance[]>>,
  occupied: Uint8Array,
  vision: ArrayLike<number> | undefined,
  heights: ArrayLike<number>,
  mapWidth: number,
  mapHeight: number,
  dummy: THREE.Object3D,
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
      if (kind === 'grass' || kind === 'flower') {
        const ddx = p.x - camX;
        const ddz = p.z - camZ;
        if (ddx * ddx + ddz * ddz > MEADOW_VIEW_DIST * MEADOW_VIEW_DIST) {
          continue;
        }
      }
      const state = vision?.[p.cell] ?? 2;
      if (state === 0) {
        continue;
      }
      const dim = state === 1 ? EXPLORED_DIM : 1;
      dummy.position.set(p.x, terrainY(heights, mapWidth, mapHeight, p.x, p.z) + lift, p.z);
      dummy.rotation.set(p.lean, p.rotY, 0);
      dummy.scale.set(p.scale, p.scale, p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(count, dummy.matrix);
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
    const ol = group.getObjectByName(`${SCATTER_MESH_PREFIX}ol-${kind}`);
    if (ol instanceof THREE.InstancedMesh) {
      bindOutline(ol, mesh);
    }
  }
}

export interface ScatterLayerProps {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  heights: ArrayLike<number>;
}

export function ScatterLayer({ client, db, map, heights }: ScatterLayerProps) {
  const theme = useRenderTheme();
  const outlineOn = useUiStore((s) => s.outline);
  const outlineMat = useMemo(
    () => (theme.id !== 'legacy' && outlineOn ? createOutlineMaterial(theme.outline) : null),
    [theme, outlineOn],
  );
  useEffect(() => {
    return () => {
      outlineMat?.dispose();
    };
  }, [outlineMat]);
  const groupRef = useRef<THREE.Group>(null);
  const dummyRef = useRef(new THREE.Object3D());
  const colorRef = useRef(new THREE.Color());
  const occupiedRef = useRef<Uint8Array | null>(null);
  const grassTimeRef = useRef<{ value: number } | null>(null);
  const watchedRef = useRef<unknown[]>([]);
  const kind = theme.scatter.kind;

  // Terrain-matched grass tint: same height ramp the terrain shader uses.
  const meadowTint = useMemo((): MeadowTint | null => {
    if (kind !== 'meadow') {
      return null;
    }
    let hMin = Infinity;
    let hMax = -Infinity;
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i] ?? 0;
      if (h < hMin) {
        hMin = h;
      }
      if (h > hMax) {
        hMax = h;
      }
    }
    return {
      rampLow: new THREE.Color(theme.terrain.rampLow),
      rampHigh: new THREE.Color(theme.terrain.rampHigh),
      hMin,
      hMax,
    };
  }, [kind, theme, heights]);

  // Prop tints derive from the terrain palette so scatter blends into the
  // local ground instead of reading as black spots.
  const propColors = useMemo(() => {
    const ramp = new THREE.Color(theme.terrain.rampLow).lerp(
      new THREE.Color(theme.terrain.rampHigh),
      0.5,
    );
    const stone = ramp.clone().multiplyScalar(0.72);
    return {
      rock: `#${stone.getHexString()}`,
      crate: theme.materials.structureBody,
      tuft: TUFT_COLOR,
      grass: `#${new THREE.Color(theme.terrain.rampHigh).multiplyScalar(1.08).getHexString()}`,
      flower: FLOWER_COLORS[0],
      stone: `#${stone.multiplyScalar(1.1).getHexString()}`,
    };
  }, [theme]);

  const rockGeo = useMemo(() => createRockGeometry(0.24, 17), []);
  const grassGeo = useMemo(() => createGrassGeometry(), []);
  const stoneGeo = useMemo(() => createRockGeometry(0.13, 53), []);
  // Wind sway for meadow grass: standard material + vertex displacement
  // keyed on the instance's world offset; time uniform fed per frame.
  const grassMat = useMemo(() => {
    if (kind !== 'meadow') {
      return null;
    }
    const mat = new THREE.MeshStandardMaterial({
      // White base: the per-instance color carries the terrain-matched
      // tint and the vertex color carries the root→tip gradient.
      color: '#ffffff',
      vertexColors: true,
      roughness: 1,
      side: THREE.DoubleSide,
      // Slight self-illumination keeps the backlit side of thin blades
      // from reading as black spikes against the bright terrain.
      emissive: propColors.grass,
      emissiveIntensity: 0.3,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = { value: 0 };
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
  }, [kind, propColors.grass]);
  useEffect(() => {
    grassTimeRef.current = (grassMat?.userData['uTime'] as { value: number } | undefined) ?? null;
    return () => {
      grassMat?.dispose();
    };
  }, [grassMat]);
  useEffect(() => {
    return () => {
      rockGeo.dispose();
      grassGeo.dispose();
      stoneGeo.dispose();
    };
  }, [rockGeo, grassGeo, stoneGeo]);

  const grid = map.grid;

  const props = useMemo(() => {
    const empty = {} as Record<PropKind, PropInstance[]>;
    if (kind === 'none') {
      return empty;
    }
    for (const k of ['rock', 'crate', 'tuft', 'grass', 'flower', 'stone'] as const) {
      empty[k] = [];
    }
    const density = theme.scatter.density;
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
        if (kind === 'clutter') {
          const target = bucket < 0.45 ? 'rock' : bucket < 0.7 ? 'crate' : 'tuft';
          empty[target].push({ x: px, z: pz, cell, rotY, lean: 0, scale, tint });
        } else if (empty.grass.length < MAX_MEADOW_PROPS) {
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
  }, [kind, theme.scatter.density, grid, db]);

  useFrame(() => {
    if (kind === 'none') {
      return;
    }
    const latest = client.snapshots().latest;
    if (latest === null) {
      return;
    }
    const structures = latest.channels[StructuresChannel.id] as ConstructionStructures | undefined;
    const salvage = latest.channels[SalvageChannel.id] as ConstructionSalvage | undefined;
    const roadworks = latest.channels[RoadWorksChannel.id] as RoadWorks | undefined;
    const road = latest.layers[ROAD_LAYER_ID] as ArrayLike<number> | undefined;
    const vision = latest.layers[`${VISION_STATE_LAYER_ID}#${latest.observer}`] as
      ArrayLike<number> | undefined;
    // Re-filter when the camera focus crosses ~4 cells — the meadow
    // distance cull needs a fresh pass even when channels are unchanged.
    const camState = useCameraStore.getState();
    const camCenter = camState.center;
    // The tactical info view drops props entirely — grass and stones are
    // noise on the dark slate read, not information.
    const groupVis = groupRef.current;
    if (groupVis !== null) {
      groupVis.visible = !(
        theme.info2d &&
        useUiStore.getState().info2d &&
        camState.mode === 'tactical'
      );
    }
    const camQ = Math.floor(camCenter.x / 4) * 4096 + Math.floor(camCenter.y / 4);
    const watched = watchedRef.current;
    if (
      occupiedRef.current !== null &&
      watched[0] === structures &&
      watched[1] === salvage &&
      watched[2] === roadworks &&
      watched[3] === road &&
      watched[4] === vision &&
      watched[5] === camQ
    ) {
      if (grassTimeRef.current !== null) {
        grassTimeRef.current.value = performance.now() / 1000;
      }
      return;
    }
    watchedRef.current = [structures, salvage, roadworks, road, vision, camQ];

    const cells = grid.width * grid.height;
    const occupied = (occupiedRef.current ??= new Uint8Array(cells));
    occupied.fill(0);
    if (structures !== undefined) {
      for (let i = 0; i < structures.handles.length; i++) {
        const k = db.structures.byIndex(structures.kind[i] ?? 0);
        if (k === undefined) {
          continue;
        }
        const x0 = structures.x[i] ?? 0;
        const y0 = structures.y[i] ?? 0;
        for (let dy = 0; dy < k.footprint.h; dy++) {
          for (let dx = 0; dx < k.footprint.w; dx++) {
            const cx = x0 + dx;
            const cy = y0 + dy;
            if (cx >= 0 && cx < grid.width && cy >= 0 && cy < grid.height) {
              occupied[cy * grid.width + cx] = 1;
            }
          }
        }
      }
    }
    if (road !== undefined) {
      for (let i = 0; i < cells && i < road.length; i++) {
        if ((road[i] ?? 0) >= 1) {
          occupied[i] = 1;
        }
      }
    }
    if (roadworks !== undefined) {
      const proj = roadworks.projects;
      for (let i = 0; i < proj.cells.length; i++) {
        const c = proj.cells[i] ?? 0;
        if (c >= 0 && c < cells) {
          occupied[c] = 1;
        }
      }
    }
    if (salvage !== undefined) {
      for (let i = 0; i < salvage.handles.length; i++) {
        const cx = Math.floor(salvage.x[i] ?? 0);
        const cy = Math.floor(salvage.y[i] ?? 0);
        if (cx >= 0 && cx < grid.width && cy >= 0 && cy < grid.height) {
          occupied[cy * grid.width + cx] = 1;
        }
      }
    }
    const group = groupRef.current;
    if (group === null) {
      return;
    }
    applyScatter(
      group,
      props,
      occupied,
      vision,
      heights,
      grid.width,
      grid.height,
      dummyRef.current,
      colorRef.current,
      useUiStore.getState().grassDensity,
      meadowTint,
      camCenter.x,
      camCenter.y,
    );
    if (grassTimeRef.current !== null) {
      grassTimeRef.current.value = performance.now() / 1000;
    }
  });

  if (kind === 'none') {
    return null;
  }
  const cap = (k: PropKind) => Math.max(1, props[k].length);
  const outlineKinds = (Object.keys(props) as PropKind[]).filter((k) => props[k].length > 0);

  return (
    <group key={`${theme.id}-${kind}`} ref={groupRef}>
      {outlineMat !== null &&
        outlineKinds.map((k) => (
          <instancedMesh
            key={`ol-${k}`}
            name={`${SCATTER_MESH_PREFIX}ol-${k}`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap(k)]}
            frustumCulled={false}
          >
            <primitive object={outlineMat} attach={ATTACH_MATERIAL} />
          </instancedMesh>
        ))}
      {kind === 'clutter' && (
        <>
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}rock`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('rock')]}
            frustumCulled={false}
            castShadow
            receiveShadow
            geometry={rockGeo}
          >
            <meshStandardMaterial color={propColors.rock} roughness={0.95} />
          </instancedMesh>
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}crate`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('crate')]}
            frustumCulled={false}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.34, 0.28, 0.34]} />
            <meshStandardMaterial color={propColors.crate} roughness={0.85} />
          </instancedMesh>
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}tuft`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('tuft')]}
            frustumCulled={false}
          >
            <coneGeometry args={[0.14, 0.34, 5]} />
            <meshStandardMaterial color={propColors.tuft} roughness={1} />
          </instancedMesh>
        </>
      )}
      {kind === 'meadow' && grassMat !== null && (
        <>
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}grass`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('grass')]}
            frustumCulled={false}
            geometry={grassGeo}
          >
            <primitive object={grassMat} attach={ATTACH_MATERIAL} />
          </instancedMesh>
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}stone`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('stone')]}
            frustumCulled={false}
            castShadow
            receiveShadow
            geometry={stoneGeo}
          >
            <meshStandardMaterial color={propColors.stone} roughness={1} />
          </instancedMesh>
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}flower`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('flower')]}
            frustumCulled={false}
          >
            <octahedronGeometry args={[0.07, 0]} />
            <meshStandardMaterial roughness={0.8} />
          </instancedMesh>
        </>
      )}
    </group>
  );
}
