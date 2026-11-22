// Deterministic world dressing (visual-slice item 3): render-only scatter
// props placed by per-cell integer hash — never Math.random, so frames
// don't shimmer. One InstancedMesh per prop type keeps draw calls bounded.
// Props are hidden under structures, roads, roadworks and salvage by an
// occupancy mask rebuilt whenever those channel identities change; cells
// hosting deposits (ore fields) get crystal props in mindustry instead.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb, ResolvedMap } from '../../../content/index';
import { useRenderTheme } from '../../../render/theme/index';
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
  scale: number;
  tint: number;
}

type PropKind = 'rock' | 'crate' | 'tuft' | 'stud' | 'panel' | 'boulder' | 'pebble' | 'crystal';

function cellHash(x: number, y: number, salt: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

const U32 = 1 / 4294967296;

const SCATTER_MESH_PREFIX = 'scatter-';
const NO_RAYCAST: THREE.Object3D['raycast'] = () => {};
const TUFT_COLOR = '#5d6e38';
const CRYSTAL_COLOR = '#8a5adf';
const CRYSTAL_EMISSIVE = '#6a3adf';

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

// Explored-but-not-visible cells dim props to roughly match the fog film;
// unexplored cells hide them entirely (state 0/1/2 mirrors FogLayer).
const EXPLORED_DIM = 0.45;

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
): void {
  for (const kind of Object.keys(props) as PropKind[]) {
    const mesh = group.getObjectByName(`${SCATTER_MESH_PREFIX}${kind}`);
    if (mesh === undefined || !(mesh instanceof THREE.InstancedMesh)) {
      continue;
    }
    let count = 0;
    const lift = kind === 'stud' || kind === 'panel' ? 0.03 : 0.1;
    for (const p of props[kind]) {
      if (occupied[p.cell] !== 0) {
        continue;
      }
      const state = vision?.[p.cell] ?? 2;
      if (state === 0) {
        continue;
      }
      const dim = state === 1 ? EXPLORED_DIM : 1;
      dummy.position.set(p.x, terrainY(heights, mapWidth, mapHeight, p.x, p.z) + lift, p.z);
      dummy.rotation.set(0, p.rotY, 0);
      dummy.scale.set(p.scale, p.scale, p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(count, dummy.matrix);
      const t = p.tint * dim;
      mesh.setColorAt(count, scratchColor.setRGB(t, t, t));
      count += 1;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true;
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
  const groupRef = useRef<THREE.Group>(null);
  const dummyRef = useRef(new THREE.Object3D());
  const colorRef = useRef(new THREE.Color());
  const occupiedRef = useRef<Uint8Array | null>(null);
  const watchedRef = useRef<unknown[]>([]);

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
      stud: theme.markers.accent,
      panel: theme.materials.structureTrim,
      boulder: `#${stone.getHexString()}`,
      pebble: `#${ramp.multiplyScalar(0.85).getHexString()}`,
      crystal: CRYSTAL_COLOR,
    };
  }, [theme]);

  const rockGeo = useMemo(() => createRockGeometry(0.24, 17), []);
  const boulderGeo = useMemo(() => createRockGeometry(0.26, 41), []);
  useEffect(() => {
    return () => {
      rockGeo.dispose();
      boulderGeo.dispose();
    };
  }, [rockGeo, boulderGeo]);

  const grid = map.grid;
  const kind = theme.scatter.kind;

  const props = useMemo(() => {
    const empty = {} as Record<PropKind, PropInstance[]>;
    if (kind === 'none') {
      return empty;
    }
    for (const k of [
      'rock',
      'crate',
      'tuft',
      'stud',
      'panel',
      'boulder',
      'pebble',
      'crystal',
    ] as const) {
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
        const isOre = surface.deposit !== undefined;
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
        if (kind === 'boulders' && isOre) {
          if (h1 < 0.5) {
            empty.crystal.push({ x: px, z: pz, cell, rotY, scale: 0.7 + h4 * 0.7, tint });
          }
          continue;
        }
        if (h1 >= density) {
          continue;
        }
        const bucket = cellHash(x, y, 5) * U32;
        const scale = 0.7 + h4 * 0.6;
        if (kind === 'clutter') {
          const target = bucket < 0.45 ? 'rock' : bucket < 0.7 ? 'crate' : 'tuft';
          empty[target].push({ x: px, z: pz, cell, rotY, scale, tint });
        } else if (kind === 'studs') {
          const target = bucket < 0.6 ? 'stud' : 'panel';
          // Studs sit on tile corners, panels center on the cell.
          const sx = target === 'stud' ? x + (h2 < 0.5 ? 0 : 1) : x + 0.5;
          const sz = target === 'stud' ? y + (h3 < 0.5 ? 0 : 1) : y + 0.5;
          empty[target].push({ x: sx, z: sz, cell, rotY, scale, tint });
        } else {
          const target = bucket < 0.55 ? 'boulder' : 'pebble';
          empty[target].push({ x: px, z: pz, cell, rotY, scale, tint });
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
    const watched = watchedRef.current;
    if (
      occupiedRef.current !== null &&
      watched[0] === structures &&
      watched[1] === salvage &&
      watched[2] === roadworks &&
      watched[3] === road &&
      watched[4] === vision
    ) {
      return;
    }
    watchedRef.current = [structures, salvage, roadworks, road, vision];

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
    );
  });

  if (kind === 'none') {
    return null;
  }
  const cap = (k: PropKind) => Math.max(1, props[k].length);

  return (
    <group key={`${theme.id}-${kind}`} ref={groupRef}>
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
      {kind === 'studs' && (
        <>
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}stud`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('stud')]}
            frustumCulled={false}
          >
            <octahedronGeometry args={[0.07, 0]} />
            <meshBasicMaterial color={propColors.stud} toneMapped={false} />
          </instancedMesh>
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}panel`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('panel')]}
            frustumCulled={false}
            receiveShadow
          >
            <boxGeometry args={[0.9, 0.03, 0.9]} />
            <meshStandardMaterial color={propColors.panel} roughness={0.7} />
          </instancedMesh>
        </>
      )}
      {kind === 'boulders' && (
        <>
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}boulder`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('boulder')]}
            frustumCulled={false}
            castShadow
            receiveShadow
            geometry={boulderGeo}
          >
            <meshStandardMaterial color={propColors.boulder} roughness={1} />
          </instancedMesh>
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}pebble`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('pebble')]}
            frustumCulled={false}
            receiveShadow
          >
            <icosahedronGeometry args={[0.09, 0]} />
            <meshStandardMaterial color={propColors.pebble} roughness={1} />
          </instancedMesh>
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}crystal`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('crystal')]}
            frustumCulled={false}
            castShadow
          >
            <octahedronGeometry args={[0.2, 0]} />
            <meshStandardMaterial
              color={CRYSTAL_COLOR}
              emissive={CRYSTAL_EMISSIVE}
              emissiveIntensity={0.9}
              roughness={0.4}
            />
          </instancedMesh>
        </>
      )}
    </group>
  );
}
