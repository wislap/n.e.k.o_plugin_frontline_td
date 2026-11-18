// Capture-point overlay (M5 batch D): a radius ring per capture point
// plus a progress arc in the owner's faction colour. Contested points
// pulse in a neutral colour. Line geometry is rebuilt each frame from
// the capture channel (a handful of points at most).
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import { factionColorHex } from '../../units/render/index';
import { terrainY } from '../../../render/world';
import { CapturePointsChannel } from '../protocol';
import type { CapturePoints } from '../protocol';
import { arcStrip, ringStrip } from '../../../render/rings';

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
  const geom = useMemo(() => new THREE.BufferGeometry(), []);
  const positionsRef = useRef<Float32Array | null>(null);
  const colorsRef = useRef<Float32Array | null>(null);
  const segsRef = useRef<THREE.LineSegments>(null);

  useFrame(() => {
    const segs = segsRef.current;
    if (segs === null) {
      return;
    }
    const latest = client.snapshots().latest;
    const points = latest?.channels[CapturePointsChannel.id] as CapturePoints | undefined;
    const observer = latest?.observer ?? null;
    const positions = (positionsRef.current ??= new Float32Array(MAX_POINTS * SEGMENTS * 4 * 3));
    const colors = (colorsRef.current ??= new Float32Array(MAX_POINTS * SEGMENTS * 4 * 3));
    let cursor = 0;
    const color = new THREE.Color();
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 200);
    if (points !== undefined) {
      for (let i = 0; i < points.handles.length && i < MAX_POINTS; i++) {
        const cx = points.x[i] ?? 0;
        const cy = points.y[i] ?? 0;
        const radius = points.radius[i] ?? 0;
        const y = terrainY(heights, mapWidth, mapHeight, cx, cy) + LIFT;
        const ring = ringStrip(cx, cy, y, radius, SEGMENTS);
        for (const v of ring) {
          positions[cursor] = v;
          colors[cursor] = RING_COLOR.r;
          colors[cursor + 1] = RING_COLOR.g;
          colors[cursor + 2] = RING_COLOR.b;
          cursor += 1;
        }
        const frac = (points.progressBp[i] ?? 0) / 10000;
        if (frac > 0) {
          const contested = (points.contested[i] ?? 0) !== 0;
          color.set(factionColorHex(points.owner[i] ?? 0, observer));
          if (contested) {
            color.copy(CONTESTED_COLOR).multiplyScalar(pulse);
          }
          const arc = arcStrip(cx, cy, y + 0.01, radius, frac, SEGMENTS);
          for (const v of arc) {
            positions[cursor] = v;
            colors[cursor] = color.r;
            colors[cursor + 1] = color.g;
            colors[cursor + 2] = color.b;
            cursor += 1;
          }
        }
        if (cursor >= positions.length - SEGMENTS * 4 * 3) {
          break;
        }
      }
    }
    geom.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, cursor), 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors.slice(0, cursor), 3));
    geom.computeBoundingSphere();
    segs.visible = cursor > 0;
  });

  return (
    <lineSegments ref={segsRef} geometry={geom} visible={false} renderOrder={4}>
      <lineBasicMaterial vertexColors transparent opacity={0.9} depthWrite={false} />
    </lineSegments>
  );
}
