// Merged static terrain mesh (M2 C2): built once from the first snapshot's
// height/surface layers plus the content palette; disposed on unmount.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../protocol';
import type { Snapshot } from '../../../core/index';
import { buildTerrainGeometry, parseHexColor } from './geometry';

export interface TerrainMeshProps {
  snapshot: Snapshot | null;
  width: number;
  height: number;
  ramps: ArrayLike<number>;
  surfaceColors: readonly string[];
}

export function TerrainMesh({ snapshot, width, height, ramps, surfaceColors }: TerrainMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const heights = snapshot?.layers[TERRAIN_HEIGHT_LAYER_ID];
  const surfaces = snapshot?.layers[TERRAIN_SURFACE_LAYER_ID];

  const data = useMemo(() => {
    if (heights === undefined || surfaces === undefined) {
      return null;
    }
    return buildTerrainGeometry(
      width,
      height,
      heights,
      surfaces,
      ramps,
      surfaceColors.map(parseHexColor),
    );
  }, [heights, surfaces, width, height, ramps, surfaceColors]);

  const geometry = useMemo(() => {
    if (data === null) {
      return null;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [data]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  if (geometry === null) {
    return null;
  }
  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshLambertMaterial vertexColors />
    </mesh>
  );
}
