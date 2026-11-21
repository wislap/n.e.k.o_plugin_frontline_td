// Shared HP-bar renderer (M3 D): instanced camera-facing quads over
// damaged entities. Callers supply a collector that reads the latest
// snapshot channels each frame; units and structures use the same layer.
import { useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { SnapshotPair } from '../client/sim-client';
import type { SimClient } from '../client/sim-client';
import { interpAlpha } from './interpolate';
import { terrainY } from './world';

export interface HpBarSink {
  reset(): void;
  push(x: number, y: number, top: number, w: number, bp: number): void;
}

export type HpBarCollector = (pair: SnapshotPair, alpha: number, sink: HpBarSink) => void;

interface HpBarItem {
  // Map coordinates of the entity centre.
  x: number;
  y: number;
  // Scene height above the terrain surface (top of the entity + offset).
  top: number;
  // Bar width in cells.
  w: number;
  // hp fraction bp (0..10000).
  bp: number;
}

class PooledHpBarSink implements HpBarSink {
  readonly items: HpBarItem[] = [];
  count = 0;

  reset(): void {
    this.count = 0;
  }

  push(x: number, y: number, top: number, w: number, bp: number): void {
    if (bp >= 10000) {
      return;
    }
    let slot = this.items[this.count];
    if (slot === undefined) {
      slot = { x, y, top, w, bp };
      this.items.push(slot);
    } else {
      slot.x = x;
      slot.y = y;
      slot.top = top;
      slot.w = w;
      slot.bp = bp;
    }
    this.count += 1;
  }
}

const BAR_BG = '#1a1a1a';
const BAR_HEIGHT = 0.12;
const BAR_OFFSET = 0.25;

function writeHpBarInstances(
  bg: THREE.InstancedMesh,
  fg: THREE.InstancedMesh,
  sink: PooledHpBarSink,
  heights: ArrayLike<number>,
  mapWidth: number,
  mapHeight: number,
  cameraQuat: THREE.Quaternion,
  dummy: THREE.Object3D,
  color: THREE.Color,
  offset: THREE.Vector3,
): void {
  const count = sink.count;
  for (let i = 0; i < count; i++) {
    const item = sink.items[i];
    if (item === undefined) {
      continue;
    }
    const y = terrainY(heights, mapWidth, mapHeight, item.x, item.y) + item.top + BAR_OFFSET;
    dummy.position.set(item.x, y, item.y);
    dummy.quaternion.copy(cameraQuat);
    // Background: full-width dark bar.
    dummy.scale.set(item.w, 1, 1);
    dummy.updateMatrix();
    bg.setMatrixAt(i, dummy.matrix);
    // Foreground: width scaled by hp, left-aligned against the bg edge.
    const bp = Math.max(0, Math.min(10000, item.bp)) / 10000;
    const fw = item.w * bp;
    // Shift left in the bar's local X so the filled part hugs the edge.
    offset.set(-(item.w - fw) / 2, 0, 0.001);
    offset.applyQuaternion(cameraQuat);
    dummy.position.set(item.x + offset.x, y + offset.y, item.y + offset.z);
    dummy.scale.set(Math.max(fw, 0.001), 1, 1);
    dummy.updateMatrix();
    fg.setMatrixAt(i, dummy.matrix);
    color.setRGB(1 - bp, bp, 0.15);
    fg.setColorAt(i, color);
  }
  bg.count = count;
  fg.count = count;
  bg.instanceMatrix.needsUpdate = true;
  fg.instanceMatrix.needsUpdate = true;
  if (fg.instanceColor !== null) {
    fg.instanceColor.needsUpdate = true;
  }
}

export function HpBars({
  client,
  heights,
  mapWidth,
  mapHeight,
  collect,
}: {
  client: SimClient;
  heights: ArrayLike<number>;
  mapWidth: number;
  mapHeight: number;
  // Collects damaged entities from the snapshot pair each frame.
  collect: HpBarCollector;
}) {
  const camera = useThree((s) => s.camera);
  const [capacity, setCapacity] = useState(64);
  const bgRef = useRef<THREE.InstancedMesh>(null);
  const fgRef = useRef<THREE.InstancedMesh>(null);
  const dummyRef = useRef(new THREE.Object3D());
  const colorRef = useRef(new THREE.Color());
  const offsetRef = useRef(new THREE.Vector3());
  const sinkRef = useRef(new PooledHpBarSink());

  useFrame(() => {
    const bg = bgRef.current;
    const fg = fgRef.current;
    if (bg === null || fg === null) {
      return;
    }
    const pair = client.snapshots();
    const alpha = interpAlpha(performance.now(), pair.receivedAt, pair.intervalMs);
    const sink = sinkRef.current;
    sink.reset();
    collect(pair, alpha, sink);
    if (sink.count > capacity) {
      let next = capacity;
      while (next < sink.count) {
        next *= 2;
      }
      setCapacity(next);
      return;
    }
    writeHpBarInstances(
      bg,
      fg,
      sink,
      heights,
      mapWidth,
      mapHeight,
      camera.quaternion,
      dummyRef.current,
      colorRef.current,
      offsetRef.current,
    );
  });

  return (
    <group>
      <instancedMesh
        key={`bg-${capacity}`}
        ref={bgRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
      >
        <planeGeometry args={[1, BAR_HEIGHT]} />
        <meshBasicMaterial color={BAR_BG} transparent opacity={0.8} depthTest={false} />
      </instancedMesh>
      <instancedMesh
        key={`fg-${capacity}`}
        ref={fgRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
      >
        <planeGeometry args={[1, BAR_HEIGHT * 0.7]} />
        <meshBasicMaterial transparent opacity={0.95} depthTest={false} />
      </instancedMesh>
    </group>
  );
}
