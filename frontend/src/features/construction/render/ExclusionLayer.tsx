// Hostile exclusion circles (M5 batch D): while a build tool is active,
// draw the exclusion radius of every operational hostile structure that
// carries `exclusion` — live rows from the structures channel plus
// remembered rows from vision memory (same columns, never duplicated).
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useInteractionStore } from '../../../client/interaction-store';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb } from '../../../content/index';
import {
  commitLineBuffer,
  createLineBuffer,
  ensureLineCapacity,
  type LineBuffer,
} from '../../../render/line-buffer';
import { writeRingVertices } from '../../../render/rings';
import { terrainY } from '../../../render/world';
import { VisionMemoryChannel } from '../../vision/protocol';
import type { VisionMemory } from '../../vision/protocol';
import { hostileExcluders } from '../../vision/rules/index';
import { StructuresChannel } from '../protocol';
import type { ConstructionStructures } from '../protocol';

const RING_COLOR = new THREE.Color('#ff5a4f');
const SEGMENTS = 48;
const MAX_CIRCLES = 32;
const LIFT = 0.07;

function ensureExclusionBuffer(
  bufRef: { current: LineBuffer | null },
  segs: THREE.LineSegments,
  vertices: number,
): LineBuffer {
  bufRef.current ??= createLineBuffer(MAX_CIRCLES * SEGMENTS * 2, true);
  const buf = bufRef.current;
  ensureLineCapacity(buf, vertices);
  if (segs.geometry !== buf.geometry) {
    segs.geometry.dispose();
    segs.geometry = buf.geometry;
  }
  return buf;
}

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
  const bufRef = useRef<LineBuffer | null>(null);
  const segsRef = useRef<THREE.LineSegments>(null);

  useEffect(() => {
    return () => {
      bufRef.current?.geometry.dispose();
      bufRef.current = null;
    };
  }, []);

  useFrame(() => {
    const segs = segsRef.current;
    if (segs === null) {
      return;
    }
    const building = useInteractionStore.getState().tool.kind === 'place';
    const latest = client.snapshots().latest;
    if (!building || latest === null) {
      segs.visible = false;
      return;
    }
    const observer = latest.observer;
    const structures = latest.channels[StructuresChannel.id] as ConstructionStructures | undefined;
    const memory = latest.channels[VisionMemoryChannel.id] as VisionMemory | undefined;
    const circles = hostileExcluders(db, (f) => isHostile(observer, f), [structures, memory]);
    const buf = ensureExclusionBuffer(bufRef, segs, circles.length * SEGMENTS * 2);
    const positions = buf.positions;
    const colors = buf.colors;
    if (colors === null) {
      return;
    }
    let cursor = 0;
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      if (c === undefined) {
        continue;
      }
      const y = terrainY(heights, mapWidth, mapHeight, c.cx, c.cy) + LIFT;
      cursor = writeRingVertices(
        positions,
        colors,
        cursor,
        c.cx,
        c.cy,
        y,
        c.r,
        SEGMENTS,
        RING_COLOR.r,
        RING_COLOR.g,
        RING_COLOR.b,
      );
    }
    commitLineBuffer(buf, cursor / 3);
    segs.visible = cursor > 0;
  });

  return (
    <lineSegments ref={segsRef} visible={false} renderOrder={4}>
      <lineBasicMaterial vertexColors transparent opacity={0.85} depthWrite={false} />
    </lineSegments>
  );
}
