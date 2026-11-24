// Remembered-structure overlay (M5 batch D): dim translucent boxes at
// the last-seen positions from the 'frontline_td:vision.memory' channel.
// Height/footprint come from structureKindHeight + the content db — the
// same geometry rules the live StructuresLayer uses.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb } from '../../../content/index';
import { structureKindHeight } from '../../construction/render/index';
import { terrainY } from '../../../render/world';
import { VisionMemoryChannel } from '../protocol';
import { readChannel } from '../../../core/index';

const MEMORY_COLOR = '#5a6478';
const MEMORY_OPACITY = 0.35;
const CAP = 4096;

export interface MemoryLayerProps {
  client: SimClient;
  db: ContentDb;
  heights: ArrayLike<number>;
  mapWidth: number;
  mapHeight: number;
}

export function MemoryLayer({ client, db, heights, mapWidth, mapHeight }: MemoryLayerProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const builtFor = useRef<ArrayLike<number> | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (mesh === null) {
      return;
    }
    const memory = readChannel(client.snapshots().latest, VisionMemoryChannel) ?? undefined;
    if (memory === undefined) {
      mesh.count = 0;
      return;
    }
    if (memory.handles === builtFor.current) {
      return;
    }
    builtFor.current = memory.handles;
    let count = 0;
    for (let i = 0; i < memory.handles.length && count < CAP; i++) {
      const kind = db.structures.byIndex(memory.kind[i] ?? -1);
      if (kind === undefined) {
        continue;
      }
      const w = kind.footprint.w;
      const h = kind.footprint.h;
      const cx = (memory.x[i] ?? 0) + w / 2;
      const cy = (memory.y[i] ?? 0) + h / 2;
      const height = structureKindHeight(db, memory.kind[i] ?? 0);
      dummy.position.set(cx, terrainY(heights, mapWidth, mapHeight, cx, cy) + height / 2, cy);
      dummy.scale.set(w * 0.9, height, h * 0.9);
      dummy.updateMatrix();
      mesh.setMatrixAt(count, dummy.matrix);
      count += 1;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, CAP]}
      renderOrder={3}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial
        color={MEMORY_COLOR}
        transparent
        opacity={MEMORY_OPACITY}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
