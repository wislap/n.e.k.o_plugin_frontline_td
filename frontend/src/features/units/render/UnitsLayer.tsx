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
import { bindOutline, createOutlineMaterial } from '../../../render/outline-material';
import { useRenderTheme } from '../../../render/theme/index';
import { UnitInterpolator } from '../../../render/unit-pos';
import { terrainY } from '../../../render/world';
import { factionColorHex } from './colors';
import { buildRobotGeometry } from './robot-geometry';
import { createThemedUnitMaterial } from './themed-unit-material';

const ATTACH_MATERIAL = 'material';
const SELECTED_BRIGHTEN = 1.7;
const UNIT_HEIGHT = 0.6;
const RING_SCALE = 1.5;
const RING_SCALE_THEMED = 1.6;
const DEFAULT_LOW_ENERGY_BP = 2500;
const EMPTY_ENERGY_DIM = 0.42;
const EMPTY_ENERGY_COLOR = '#ff5c5c';
const LOW_ENERGY_COLOR = '#ffc14d';
const LOW_ENERGY_TINT = new THREE.Color(LOW_ENERGY_COLOR);
const RING_COLOR = new THREE.Color('#ffffff');
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
  const themed = theme.id !== 'legacy';
  const outlineOn = useUiStore((s) => s.outline);
  const outlineMat = useMemo(
    () => (themed && outlineOn ? createOutlineMaterial(theme.outline) : null),
    [themed, outlineOn, theme],
  );
  useEffect(() => {
    return () => {
      outlineMat?.dispose();
    };
  }, [outlineMat]);
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const outlineRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
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
    if (!themed) {
      return null;
    }
    const base = buildRobotGeometry(theme.geometry.bevel);
    const geos = [base, base.clone(), base.clone(), base.clone()];
    return geos;
  }, [themed, theme]);
  useEffect(() => {
    return () => {
      if (robotGeos !== null) {
        for (const g of robotGeos) {
          g.dispose();
        }
      }
    };
  }, [robotGeos]);
  const unitMat = useMemo(() => (themed ? createThemedUnitMaterial(theme) : null), [themed, theme]);
  const infoUniformRef = useRef<{ value: number } | null>(null);
  useEffect(() => {
    infoUniformRef.current = unitMat?.uniforms.info2d ?? null;
    return () => {
      unitMat?.material.dispose();
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

    const alpha = interpAlpha(performance.now(), pair.receivedAt, pair.intervalMs);
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
    if (infoUniformRef.current !== null) {
      const camMode = useCameraStore.getState().mode;
      const target = theme.info2d && useUiStore.getState().info2d && camMode === 'tactical' ? 1 : 0;
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
      const lift = themed ? 0 : (UNIT_HEIGHT * visual.scale) / 2;
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
        if (ring !== null && rings < capacity) {
          dummy.position.set(x, groundY + 0.055, y);
          // Legacy rings are drawn at radius*1.5*2 (diameter scale);
          // themed rings sit at ~1.6x unit radius — small enough to stay
          // per-unit, large enough to clear the body silhouette so the
          // ellipse reads as flat on the ground at low camera pitch.
          const ringScale = themed ? radius * RING_SCALE_THEMED : radius * RING_SCALE * 2;
          dummy.scale.set(ringScale, 1, ringScale);
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
      bindOutline(outlineRefs.current[s] ?? null, mesh);
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
          key={`${shape}-${capacity}-${theme.id}`}
          ref={(m) => {
            meshRefs.current[i] = m;
            if (m !== null && robotGeos !== null) {
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
          {!themed && shape === 'cylinder' && (
            <cylinderGeometry args={[0.5, 0.5, UNIT_HEIGHT, 8]} />
          )}
          {!themed && shape === 'box' && <boxGeometry args={[1, UNIT_HEIGHT, 1]} />}
          {!themed && shape === 'cone' && <coneGeometry args={[0.5, UNIT_HEIGHT, 8]} />}
          {!themed && shape === 'sphere' && <sphereGeometry args={[0.5, 12, 10]} />}
          {unitMat === null ? (
            <meshLambertMaterial />
          ) : (
            <primitive object={unitMat.material} attach={ATTACH_MATERIAL} />
          )}
        </instancedMesh>
      ))}
      <instancedMesh
        key={`ring-${capacity}`}
        ref={ringRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
      >
        <ringGeometry args={themed ? [0.9, 1, 24] : [0.7, 1, 16]} />
        <meshBasicMaterial
          color={themed ? theme.markers.accent : RING_COLOR}
          side={THREE.DoubleSide}
          transparent
          opacity={0.9}
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
      {themed &&
        outlineMat !== null &&
        SHAPE_KEYS.map((shape, i) => (
          <instancedMesh
            key={`ol-${i}-${capacity}-${theme.id}`}
            ref={(m) => {
              outlineRefs.current[i] = m;
              if (m !== null && robotGeos !== null) {
                const geo = robotGeos[i] ?? null;
                if (geo !== null) {
                  m.geometry = geo;
                }
              }
            }}
            args={[undefined, undefined, capacity]}
            frustumCulled={false}
          >
            <primitive object={outlineMat} attach={ATTACH_MATERIAL} />
          </instancedMesh>
        ))}
    </group>
  );
}
