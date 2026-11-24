// Deterministic world dressing (visual-slice item 3): render-only scatter
// props placed by per-cell integer hash — never Math.random, so frames
// don't shimmer. One InstancedMesh per prop type keeps draw calls bounded.
// Props are hidden under structures, roads, roadworks and salvage by an
// occupancy mask rebuilt whenever those channel identities change.
// Placement, geometries, materials and the matrix writer live in
// scatter-assets.ts.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb, ResolvedMap } from '../../../content/index';
import { useRenderTheme } from '../../../render/theme/index';
import { useCameraStore } from '../../../client/camera-store';
import { useUiStore } from '../../../client/ui-store';
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
import { renderNowMs } from '../../../client/capture-mode';
import {
  applyScatter,
  computeProps,
  createGrassGeometry,
  createGrassMaterial,
  createPropMaterials,
  createRockGeometry,
  propPalette,
  SCATTER_MESH_PREFIX,
  type MeadowTint,
  type PropKind,
} from './scatter-assets';

const ATTACH_MATERIAL = 'material';
const NO_RAYCAST: THREE.Object3D['raycast'] = () => {};

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
  const watchedRef = useRef<readonly unknown[]>([]);
  const grassTimeRef = useRef<{ value: number } | null>(null);

  // Terrain-matched grass tint: same height ramp the terrain shader uses.
  const meadowTint = useMemo((): MeadowTint | null => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i] ?? 0;
      if (h < lo) {
        lo = h;
      }
      if (h > hi) {
        hi = h;
      }
    }
    return {
      rampLow: new THREE.Color(theme.terrain.rampLow),
      rampHigh: new THREE.Color(theme.terrain.rampHigh),
      hMin: lo,
      hMax: hi,
    };
  }, [heights, theme.terrain.rampLow, theme.terrain.rampHigh]);

  const palette = useMemo(() => propPalette(theme), [theme]);
  const grassGeo = useMemo(() => createGrassGeometry(), []);
  const stoneGeo = useMemo(() => createRockGeometry(0.13, 53), []);
  const grassMat = useMemo(() => createGrassMaterial(palette.grass), [palette.grass]);
  const propMats = useMemo(() => createPropMaterials(palette), [palette]);

  useEffect(() => {
    grassTimeRef.current = (grassMat.userData['uTime'] as { value: number } | undefined) ?? null;
    return () => {
      grassMat.dispose();
    };
  }, [grassMat]);
  useEffect(() => {
    return () => {
      for (const mat of Object.values(propMats)) {
        mat.dispose();
      }
    };
  }, [propMats]);
  useEffect(() => {
    return () => {
      grassGeo.dispose();
      stoneGeo.dispose();
    };
  }, [grassGeo, stoneGeo]);

  const grid = map.grid;

  const props = useMemo(
    () => computeProps(theme.scatter.density, grid, db),
    [theme.scatter.density, grid, db],
  );

  useFrame(() => {
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
      watched[5] === camQ &&
      watched[6] === heights
    ) {
      if (grassTimeRef.current !== null) {
        grassTimeRef.current.value = renderNowMs() / 1000;
      }
      return;
    }
    watchedRef.current = [structures, salvage, roadworks, road, vision, camQ, heights];

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
      grassTimeRef.current.value = renderNowMs() / 1000;
    }
  });

  const cap = (k: PropKind) => Math.max(1, props[k].length);

  return (
    <group ref={groupRef}>
      {
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
            material={propMats.stone}
          />
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}flower`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('flower')]}
            frustumCulled={false}
            material={propMats.flower}
          >
            <octahedronGeometry args={[0.07, 0]} />
          </instancedMesh>
        </>
      }
    </group>
  );
}
