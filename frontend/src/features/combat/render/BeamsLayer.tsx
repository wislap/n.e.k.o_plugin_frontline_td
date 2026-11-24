// Shot tracers (M3 D): line segments from combat.shot events, fading
// over ~150 ms. The client's event log delivers each event to this
// consumer exactly once via its own cursor.
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
import { renderNowMs } from '../../../client/capture-mode';

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
  const eventCursor = useRef(0);
  const segsRef = useRef<THREE.LineSegments>(null);
  const tempColorRef = useRef(new THREE.Color());

  useFrame(() => {
    const segs = segsRef.current;
    if (segs === null) {
      return;
    }
    bufRef.current ??= createLineBuffer(MAX_BEAMS * 2, true);
    const buf = bufRef.current;
    const now = renderNowMs();
    const delivered = client.eventsSince(eventCursor.current);
    eventCursor.current = delivered.cursor;
    const latest = client.snapshots().latest;
    if (delivered.events.length > 0) {
      // Fog: events are all-visible on the wire; hide a shot only when
      // neither endpoint's cell is visible to the observer.
      const fog = latest?.layers[`${VISION_STATE_LAYER_ID}#${latest.observer}`] as
        ArrayLike<number> | undefined;
      for (const beam of collectBeams(delivered.events, now)) {
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
    // Drop expired beams in place and rebuild the buffers (fade by darkening).
    const beams = active.current;
    let write = 0;
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      if (b !== undefined && now - b.born < BEAM_LIFE_MS) {
        beams[write] = b;
        write += 1;
      }
    }
    beams.length = write;

    ensureLineCapacity(buf, beams.length * 2);
    segs.geometry = buf.geometry;
    const positions = buf.positions;
    const colors = buf.colors;
    if (colors === null) {
      return;
    }

    let count = 0;
    const color = tempColorRef.current;
    for (const beam of beams) {
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
    commitLineBuffer(buf, count * 2);
    segs.visible = count > 0;
  });

  return (
    <lineSegments ref={segsRef} visible={false} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent opacity={0.9} />
    </lineSegments>
  );
}
