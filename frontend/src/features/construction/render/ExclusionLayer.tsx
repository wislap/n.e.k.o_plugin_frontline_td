// Hostile exclusion circles (M5 batch D, M2B 1.2c): while a build tool
// is active, draw the exclusion radius of every operational hostile
// structure that carries `exclusion` via a single dirty-gated
// DashRingMaterial InstancedMesh.
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useInteractionStore } from '../../../client/interaction-store';
import type { ContentDb } from '../../../content/index';
import { createDashRingMaterial } from '../../../render/dash-ring';
import { InstanceWriter } from '../../../render/instance-writer';
import type { SceneLayerProps } from '../../../render/scene';
import { VISUAL } from '../../../render/theme/index';
import { useGpuResource } from '../../../render/use-gpu-resource';
import { terrainY } from '../../../client/world';
import { VisionMemoryChannel, type VisionMemory } from '../../vision/protocol';
import { hostileExcluders } from '../../vision/rules/index';
import { StructuresChannel, type ConstructionStructures } from '../protocol';
import { readChannel } from '../../../core/index';

const RING_COLOR = VISUAL.markers.danger;
const RING_SEGMENTS = 64;
const INITIAL_CAPACITY = 32;
const LIFT = 0.07;

interface ExclusionCache {
  structures: ConstructionStructures | undefined;
  memory: VisionMemory | undefined;
  observer: number;
  heights: ArrayLike<number> | null;
  db: ContentDb | null;
  capacity: number;
  count: number;
}

export function ExclusionLayer({ ctx }: SceneLayerProps) {
  const { client, db, heights, isHostile } = ctx;
  const { width: mapWidth, height: mapHeight } = ctx.map.grid;
  const [capacity, setCapacity] = useState(INITIAL_CAPACITY);

  const ringGeo = useMemo(() => new THREE.RingGeometry(0.8, 1, RING_SEGMENTS), []);
  useGpuResource(ringGeo);

  const ringMat = useMemo(
    () => createDashRingMaterial(RING_COLOR, { dash: 0, width: 0.06, opacity: 0.85 }),
    [],
  );
  useGpuResource(ringMat);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const writerRef = useRef<InstanceWriter | null>(null);
  const cacheRef = useRef<ExclusionCache>({
    structures: undefined,
    memory: undefined,
    observer: -1,
    heights: null,
    db: null,
    capacity: 0,
    count: 0,
  });

  useFrame(() => {
    const mesh = meshRef.current;
    if (mesh === null) {
      return;
    }
    const building = useInteractionStore.getState().tool.kind === 'place';
    const latest = client.snapshots().latest;
    if (!building || latest === null) {
      mesh.visible = false;
      return;
    }
    const observer = latest.observer;
    const structures = readChannel(latest, StructuresChannel) ?? undefined;
    const memory = readChannel(latest, VisionMemoryChannel) ?? undefined;
    const cache = cacheRef.current;

    if (
      cache.structures === structures &&
      cache.memory === memory &&
      cache.observer === observer &&
      cache.heights === heights &&
      cache.db === db &&
      cache.capacity === capacity
    ) {
      mesh.visible = cache.count > 0;
      return;
    }

    const circles = hostileExcluders(db, (f) => isHostile(observer, f), [structures, memory]);
    if (circles.length > capacity) {
      setCapacity(Math.max(capacity * 2, circles.length));
      mesh.visible = false;
      return;
    }

    writerRef.current ??= new InstanceWriter();
    const writer = writerRef.current;
    let count = 0;
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      if (c === undefined) {
        continue;
      }
      const y = terrainY(heights, mapWidth, mapHeight, c.cx, c.cy) + LIFT;
      writer.setFlat(mesh, count, c.cx, y, c.cy, c.r, c.r);
      count += 1;
    }
    mesh.count = count;
    mesh.visible = count > 0;
    if (count > 0) {
      mesh.instanceMatrix.needsUpdate = true;
    }

    cache.structures = structures;
    cache.memory = memory;
    cache.observer = observer;
    cache.heights = heights;
    cache.db = db;
    cache.capacity = capacity;
    cache.count = count;
  });

  return (
    <instancedMesh
      key={capacity}
      ref={meshRef}
      args={[ringGeo, ringMat, capacity]}
      visible={false}
      renderOrder={4}
      frustumCulled={false}
    />
  );
}
