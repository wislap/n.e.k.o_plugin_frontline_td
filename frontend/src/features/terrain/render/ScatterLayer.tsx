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
import { bindOutline, createOutlineMaterial } from '../../../render/outline-material';
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
  const outlineOn = useUiStore((s) => s.outline);
  const outlineMat = useMemo(
    () =>
      theme.id !== 'legacy' && (outlineOn || theme.outlineAlways === true)
        ? createOutlineMaterial(theme.outline)
        : null,
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
  const watchedRef = useRef<readonly unknown[]>([]);
  const grassTimeRef = useRef<{ value: number } | null>(null);
  const kind = theme.scatter.kind;

  // Terrain-matched grass tint: same height ramp the terrain shader uses.
  const meadowTint = useMemo((): MeadowTint | null => {
    if (kind !== 'meadow') {
      return null;
    }
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
  }, [kind, heights, theme.terrain.rampLow, theme.terrain.rampHigh]);

  const palette = useMemo(() => propPalette(theme), [theme]);
  const toon = theme.toon === true;
  const rockGeo = useMemo(() => createRockGeometry(0.24, 17), []);
  const grassGeo = useMemo(() => createGrassGeometry(), []);
  const stoneGeo = useMemo(() => createRockGeometry(0.13, 53), []);
  const grassMat = useMemo(
    () => (kind === 'meadow' ? createGrassMaterial(palette.grass, toon) : null),
    [kind, palette.grass, toon],
  );
  const propMats = useMemo(() => createPropMaterials(palette, toon), [palette, toon]);

  useEffect(() => {
    grassTimeRef.current = (grassMat?.userData['uTime'] as { value: number } | undefined) ?? null;
    return () => {
      grassMat?.dispose();
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
      rockGeo.dispose();
      grassGeo.dispose();
      stoneGeo.dispose();
    };
  }, [rockGeo, grassGeo, stoneGeo]);

  const grid = map.grid;

  const props = useMemo(
    () => computeProps(kind, theme.scatter.density, grid, db),
    [kind, theme.scatter.density, grid, db],
  );

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
      (propKind, mesh) => {
        const ol = group.getObjectByName(`${SCATTER_MESH_PREFIX}ol-${propKind}`);
        if (ol instanceof THREE.InstancedMesh) {
          bindOutline(ol, mesh);
        }
      },
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
            material={propMats.rock}
          />
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}crate`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('crate')]}
            frustumCulled={false}
            castShadow
            receiveShadow
            material={propMats.crate}
          >
            <boxGeometry args={[0.34, 0.28, 0.34]} />
          </instancedMesh>
          <instancedMesh
            name={`${SCATTER_MESH_PREFIX}tuft`}
            raycast={NO_RAYCAST}
            args={[undefined, undefined, cap('tuft')]}
            frustumCulled={false}
            material={propMats.tuft}
          >
            <coneGeometry args={[0.14, 0.34, 5]} />
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
      )}
    </group>
  );
}
