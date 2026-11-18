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

export function FogLayer({ client, map }: FogLayerProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
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
    };
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (mesh === null || material === null) {
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
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.needsUpdate = true;
      built.current = { geometry, texture };
      builtFor.current.map = map;
      mesh.geometry = geometry;
      material.alphaMap = texture;
      material.needsUpdate = true;
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
