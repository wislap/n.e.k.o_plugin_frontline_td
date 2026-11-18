// Shot tracers (M3 D): line segments from combat.shot events, fading
// over ~150 ms. Events are last-tick only; collectBeams dedupes by
// snapshot tick so each burst is appended once.
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
import { terrainY } from '../../../render/world';
import { VISION_STATE_LAYER_ID } from '../../vision/protocol';
import { isCellVisible } from '../../vision/rules/index';
import { BEAM_LIFE_MS, collectBeams, type Beam } from './beams';

const MAX_BEAMS = 256;
const BEAM_COLOR = new THREE.Color('#ffd24f');
const BEAM_LIFT = 0.6;

export interface BeamsLayerProps {
  client: SimClient;
  heights: ArrayLike<number>;
  mapWidth: number;
  mapHeight: number;
}

export function BeamsLayer({ client, heights, mapWidth, mapHeight }: BeamsLayerProps) {
  // Mutable GPU-side state lives behind a ref: created lazily inside
  // useFrame, attached to the object imperatively, disposed on unmount.
  const bufRef = useRef<LineBuffer | null>(null);
  useEffect(() => {
    return () => {
      bufRef.current?.geometry.dispose();
    };
  }, []);
  const active = useRef<Beam[]>([]);
  const lastTick = useRef(-1);
  const segsRef = useRef<THREE.LineSegments>(null);

  useFrame(() => {
    const segs = segsRef.current;
    if (segs === null) {
      return;
    }
    bufRef.current ??= createLineBuffer(MAX_BEAMS * 2, true);
    const buf = bufRef.current;
    segs.geometry = buf.geometry;
    const positions = buf.positions;
    const colors = buf.colors;
    if (colors === null) {
      return;
    }
    const now = performance.now();
    const latest = client.snapshots().latest;
    if (latest !== null) {
      const collected = collectBeams(latest.events, latest.tick, lastTick.current, now);
      lastTick.current = collected.tick;
      // Fog: events are all-visible on the wire; hide a shot only when
      // neither endpoint's cell is visible to the observer.
      const fog = latest.layers[`${VISION_STATE_LAYER_ID}#${latest.observer}`] as
        ArrayLike<number> | undefined;
      for (const beam of collected.beams) {
        if (
          fog === undefined ||
          isCellVisible(fog, mapWidth, beam.x0, beam.y0) ||
          isCellVisible(fog, mapWidth, beam.x1, beam.y1)
        ) {
          active.current.push(beam);
        }
      }
      if (active.current.length > MAX_BEAMS) {
        active.current.splice(0, active.current.length - MAX_BEAMS);
      }
    }
    // Drop expired beams and rebuild the buffers (fade by darkening).
    active.current = active.current.filter((b) => now - b.born < BEAM_LIFE_MS);
    let count = 0;
    const color = new THREE.Color();
    for (const beam of active.current) {
      const fade = 1 - (now - beam.born) / BEAM_LIFE_MS;
      color.copy(BEAM_COLOR).multiplyScalar(fade);
      const base = count * 6;
      positions[base] = beam.x0;
      positions[base + 1] = terrainY(heights, mapWidth, mapHeight, beam.x0, beam.y0) + BEAM_LIFT;
      positions[base + 2] = beam.y0;
      positions[base + 3] = beam.x1;
      positions[base + 4] = terrainY(heights, mapWidth, mapHeight, beam.x1, beam.y1) + BEAM_LIFT;
      positions[base + 5] = beam.y1;
      colors[base] = color.r;
      colors[base + 1] = color.g;
      colors[base + 2] = color.b;
      colors[base + 3] = color.r;
      colors[base + 4] = color.g;
      colors[base + 5] = color.b;
      count += 1;
    }
    ensureLineCapacity(buf, count * 2);
    commitLineBuffer(buf, count * 2);
    segs.visible = count > 0;
  });

  return (
    <lineSegments ref={segsRef} visible={false}>
      <lineBasicMaterial vertexColors transparent opacity={0.9} />
    </lineSegments>
  );
}
