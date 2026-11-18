// Fog-of-war overlay (M5 batch D): two instanced quad meshes over the
// observer's 'frontline_td:vision.state' layer — unexplored cells
// opaque-ish, explored cells dimmer, visible cells empty. Rebuilt only
// when the layer array identity changes (RoadLayer pattern); works in
// both camera modes since it's plain world-space geometry.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import { terrainY } from '../../../render/world';
import { VISION_STATE_LAYER_ID } from '../protocol';
import { fogBuckets } from '../rules/index';

const UNEXPLORED_COLOR = '#05070d';
const EXPLORED_COLOR = '#05070d';
const UNEXPLORED_OPACITY = 0.85;
const EXPLORED_OPACITY = 0.45;
const LIFT = 0.045;
const CAP = 262144;

export interface FogLayerProps {
  client: SimClient;
  heights: ArrayLike<number>;
  mapWidth: number;
  mapHeight: number;
}

export function FogLayer({ client, heights, mapWidth, mapHeight }: FogLayerProps) {
  const darkRef = useRef<THREE.InstancedMesh>(null);
  const dimRef = useRef<THREE.InstancedMesh>(null);
  const builtFor = useRef<ArrayLike<number> | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const dark = darkRef.current;
    const dim = dimRef.current;
    if (dark === null || dim === null) {
      return;
    }
    const latest = client.snapshots().latest;
    if (latest === null) {
      dark.count = 0;
      dim.count = 0;
      return;
    }
    const layer = latest.layers[`${VISION_STATE_LAYER_ID}#${latest.observer}`] as
      ArrayLike<number> | undefined;
    if (layer === undefined || layer === builtFor.current) {
      return;
    }
    builtFor.current = layer;
    const { unexplored, explored } = fogBuckets(layer, mapWidth, mapHeight);
    const fill = (mesh: THREE.InstancedMesh, cells: number[]): void => {
      let count = 0;
      for (const i of cells) {
        if (count >= CAP) {
          break;
        }
        const x = i % mapWidth;
        const y = Math.floor(i / mapWidth);
        dummy.position.set(
          x + 0.5,
          terrainY(heights, mapWidth, mapHeight, x + 0.5, y + 0.5) + LIFT,
          y + 0.5,
        );
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(count, dummy.matrix);
        count += 1;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    };
    fill(dark, unexplored);
    fill(dim, explored);
  });

  return (
    <group renderOrder={2}>
      <instancedMesh ref={darkRef} args={[undefined, undefined, CAP]}>
        <boxGeometry args={[1, 0.02, 1]} />
        <meshBasicMaterial
          color={UNEXPLORED_COLOR}
          transparent
          opacity={UNEXPLORED_OPACITY}
          depthWrite={false}
        />
      </instancedMesh>
      <instancedMesh ref={dimRef} args={[undefined, undefined, CAP]}>
        <boxGeometry args={[1, 0.02, 1]} />
        <meshBasicMaterial
          color={EXPLORED_COLOR}
          transparent
          opacity={EXPLORED_OPACITY}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}
