// Hostile exclusion circles (M5 batch D): while a build tool is active,
// draw the exclusion radius of every operational hostile structure that
// carries `exclusion` — live rows from the structures channel plus
// remembered rows from vision memory (same columns, never duplicated).
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBuildStore } from '../../../client/build-store';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb } from '../../../content/index';
import { VisionMemoryChannel } from '../../vision/protocol';
import type { VisionMemory } from '../../vision/protocol';
import { hostileExcluders } from '../../vision/rules/index';
import { ringStrip } from '../../../render/rings';
import { terrainY } from '../../../render/world';
import { StructuresChannel } from '../protocol';
import type { ConstructionStructures } from '../protocol';

const RING_COLOR = new THREE.Color('#ff5a4f');
const SEGMENTS = 48;
const MAX_CIRCLES = 32;
const LIFT = 0.07;

export interface ExclusionLayerProps {
  client: SimClient;
  db: ContentDb;
  heights: ArrayLike<number>;
  mapWidth: number;
  mapHeight: number;
  // Hostility from the match relations (observer, faction) → bool.
  isHostile: (observer: number, faction: number) => boolean;
}

export function ExclusionLayer({
  client,
  db,
  heights,
  mapWidth,
  mapHeight,
  isHostile,
}: ExclusionLayerProps) {
  const geom = useMemo(() => new THREE.BufferGeometry(), []);
  const positionsRef = useRef<Float32Array | null>(null);
  const colorsRef = useRef<Float32Array | null>(null);
  const segsRef = useRef<THREE.LineSegments>(null);

  useFrame(() => {
    const segs = segsRef.current;
    if (segs === null) {
      return;
    }
    const building = useBuildStore.getState().kind !== null;
    const latest = client.snapshots().latest;
    if (!building || latest === null) {
      segs.visible = false;
      return;
    }
    const observer = latest.observer;
    const structures = latest.channels[StructuresChannel.id] as ConstructionStructures | undefined;
    const memory = latest.channels[VisionMemoryChannel.id] as VisionMemory | undefined;
    const circles = hostileExcluders(db, (f) => isHostile(observer, f), [structures, memory]);
    const positions = (positionsRef.current ??= new Float32Array(MAX_CIRCLES * SEGMENTS * 6));
    const colors = (colorsRef.current ??= new Float32Array(MAX_CIRCLES * SEGMENTS * 6));
    let cursor = 0;
    for (const c of circles.slice(0, MAX_CIRCLES)) {
      const y = terrainY(heights, mapWidth, mapHeight, c.cx, c.cy) + LIFT;
      for (const v of ringStrip(c.cx, c.cy, y, c.r, SEGMENTS)) {
        positions[cursor] = v;
        colors[cursor] = RING_COLOR.r;
        colors[cursor + 1] = RING_COLOR.g;
        colors[cursor + 2] = RING_COLOR.b;
        cursor += 1;
      }
    }
    geom.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, cursor), 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors.slice(0, cursor), 3));
    geom.computeBoundingSphere();
    segs.visible = cursor > 0;
  });

  return (
    <lineSegments ref={segsRef} geometry={geom} visible={false} renderOrder={4}>
      <lineBasicMaterial vertexColors transparent opacity={0.85} depthWrite={false} />
    </lineSegments>
  );
}
