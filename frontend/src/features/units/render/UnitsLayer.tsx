// Instanced unit rendering (M2 C3): reads snapshot pairs directly in
// useFrame (never React state), interpolates previous→latest positions by
// handle, and draws a flat ring under selected units. Instance capacity
// doubles when needed and never shrinks per frame.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import { pruneSelected, useSelectionStore } from '../../../client/selection-store';
import { useCameraStore } from '../../../client/camera-store';
import { useUiStore } from '../../../client/ui-store';
import {
  SalvageChannel,
  StructuresChannel,
  type ConstructionSalvage,
  type ConstructionStructures,
} from '../../construction/protocol';
import { interpAlpha } from '../../../render/interpolate';
import { useRenderTheme } from '../../../render/theme/index';
import { UnitInterpolator } from '../../../render/unit-pos';
import { terrainY } from '../../../render/world';
import { factionColorHex } from './colors';
import { buildRobotGeometry } from './robot-geometry';
import { createThemedUnitMaterial } from './themed-unit-material';
import { renderNowMs } from '../../../client/capture-mode';

const ATTACH_MATERIAL = 'material';
const SELECTED_BRIGHTEN = 1.7;
const UNIT_HEIGHT = 0.6;
const RING_SCALE_THEMED = 1.15;
const DEFAULT_LOW_ENERGY_BP = 2500;
const EMPTY_ENERGY_DIM = 0.42;
const EMPTY_ENERGY_COLOR = '#ff5c5c';
const LOW_ENERGY_COLOR = '#ffc14d';
const LOW_ENERGY_TINT = new THREE.Color(LOW_ENERGY_COLOR);
// Render-only unit shapes (content `visual`, M4); index order matches
// the instanced-mesh order in the JSX below.
type UnitShape = 'cylinder' | 'box' | 'cone' | 'sphere';
const SHAPE_INDEX: Readonly<Record<UnitShape, number>> = {
  cylinder: 0,
  box: 1,
  cone: 2,
  sphere: 3,
};
const SHAPE_KEYS = ['cylinder', 'box', 'cone', 'sphere'] as const;

interface UnitVisual {
  shape: UnitShape;
  scale: number;
}

export interface UnitsLayerProps {
  client: SimClient;
  heights: ArrayLike<number>;
  mapWidth: number;
  mapHeight: number;
  // Unit radius by content index (kind), from the content db.
  radii: readonly number[];
  // Render visual by content index (kind), from the content db.
  visuals: readonly UnitVisual[];
  lowThresholdBp?: number | undefined;
}

export function UnitsLayer({
  client,
  heights,
  mapWidth,
  mapHeight,
  radii,
  visuals,
  lowThresholdBp = DEFAULT_LOW_ENERGY_BP,
}: UnitsLayerProps) {
  const [capacity, setCapacity] = useState(256);
  const theme = useRenderTheme();
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const dimAttrsRef = useRef<(THREE.InstancedBufferAttribute | null)[]>([null, null, null, null]);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const energyPipRef = useRef<THREE.InstancedMesh>(null);
  const interp = useRef(new UnitInterpolator());
  const dummyRef = useRef(new THREE.Object3D());
  const colorRef = useRef(new THREE.Color());
  const pipColorRef = useRef(new THREE.Color());
  const validHandlesRef = useRef(new Set<number>());
  const countsRef = useRef([0, 0, 0, 0]);

  // Themed modes draw all four content shapes as the same small robot
  // silhouette (kind variety comes from per-kind scale, not primitives).
  // Each shape's InstancedMesh owns a clone: per-instance aDim attributes
  // live on the geometry, so they cannot be shared across meshes.
  const robotGeos = useMemo(() => {
    const base = buildRobotGeometry(theme.geometry.bevel);
    return [base, base.clone(), base.clone(), base.clone()];
  }, [theme]);
  useEffect(() => {
    return () => {
      for (const g of robotGeos) {
        g.dispose();
      }
    };
  }, [robotGeos]);
  const unitMat = useMemo(() => createThemedUnitMaterial(theme), [theme]);
  const infoUniformRef = useRef<{ value: number } | null>(null);
  useEffect(() => {
    infoUniformRef.current = unitMat.uniforms.info2d;
    return () => {
      unitMat.material.dispose();
    };
  }, [unitMat]);

  useFrame(() => {
    const meshes = meshRefs.current;
    const ring = ringRef.current;
    const energyPip = energyPipRef.current;
    if (meshes.some((m) => m === null)) {
      return;
    }
    const dummy = dummyRef.current;
    const color = colorRef.current;
    const pipColor = pipColorRef.current;
    const pair = client.snapshots();
    const latest = interp.current.update(pair);
    if (latest === null) {
      for (const mesh of meshes) {
        if (mesh !== null) {
          mesh.count = 0;
        }
      }
      if (ring !== null) {
        ring.count = 0;
      }
      if (energyPip !== null) {
        energyPip.count = 0;
      }
      return;
    }

    if (interp.current.prevSnapshotChanged) {
      // Drop handles that left the snapshot (units, structures, salvage —
      // selection holds every entity kind).
      const valid = validHandlesRef.current;
      valid.clear();
      for (let i = 0; i < latest.handles.length; i++) {
        valid.add(latest.handles[i] ?? 0);
      }
      const structures = pair.latest?.channels[StructuresChannel.id] as
        ConstructionStructures | undefined;
      if (structures !== undefined) {
        for (let i = 0; i < structures.handles.length; i++) {
          valid.add(structures.handles[i] ?? 0);
        }
      }
      const salvage = pair.latest?.channels[SalvageChannel.id] as ConstructionSalvage | undefined;
      if (salvage !== undefined) {
        for (let i = 0; i < salvage.handles.length; i++) {
          valid.add(salvage.handles[i] ?? 0);
        }
      }
      const store = useSelectionStore.getState();
      const pruned = pruneSelected(store.selected, valid);
      if (pruned.size !== store.selected.size) {
        useSelectionStore.setState({ selected: pruned });
      }
    }

    const alpha = interpAlpha(renderNowMs(), pair.receivedAt, pair.intervalMs);
    const n = latest.handles.length;
    if (n > capacity) {
      setCapacity(capacity * 2);
      return;
    }

    // Same source as selection: the live latest snapshot's observer (null
    // before the first snapshot, when no local faction is distinguished).
    const localFaction = pair.latest?.observer ?? null;
    const selected = useSelectionStore.getState().selected;
    const counts = countsRef.current;
    counts.fill(0);
    let rings = 0;
    let epips = 0;

    // Tactical info view: dim units toward dark silhouettes while the
    // camera is in tactical mode (shared info2d treatment).
    const camMode = useCameraStore.getState().mode;
    const info2dOn = theme.info2d && useUiStore.getState().info2d && camMode === 'tactical';
    if (infoUniformRef.current !== null) {
      const target = info2dOn ? 1 : 0;
      const u = infoUniformRef.current;
      u.value += (target - u.value) * 0.25;
      if (Math.abs(u.value - target) < 0.01) {
        u.value = target;
      }
    }
    for (let i = 0; i < n; i++) {
      const handle = latest.handles[i] ?? 0;
      const { x, y } = interp.current.interpolated(latest, i, alpha);
      const groundY = terrainY(heights, mapWidth, mapHeight, x, y);
      const kind = latest.kind[i] ?? 0;
      const radius = radii[kind] ?? 0.35;
      const visual = visuals[kind] ?? { shape: 'cylinder' as const, scale: 1 };
      const mesh = meshes[SHAPE_INDEX[visual.shape]];
      if (mesh === null || mesh === undefined) {
        continue;
      }
      const slot = counts[SHAPE_INDEX[visual.shape]] ?? 0;
      if (slot >= capacity) {
        continue;
      }

      // Robot geometry has its base at y=0 (unit space), so it sits on
      // the terrain; legacy primitives are centered and need the lift.
      const lift = 0;
      dummy.position.set(x, groundY + lift, y);
      dummy.scale.set(radius * 2 * visual.scale, visual.scale, radius * 2 * visual.scale);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(slot, dummy.matrix);
      counts[SHAPE_INDEX[visual.shape]] = slot + 1;

      const faction = latest.faction[i] ?? 0;
      // Themed: instanceColor is the faction accent slot color; body
      // tint/dimming travels through aDim.
      color.set(factionColorHex(faction, localFaction));
      let dim = 1;
      const energyBp = latest.energyBp[i] ?? 0xffff;
      if (energyBp === 0) {
        color.multiplyScalar(EMPTY_ENERGY_DIM);
        dim = EMPTY_ENERGY_DIM;
        if (energyPip !== null && epips < capacity) {
          dummy.position.set(x, groundY + UNIT_HEIGHT * visual.scale + 0.24, y);
          dummy.scale.set(1, 1, 1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          energyPip.setMatrixAt(epips, dummy.matrix);
          pipColor.set(EMPTY_ENERGY_COLOR);
          energyPip.setColorAt(epips, pipColor);
          epips += 1;
        }
      } else if (energyBp > 0 && energyBp < lowThresholdBp) {
        color.lerp(LOW_ENERGY_TINT, 0.35);
        dim = 0.8;
        if (energyPip !== null && epips < capacity) {
          dummy.position.set(x, groundY + UNIT_HEIGHT * visual.scale + 0.24, y);
          dummy.scale.set(1, 1, 1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          energyPip.setMatrixAt(epips, dummy.matrix);
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
        if (ring !== null && rings < capacity && !info2dOn) {
          dummy.position.set(x, groundY + 0.055, y);
          // Rings sit at ~1.6x unit radius — small enough to stay
          // per-unit, large enough to clear the body silhouette.
          // The ring geometry lies in the XY plane and is rotated flat
          // below, so local Y (not Z) carries the ground-plane scale.
          const ringScale = radius * RING_SCALE_THEMED;
          dummy.scale.set(ringScale, ringScale, 1);
          // The ring geometry lies in the XY plane; rotate it flat.
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.updateMatrix();
          ring.setMatrixAt(rings, dummy.matrix);
          rings += 1;
        }
      }
      mesh.setColorAt(slot, color);
      dimAttrsRef.current[SHAPE_INDEX[visual.shape]]?.setX(slot, dim);
    }
    for (let s = 0; s < meshes.length; s++) {
      const mesh = meshes[s];
      if (mesh === null || mesh === undefined) {
        continue;
      }
      mesh.count = counts[s] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = true;
      }
      const dimAttr = dimAttrsRef.current[s];
      if (dimAttr !== null && dimAttr !== undefined) {
        dimAttr.needsUpdate = true;
      }
    }
    if (ring !== null) {
      ring.count = rings;
      ring.instanceMatrix.needsUpdate = true;
    }
    if (energyPip !== null) {
      energyPip.count = epips;
      energyPip.instanceMatrix.needsUpdate = true;
      if (energyPip.instanceColor !== null) {
        energyPip.instanceColor.needsUpdate = true;
      }
    }
  });

  return (
    <group>
      {SHAPE_KEYS.map((shape, i) => (
        <instancedMesh
          key={`${shape}-${capacity}`}
          ref={(m) => {
            meshRefs.current[i] = m;
            if (m !== null) {
              const geo = robotGeos[i] ?? null;
              if (geo !== null) {
                m.geometry = geo;
                const attr = new THREE.InstancedBufferAttribute(
                  new Float32Array(capacity).fill(1),
                  1,
                );
                geo.setAttribute('aDim', attr);
                dimAttrsRef.current[i] = attr;
              }
            }
          }}
          args={[undefined, undefined, capacity]}
          frustumCulled={false}
          castShadow
        >
          <primitive object={unitMat.material} attach={ATTACH_MATERIAL} />
        </instancedMesh>
      ))}
      <instancedMesh
        key={`ring-${capacity}`}
        ref={ringRef}
        args={[undefined, undefined, capacity]}
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
        frustumCulled={false}
      >
        <octahedronGeometry args={[0.13, 0]} />
        <meshBasicMaterial />
      </instancedMesh>
    </group>
  );
}
