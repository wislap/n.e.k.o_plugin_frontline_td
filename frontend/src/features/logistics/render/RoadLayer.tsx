// Road layer (M3 E3): paved cells from the global
// 'frontline_td:logistics.road' layer drawn as quads slightly above the
// terrain (z-fighting lift). Layers arrive as deltas, so the instance
// buffer is rebuilt only when the layer array identity changes.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import type { ResolvedMap } from '../../../content/index';
import { terrainY } from '../../../render/world';
import { ROAD_LAYER_ID } from '../protocol';

const ROAD_COLOR = '#8f7355';
const LIFT = 0.03;
const CAP = 65536;

export interface RoadLayerProps {
  client: SimClient;
  map: ResolvedMap;
  heights: ArrayLike<number>;
}

export function RoadLayer({ client, map, heights }: RoadLayerProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const builtFor = useRef<ArrayLike<number> | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (mesh === null) {
      return;
    }
    const layer = client.snapshots().latest?.layers[ROAD_LAYER_ID];
    if (layer === undefined || layer === builtFor.current) {
      return;
    }
    builtFor.current = layer;
    const { width, height } = map.grid;
    let count = 0;
    for (let y = 0; y < height && count < CAP; y++) {
      for (let x = 0; x < width && count < CAP; x++) {
        if ((layer[y * width + x] ?? 0) < 1) {
          continue;
        }
        dummy.position.set(
          x + 0.5,
          terrainY(heights, width, height, x + 0.5, y + 0.5) + LIFT,
          y + 0.5,
        );
        dummy.scale.set(0.96, 1, 0.96);
        dummy.updateMatrix();
        mesh.setMatrixAt(count, dummy.matrix);
        count += 1;
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, CAP]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} rotateX={-Math.PI / 2} />
      <meshLambertMaterial color={ROAD_COLOR} />
    </instancedMesh>
  );
}
