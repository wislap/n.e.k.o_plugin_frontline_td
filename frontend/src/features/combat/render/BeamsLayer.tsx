// Shot tracers (M3 D): line segments from combat.shot events, fading
// over ~150 ms. Events are last-tick only; collectBeams dedupes by
// snapshot tick so each burst is appended once.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import { terrainY } from '../../../render/world';
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
  const geom = useMemo(() => new THREE.BufferGeometry(), []);
  const positionsRef = useRef<Float32Array | null>(null);
  const colorsRef = useRef<Float32Array | null>(null);
  const active = useRef<Beam[]>([]);
  const lastTick = useRef(-1);
  const segsRef = useRef<THREE.LineSegments>(null);

  useFrame(() => {
    const segs = segsRef.current;
    const positions = (positionsRef.current ??= new Float32Array(MAX_BEAMS * 6));
    const colors = (colorsRef.current ??= new Float32Array(MAX_BEAMS * 6));
    if (segs === null) {
      return;
    }
    const now = performance.now();
    const latest = client.snapshots().latest;
    if (latest !== null) {
      const collected = collectBeams(latest.events, latest.tick, lastTick.current, now);
      lastTick.current = collected.tick;
      active.current.push(...collected.beams);
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
    geom.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, count * 6), 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors.slice(0, count * 6), 3));
    geom.computeBoundingSphere();
    segs.visible = count > 0;
  });

  return (
    <lineSegments ref={segsRef} geometry={geom} visible={false}>
      <lineBasicMaterial vertexColors transparent opacity={0.9} />
    </lineSegments>
  );
}
