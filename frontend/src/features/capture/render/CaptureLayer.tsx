// Capture-point overlay (M5 batch D): a radius ring per capture point
// plus a progress arc in the owner's faction colour. Contested points
// pulse in a neutral colour. Line geometry is rebuilt each frame from
// the capture channel (a handful of points at most).
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import {
  commitLineBuffer,
  createLineBuffer,
  ensureLineCapacity,
  type LineBuffer,
} from '../../../render/line-buffer';
import { factionColorHex } from '../../units/render/index';
import { terrainY } from '../../../render/world';
import { CapturePointsChannel } from '../protocol';
import type { CapturePoints } from '../protocol';
import { writeArcVertices, writeRingVertices } from '../../../render/rings';

const RING_COLOR = new THREE.Color('#8890a0');
const CONTESTED_COLOR = new THREE.Color('#ffd24f');
const SEGMENTS = 48;
const MAX_POINTS = 64;
const LIFT = 0.06;

export interface CaptureLayerProps {
  client: SimClient;
  heights: ArrayLike<number>;
  mapWidth: number;
  mapHeight: number;
}

export function CaptureLayer({ client, heights, mapWidth, mapHeight }: CaptureLayerProps) {
  // Mutable GPU-side state lives behind a ref: created lazily inside
  // useFrame, attached to the object imperatively, disposed on unmount.
  const bufRef = useRef<LineBuffer | null>(null);
  useEffect(() => {
    return () => {
      bufRef.current?.geometry.dispose();
    };
  }, []);
  const segsRef = useRef<THREE.LineSegments>(null);
  const tempColorRef = useRef(new THREE.Color());

  useFrame(() => {
    const segs = segsRef.current;
    if (segs === null) {
      return;
    }
    bufRef.current ??= createLineBuffer(MAX_POINTS * SEGMENTS * 4, true);
    const buf = bufRef.current;
    const latest = client.snapshots().latest;
    const points = latest?.channels[CapturePointsChannel.id] as CapturePoints | undefined;
    if (points !== undefined) {
      const pointCount = Math.min(points.handles.length, MAX_POINTS);
      ensureLineCapacity(buf, pointCount * SEGMENTS * 6);
    }
    segs.geometry = buf.geometry;
    const positions = buf.positions;
    const colors = buf.colors;
    if (colors === null) {
      return;
    }
    const observer = latest?.observer ?? null;
    let cursor = 0;
    const color = tempColorRef.current;
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 200);
    if (points !== undefined) {
      for (let i = 0; i < points.handles.length && i < MAX_POINTS; i++) {
        if (cursor + 6 > positions.length) {
          break;
        }
        const cx = points.x[i] ?? 0;
        const cy = points.y[i] ?? 0;
        const radius = points.radius[i] ?? 0;
        const y = terrainY(heights, mapWidth, mapHeight, cx, cy) + LIFT;
        cursor = writeRingVertices(
          positions,
          colors,
          cursor,
          cx,
          cy,
          y,
          radius,
          SEGMENTS,
          RING_COLOR.r,
          RING_COLOR.g,
          RING_COLOR.b,
        );
        const frac = (points.progressBp[i] ?? 0) / 10000;
        if (frac > 0) {
          if (cursor + 6 > positions.length) {
            break;
          }
          const contested = (points.contested[i] ?? 0) !== 0;
          color.set(factionColorHex(points.owner[i] ?? 0, observer));
          if (contested) {
            color.copy(CONTESTED_COLOR).multiplyScalar(pulse);
          }
          cursor = writeArcVertices(
            positions,
            colors,
            cursor,
            cx,
            cy,
            y + 0.01,
            radius,
            frac,
            SEGMENTS,
            color.r,
            color.g,
            color.b,
          );
        }
      }
    }
    commitLineBuffer(buf, cursor / 3);
    segs.visible = cursor > 0;
  });

  return (
    <lineSegments ref={segsRef} visible={false} renderOrder={4}>
      <lineBasicMaterial vertexColors transparent opacity={0.9} depthWrite={false} />
    </lineSegments>
  );
}
