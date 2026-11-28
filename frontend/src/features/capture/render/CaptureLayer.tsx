// Capture-point overlay (M5 batch D, M2B 1.2c): a base ring and a
// progress arc per capture point rendered via two GPU anti-aliased
// DashRingMaterial InstancedMeshes, with snapshot/heights dirty-gating
// and per-frame pulse only for contested points.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SceneLayerProps } from '../../../render/scene';
import { createDashRingMaterial } from '../../../render/dash-ring';
import { InstanceWriter } from '../../../render/instance-writer';
import { VISUAL } from '../../../render/theme/index';
import { useGpuResource } from '../../../render/use-gpu-resource';
import { factionColorHex } from '../../../render/faction-colors';
import { terrainY } from '../../../client/world';
import { CapturePointsChannel, type CapturePoints } from '../protocol';
import { renderNowMs } from '../../../client/capture-mode';
import { readChannel } from '../../../core/index';

const RING_COLOR = VISUAL.markers.neutral;
const CONTESTED_COLOR = new THREE.Color(VISUAL.markers.warn);
const RING_SEGMENTS = 64;
const MAX_POINTS = 64;
const LIFT = 0.06;

interface CaptureCache {
  points: CapturePoints | undefined;
  observer: number | null;
  heights: ArrayLike<number> | null;
  baseCount: number;
  arcCount: number;
  contestedSlots: number[];
}

function updateCaptureOverlay(
  baseRings: THREE.InstancedMesh,
  arcRings: THREE.InstancedMesh,
  points: CapturePoints | undefined,
  observer: number | null,
  heights: ArrayLike<number>,
  mapWidth: number,
  mapHeight: number,
  writer: InstanceWriter,
  color: THREE.Color,
  cache: CaptureCache,
): void {
  if (points === undefined) {
    baseRings.count = 0;
    baseRings.visible = false;
    arcRings.count = 0;
    arcRings.visible = false;
    cache.points = undefined;
    cache.observer = observer;
    cache.heights = heights;
    cache.baseCount = 0;
    cache.arcCount = 0;
    cache.contestedSlots.length = 0;
    return;
  }

  if (cache.points === points && cache.observer === observer && cache.heights === heights) {
    baseRings.visible = cache.baseCount > 0;
    arcRings.visible = cache.arcCount > 0;
    if (cache.contestedSlots.length > 0) {
      const pulse = 0.7 + 0.3 * Math.sin(renderNowMs() / 200);
      color.copy(CONTESTED_COLOR).multiplyScalar(pulse);
      for (const slot of cache.contestedSlots) {
        arcRings.setColorAt(slot, color);
      }
      if (arcRings.instanceColor !== null) {
        arcRings.instanceColor.needsUpdate = true;
      }
    }
    return;
  }

  const aArc = arcRings.geometry.getAttribute('aArc');
  if (!(aArc instanceof THREE.InstancedBufferAttribute)) {
    return;
  }

  let baseCount = 0;
  let arcCount = 0;
  cache.contestedSlots.length = 0;
  const pulse = 0.7 + 0.3 * Math.sin(renderNowMs() / 200);
  const limit = Math.min(points.handles.length, MAX_POINTS);

  for (let i = 0; i < limit; i++) {
    const cx = points.x[i] ?? 0;
    const cy = points.y[i] ?? 0;
    const radius = points.radius[i] ?? 0;
    const y = terrainY(heights, mapWidth, mapHeight, cx, cy) + LIFT;
    writer.setFlat(baseRings, baseCount, cx, y, cy, radius, radius);
    baseCount += 1;

    const frac = (points.progressBp[i] ?? 0) / 10000;
    if (frac > 0) {
      writer.setFlat(arcRings, arcCount, cx, y + 0.01, cy, radius, radius);
      aArc.setXY(arcCount, 0, Math.min(1, frac) * Math.PI * 2);
      const contested = (points.contested[i] ?? 0) !== 0;
      if (contested) {
        color.copy(CONTESTED_COLOR).multiplyScalar(pulse);
        cache.contestedSlots.push(arcCount);
      } else {
        color.set(factionColorHex(points.owner[i] ?? 0, observer));
      }
      arcRings.setColorAt(arcCount, color);
      arcCount += 1;
    }
  }

  baseRings.count = baseCount;
  baseRings.visible = baseCount > 0;
  if (baseCount > 0) {
    baseRings.instanceMatrix.needsUpdate = true;
  }

  arcRings.count = arcCount;
  arcRings.visible = arcCount > 0;
  if (arcCount > 0) {
    arcRings.instanceMatrix.needsUpdate = true;
    aArc.needsUpdate = true;
    if (arcRings.instanceColor !== null) {
      arcRings.instanceColor.needsUpdate = true;
    }
  }

  cache.points = points;
  cache.observer = observer;
  cache.heights = heights;
  cache.baseCount = baseCount;
  cache.arcCount = arcCount;
}

export function CaptureLayer({ ctx }: SceneLayerProps) {
  const { client, heights } = ctx;
  const { width: mapWidth, height: mapHeight } = ctx.map.grid;

  const ringGeo = useMemo(() => new THREE.RingGeometry(0.8, 1, RING_SEGMENTS), []);
  useGpuResource(ringGeo);

  const arcGeo = useMemo(() => {
    const geo = new THREE.RingGeometry(0.8, 1, RING_SEGMENTS);
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POINTS * 2), 2);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aArc', attr);
    return geo;
  }, []);
  useGpuResource(arcGeo);

  const baseMat = useMemo(
    () => createDashRingMaterial(RING_COLOR, { dash: 0, width: 0.06, opacity: 0.9 }),
    [],
  );
  useGpuResource(baseMat);

  const arcMat = useMemo(
    () =>
      createDashRingMaterial('#ffffff', {
        dash: 0,
        width: 0.16,
        opacity: 0.9,
        instancedArc: true,
      }),
    [],
  );
  useGpuResource(arcMat);

  const baseRingsRef = useRef<THREE.InstancedMesh>(null);
  const arcRingsRef = useRef<THREE.InstancedMesh>(null);
  const writerRef = useRef<InstanceWriter | null>(null);
  const tempColorRef = useRef(new THREE.Color());
  const cacheRef = useRef<CaptureCache>({
    points: undefined,
    observer: null,
    heights: null,
    baseCount: 0,
    arcCount: 0,
    contestedSlots: [],
  });

  useFrame(() => {
    const baseRings = baseRingsRef.current;
    const arcRings = arcRingsRef.current;
    if (baseRings === null || arcRings === null) {
      return;
    }
    writerRef.current ??= new InstanceWriter();
    const latest = client.snapshots().latest;
    const points = readChannel(latest, CapturePointsChannel) ?? undefined;
    const observer = latest?.observer ?? null;
    updateCaptureOverlay(
      baseRings,
      arcRings,
      points,
      observer,
      heights,
      mapWidth,
      mapHeight,
      writerRef.current,
      tempColorRef.current,
      cacheRef.current,
    );
  });

  return (
    <>
      <instancedMesh
        ref={baseRingsRef}
        args={[ringGeo, baseMat, MAX_POINTS]}
        visible={false}
        renderOrder={4}
        frustumCulled={false}
      />
      <instancedMesh
        ref={arcRingsRef}
        args={[arcGeo, arcMat, MAX_POINTS]}
        visible={false}
        renderOrder={4}
        frustumCulled={false}
      />
    </>
  );
}
