// Road works (M3 E3): planned-but-unbuilt project cells as dim dashed
// outlines (the paved prefix already shows via the road layer), and live
// segments as small markers whose height grows with progress. Segments
// are pickable via client/pick.ts and cancel through the shared
// selection.cancel → CancelCommand flow; damaged ones get HP bars via
// the shared HpBars collector mounted in GameCanvas.
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient, SnapshotPair } from '../../../client/sim-client';
import type { ResolvedMap } from '../../../content/index';
import type { HpBarSink } from '../../../render/hp-bars';
import { InstanceWriter } from '../../../render/instance-writer';
import { terrainY } from '../../../render/world';
import { RoadWorksChannel, type RoadWorks } from '../protocol';
import { readChannel } from '../../../core/index';

const PLANNED_COLOR = '#b59a6a';
const PLANNED_OPACITY = 0.22;
const MARKER_COLOR = '#c9a35f';
const LIFT = 0.05;
const CAP = 2048;

export interface RoadWorksLayerProps {
  client: SimClient;
  map: ResolvedMap;
  heights: ArrayLike<number>;
}

function updateRoadWorksMeshes(
  cells: THREE.InstancedMesh,
  segs: THREE.InstancedMesh,
  works: RoadWorks | undefined,
  width: number,
  height: number,
  heights: ArrayLike<number>,
  writer: InstanceWriter,
): void {
  if (works === undefined) {
    cells.count = 0;
    segs.count = 0;
    return;
  }
  let n = 0;
  for (let p = 0; p < works.projects.offsets.length - 1 && n < CAP; p++) {
    const from = works.projects.offsets[p] ?? 0;
    const to = works.projects.offsets[p + 1] ?? from;
    const built = works.projects.built[p] ?? 0;
    for (let c = from + built; c < to && n < CAP; c++) {
      const cell = works.projects.cells[c] ?? 0;
      const x = (cell % width) + 0.5;
      const y = Math.floor(cell / width) + 0.5;
      writer.set(cells, n, x, terrainY(heights, width, height, x, y) + LIFT, y, 0.8, 1, 0.8);
      n += 1;
    }
  }
  cells.count = n;
  cells.instanceMatrix.needsUpdate = true;
  let m = 0;
  for (let i = 0; i < works.segments.handles.length && m < CAP; i++) {
    const x = works.segments.x[i] ?? 0;
    const y = works.segments.y[i] ?? 0;
    const h = 0.15 + ((works.segments.progressBp[i] ?? 0) / 10000) * 0.5;
    writer.set(segs, m, x, terrainY(heights, width, height, x, y) + LIFT + h / 2, y, 0.6, h, 0.6);
    m += 1;
  }
  segs.count = m;
  segs.instanceMatrix.needsUpdate = true;
}

export function RoadWorksLayer({ client, map, heights }: RoadWorksLayerProps) {
  const cellsRef = useRef<THREE.InstancedMesh>(null);
  const segsRef = useRef<THREE.InstancedMesh>(null);
  const writerRef = useRef(new InstanceWriter());

  useFrame(() => {
    const cells = cellsRef.current;
    const segs = segsRef.current;
    if (cells === null || segs === null) {
      return;
    }
    const works = readChannel(client.snapshots().latest, RoadWorksChannel) ?? undefined;
    const { width, height } = map.grid;
    updateRoadWorksMeshes(cells, segs, works, width, height, heights, writerRef.current);
  });

  return (
    <>
      <instancedMesh ref={cellsRef} args={[undefined, undefined, CAP]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} rotateX={-Math.PI / 2} />
        <meshBasicMaterial
          color={PLANNED_COLOR}
          transparent
          opacity={PLANNED_OPACITY}
          wireframe={false}
        />
      </instancedMesh>
      <instancedMesh ref={segsRef} args={[undefined, undefined, CAP]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={MARKER_COLOR} />
      </instancedMesh>
    </>
  );
}

// HP-bar collector for road segments (only damaged ones render).
export function roadWorksHpItems(pair: SnapshotPair, _alpha: number, sink: HpBarSink): void {
  const works = readChannel(pair.latest, RoadWorksChannel) ?? undefined;
  if (works === undefined) {
    return;
  }
  for (let i = 0; i < works.segments.handles.length; i++) {
    const bp = works.segments.hpBp[i] ?? 10000;
    if (bp >= 10000) {
      continue;
    }
    sink.push(works.segments.x[i] ?? 0, works.segments.y[i] ?? 0, 0.8, 0.7, bp);
  }
}
