// Instanced unit rendering (M2 C3, M2C 1.2d/1.5c): reads snapshot pairs
// directly in useFrame (never React state), interpolates previous→latest
// positions by handle, draws a flat ring under selected units and energy
// pips above low/empty units, and dirty-gates buffer uploads when paused.
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Snapshot } from '../../../core/index';
import type { SnapshotPair } from '../../../client/sim-client';
import { useSelectionStore } from '../../../client/selection-store';
import { useUiStore } from '../../../client/ui-store';
import { cameraTransitionState } from '../../../render/camera-transition';
import { ChannelPositionInterpolator, interpAlpha } from '../../../client/interpolate';
import type { SceneLayerProps } from '../../../render/scene';
import { VISUAL } from '../../../render/theme/index';
import { DenseUnitsChannel, type DenseUnits } from '../protocol';
import { InstanceWriter } from '../../../render/instance-writer';
import { bindGeometry, useGpuResource } from '../../../render/use-gpu-resource';
import { terrainY } from '../../../client/world';
import { factionColorHex } from '../../../render/faction-colors';
import { buildRobotGeometry } from './robot-geometry';
import { createThemedUnitMaterial } from './themed-unit-material';
import { renderNowMs } from '../../../client/capture-mode';

const ATTACH_MATERIAL = 'material';
const SELECTED_BRIGHTEN = 1.7;
const UNIT_HEIGHT = 0.6;
const RING_SCALE_THEMED = 1.15;
const EMPTY_ENERGY_DIM = 0.42;
const EMPTY_ENERGY_COLOR = VISUAL.markers.danger;
const LOW_ENERGY_COLOR = VISUAL.markers.warn;
const LOW_ENERGY_TINT = new THREE.Color(LOW_ENERGY_COLOR);

interface UnitsCache {
  latest: Snapshot | null;
  prev: Snapshot | null;
  alpha: number;
  selected: ReadonlySet<number> | null;
  info2dOn: boolean;
  localFaction: number | null;
  heights: ArrayLike<number> | null;
  capacity: number;
  geo: THREE.BufferGeometry | null;
  unitCount: number;
  ringCount: number;
  epipCount: number;
}

function makeUnitsCache(): UnitsCache {
  return {
    latest: null,
    prev: null,
    alpha: -1,
    selected: null,
    info2dOn: false,
    localFaction: null,
    heights: null,
    capacity: 0,
    geo: null,
    unitCount: 0,
    ringCount: 0,
    epipCount: 0,
  };
}

function setInfo2dUniform(u: { value: number }, value: number): void {
  u.value = value;
}

function stepInfo2dUniform(u: { value: number }, target: number): void {
  if (u.value === target) {
    return;
  }
  u.value += (target - u.value) * 0.25;
  if (Math.abs(u.value - target) < 0.01) {
    u.value = target;
  }
}

function syncRingOpacity(ring: THREE.InstancedMesh, opacity: number): void {
  if (ring.material instanceof THREE.MeshBasicMaterial) {
    ring.material.opacity = opacity;
  }
}

function commitUnitMesh(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.visible = count > 0;
  if (count > 0) {
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, count * 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) {
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, count * 3);
      mesh.instanceColor.needsUpdate = true;
    }
  }
}

function ensureUnitDimAttr(
  mesh: THREE.InstancedMesh,
  dimAttrRef: { current: THREE.InstancedBufferAttribute | null },
  capacity: number,
): THREE.InstancedBufferAttribute {
  let attr = dimAttrRef.current;
  if (attr === null || attr.count !== capacity) {
    attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aDim', attr);
    dimAttrRef.current = attr;
  } else if (mesh.geometry.getAttribute('aDim') !== attr) {
    mesh.geometry.setAttribute('aDim', attr);
  }
  return attr;
}

function updateUnitsFrame(
  mesh: THREE.InstancedMesh,
  ring: THREE.InstancedMesh,
  energyPip: THREE.InstancedMesh,
  robotGeo: THREE.BufferGeometry,
  dimAttrRef: { current: THREE.InstancedBufferAttribute | null },
  infoUniform: { value: number },
  info2dEnabled: boolean,
  pair: SnapshotPair,
  interp: ChannelPositionInterpolator<DenseUnits>,
  radii: readonly number[],
  scales: readonly number[],
  lowThresholdBp: number,
  heights: ArrayLike<number>,
  mapWidth: number,
  mapHeight: number,
  capacity: number,
  setCapacity: (next: number) => void,
  writer: InstanceWriter,
  color: THREE.Color,
  pipColor: THREE.Color,
  cache: UnitsCache,
): void {
  bindGeometry(mesh, robotGeo);
  const dimAttr = ensureUnitDimAttr(mesh, dimAttrRef, capacity);

  const blend = cameraTransitionState.blend;
  const info2dActive = info2dEnabled && useUiStore.getState().info2d;
  if (blend > 0 && blend < 1) {
    setInfo2dUniform(infoUniform, info2dActive ? blend : 0);
  } else {
    stepInfo2dUniform(infoUniform, info2dActive && blend >= 1 ? 1 : 0);
  }
  syncRingOpacity(ring, 0.5 * (info2dActive ? 1 - blend : 1));
  const info2dOn = info2dActive && blend >= 0.98;

  const latest = interp.update(pair);
  if (latest === null) {
    mesh.count = 0;
    mesh.visible = false;
    ring.count = 0;
    ring.visible = false;
    energyPip.count = 0;
    energyPip.visible = false;
    cache.latest = null;
    cache.prev = null;
    cache.alpha = -1;
    cache.unitCount = 0;
    cache.ringCount = 0;
    cache.epipCount = 0;
    return;
  }

  const n = latest.handles.length;
  if (n > capacity) {
    mesh.visible = false;
    ring.visible = false;
    energyPip.visible = false;
    setCapacity(Math.max(capacity * 2, n));
    return;
  }

  const localFaction = pair.latest?.observer ?? null;
  const selected = useSelectionStore.getState().selected;

  if (n === 0) {
    if (
      cache.capacity === capacity &&
      cache.geo === mesh.geometry &&
      cache.unitCount === 0 &&
      cache.ringCount === 0 &&
      cache.epipCount === 0
    ) {
      mesh.visible = false;
      ring.visible = false;
      energyPip.visible = false;
      cache.latest = pair.latest;
      cache.prev = pair.previous;
      cache.alpha = 1;
      return;
    }
    commitUnitMesh(mesh, 0);
    commitUnitMesh(ring, 0);
    commitUnitMesh(energyPip, 0);
    cache.latest = pair.latest;
    cache.prev = pair.previous;
    cache.alpha = 1;
    cache.selected = selected;
    cache.info2dOn = info2dOn;
    cache.localFaction = localFaction;
    cache.heights = heights;
    cache.capacity = capacity;
    cache.geo = mesh.geometry;
    cache.unitCount = 0;
    cache.ringCount = 0;
    cache.epipCount = 0;
    return;
  }

  const alpha = interpAlpha(renderNowMs(), pair.receivedAt, pair.intervalMs);
  if (
    cache.latest === pair.latest &&
    cache.prev === pair.previous &&
    cache.alpha === 1 &&
    alpha === 1 &&
    cache.selected === selected &&
    cache.info2dOn === info2dOn &&
    cache.localFaction === localFaction &&
    cache.heights === heights &&
    cache.capacity === capacity &&
    cache.geo === mesh.geometry
  ) {
    mesh.visible = cache.unitCount > 0;
    ring.visible = cache.ringCount > 0;
    energyPip.visible = cache.epipCount > 0;
    return;
  }

  let rings = 0;
  let epips = 0;

  for (let i = 0; i < n; i++) {
    const handle = latest.handles[i] ?? 0;
    const { x, y } = interp.interpolated(latest, i, alpha);
    const groundY = terrainY(heights, mapWidth, mapHeight, x, y);
    const kind = latest.kind[i] ?? 0;
    const radius = radii[kind] ?? 0.35;
    const scale = scales[kind] ?? 1;

    writer.set(mesh, i, x, groundY, y, radius * 2 * scale, scale, radius * 2 * scale);

    const faction = latest.faction[i] ?? 0;
    // Themed: instanceColor is the faction accent slot color; body
    // tint/dimming travels through aDim.
    color.set(factionColorHex(faction, localFaction));
    let dim = 1;
    const energyBp = latest.energyBp[i] ?? 0xffff;
    if (energyBp === 0) {
      color.multiplyScalar(EMPTY_ENERGY_DIM);
      dim = EMPTY_ENERGY_DIM;
      if (epips < capacity) {
        writer.set(energyPip, epips, x, groundY + UNIT_HEIGHT * scale + 0.24, y);
        pipColor.set(EMPTY_ENERGY_COLOR);
        energyPip.setColorAt(epips, pipColor);
        epips += 1;
      }
    } else if (energyBp > 0 && energyBp < lowThresholdBp) {
      color.lerp(LOW_ENERGY_TINT, 0.35);
      dim = 0.8;
      if (epips < capacity) {
        writer.set(energyPip, epips, x, groundY + UNIT_HEIGHT * scale + 0.24, y);
        pipColor.set(LOW_ENERGY_COLOR);
        energyPip.setColorAt(epips, pipColor);
        epips += 1;
      }
    }
    if (selected.has(handle)) {
      color.multiplyScalar(SELECTED_BRIGHTEN);
      dim = Math.min(SELECTED_BRIGHTEN, dim * SELECTED_BRIGHTEN);
      // In the tactical info view the group bracket carries selection;
      // per-unit rings would stack into unreadable ellipses.
      if (rings < capacity && !info2dOn) {
        // Rings sit at ~1.6x unit radius — small enough to stay
        // per-unit, large enough to clear the body silhouette.
        const ringScale = radius * RING_SCALE_THEMED;
        writer.setFlat(ring, rings, x, groundY + 0.055, y, ringScale, ringScale);
        rings += 1;
      }
    }
    mesh.setColorAt(i, color);
    dimAttr.setX(i, dim);
  }

  commitUnitMesh(mesh, n);
  dimAttr.clearUpdateRanges();
  dimAttr.addUpdateRange(0, n);
  dimAttr.needsUpdate = true;
  commitUnitMesh(ring, rings);
  commitUnitMesh(energyPip, epips);

  cache.latest = pair.latest;
  cache.prev = pair.previous;
  cache.alpha = alpha;
  cache.selected = selected;
  cache.info2dOn = info2dOn;
  cache.localFaction = localFaction;
  cache.heights = heights;
  cache.capacity = capacity;
  cache.geo = mesh.geometry;
  cache.unitCount = n;
  cache.ringCount = rings;
  cache.epipCount = epips;
}

export function UnitsLayer({ ctx }: SceneLayerProps) {
  const { client, db, heights } = ctx;
  const { width: mapWidth, height: mapHeight } = ctx.map.grid;
  const radii = useMemo(() => db.units.list.map((u) => u.radius), [db]);
  const scales = useMemo(() => db.units.list.map((u) => u.visual.scale), [db]);
  const lowThresholdBp = db.logistics.lowThresholdBp;
  const [capacity, setCapacity] = useState(256);
  const theme = VISUAL;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dimAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const energyPipRef = useRef<THREE.InstancedMesh>(null);
  const interp = useRef(new ChannelPositionInterpolator(DenseUnitsChannel));
  const writerRef = useRef(new InstanceWriter());
  const colorRef = useRef(new THREE.Color());
  const pipColorRef = useRef(new THREE.Color());
  const cacheRef = useRef<UnitsCache>(makeUnitsCache());

  // Themed modes draw all unit kinds with the shared robot silhouette
  // (per-kind size comes from `visual.scale` in the instance matrix).
  const robotGeo = useMemo(() => buildRobotGeometry(theme.geometry.bevel), [theme.geometry.bevel]);
  useGpuResource(robotGeo);
  const unitMat = useMemo(() => createThemedUnitMaterial(theme), [theme]);
  useGpuResource(unitMat.material);

  useFrame(() => {
    const mesh = meshRef.current;
    const ring = ringRef.current;
    const energyPip = energyPipRef.current;
    if (mesh === null || ring === null || energyPip === null) {
      return;
    }
    updateUnitsFrame(
      mesh,
      ring,
      energyPip,
      robotGeo,
      dimAttrRef,
      unitMat.uniforms.info2d,
      theme.info2d,
      client.snapshots(),
      interp.current,
      radii,
      scales,
      lowThresholdBp,
      heights,
      mapWidth,
      mapHeight,
      capacity,
      setCapacity,
      writerRef.current,
      colorRef.current,
      pipColorRef.current,
      cacheRef.current,
    );
  });

  return (
    <group>
      <instancedMesh
        key={`units-${capacity}`}
        ref={meshRef}
        args={[robotGeo, undefined, capacity]}
        visible={false}
        frustumCulled={false}
        castShadow
      >
        <primitive object={unitMat.material} attach={ATTACH_MATERIAL} />
      </instancedMesh>
      <instancedMesh
        key={`ring-${capacity}`}
        ref={ringRef}
        args={[undefined, undefined, capacity]}
        visible={false}
        frustumCulled={false}
      >
        <ringGeometry args={[0.93, 1, 24]} />
        <meshBasicMaterial
          color={theme.markers.accent}
          side={THREE.DoubleSide}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </instancedMesh>
      <instancedMesh
        key={`epip-${capacity}`}
        ref={energyPipRef}
        args={[undefined, undefined, capacity]}
        visible={false}
        frustumCulled={false}
      >
        <octahedronGeometry args={[0.13, 0]} />
        <meshBasicMaterial />
      </instancedMesh>
    </group>
  );
}
