// Instanced unit rendering (M2 C3): reads snapshot pairs directly in
// useFrame (never React state), interpolates previous→latest positions by
// handle, and draws a flat ring under selected units. Instance capacity
// doubles when needed and never shrinks per frame.
import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import { pruneSelected, useSelectionStore } from '../../../client/selection-store';
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
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const energyPipRef = useRef<THREE.InstancedMesh>(null);
  const bandRef = useRef<THREE.InstancedMesh>(null);
  const eyeRef = useRef<THREE.InstancedMesh>(null);
  const interp = useRef(new UnitInterpolator());
  const dummyRef = useRef(new THREE.Object3D());
  const colorRef = useRef(new THREE.Color());
  const pipColorRef = useRef(new THREE.Color());
  const validHandlesRef = useRef(new Set<number>());
  const countsRef = useRef([0, 0, 0, 0]);

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
    const band = bandRef.current;
    const eye = eyeRef.current;
    const bodyColor = theme.materials.unitBody;
    const eyeIsFaction = theme.materials.unitEmissive === 'faction';
    const emissiveBoost = theme.materials.emissiveBoost;
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
      if (band !== null) {
        band.count = 0;
      }
      if (eye !== null) {
        eye.count = 0;
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
    let accents = 0;
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

      dummy.position.set(x, groundY + (UNIT_HEIGHT * visual.scale) / 2, y);
      dummy.scale.set(radius * 2 * visual.scale, visual.scale, radius * 2 * visual.scale);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(slot, dummy.matrix);
      counts[SHAPE_INDEX[visual.shape]] = slot + 1;

      const faction = latest.faction[i] ?? 0;
      color.set(themed ? bodyColor : factionColorHex(faction, localFaction));
      const energyBp = latest.energyBp[i] ?? 0xffff;
      if (energyBp === 0) {
        color.multiplyScalar(EMPTY_ENERGY_DIM);
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
      if (themed && band !== null && eye !== null && accents < capacity) {
        // Faction accent band around the body + small emissive top light.
        dummy.position.set(x, groundY + UNIT_HEIGHT * visual.scale * 0.62, y);
        dummy.scale.set(radius * 2.4 * visual.scale, visual.scale, radius * 2.4 * visual.scale);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        band.setMatrixAt(accents, dummy.matrix);
        pipColor.set(factionColorHex(faction, localFaction));
        band.setColorAt(accents, pipColor);
        dummy.position.set(x, groundY + UNIT_HEIGHT * visual.scale + 0.08 + radius * 0.3, y);
        dummy.scale.set(radius, radius, radius);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        eye.setMatrixAt(accents, dummy.matrix);
        if (eyeIsFaction) {
          pipColor.set(factionColorHex(faction, localFaction));
        } else {
          pipColor.set(theme.materials.unitEmissive);
        }
        pipColor.multiplyScalar(emissiveBoost);
        eye.setColorAt(accents, pipColor);
        accents += 1;
      }
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
    if (band !== null) {
      band.count = accents;
      band.instanceMatrix.needsUpdate = true;
      if (band.instanceColor !== null) {
        band.instanceColor.needsUpdate = true;
      }
    }
    if (eye !== null) {
      eye.count = accents;
      eye.instanceMatrix.needsUpdate = true;
      if (eye.instanceColor !== null) {
        eye.instanceColor.needsUpdate = true;
      }
    }
  });

  return (
    <group>
      <instancedMesh
        key={`cyl-${capacity}-${theme.id}`}
        ref={(m) => {
          meshRefs.current[0] = m;
        }}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
        castShadow
      >
        <cylinderGeometry args={[0.5, 0.5, UNIT_HEIGHT, 8]} />
        {themed ? (
          <meshStandardMaterial
            roughness={theme.materials.roughness}
            metalness={theme.materials.metalness}
          />
        ) : (
          <meshLambertMaterial />
        )}
      </instancedMesh>
      <instancedMesh
        key={`box-${capacity}-${theme.id}`}
        ref={(m) => {
          meshRefs.current[1] = m;
        }}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
        castShadow
      >
        <boxGeometry args={[1, UNIT_HEIGHT, 1]} />
        {themed ? (
          <meshStandardMaterial
            roughness={theme.materials.roughness}
            metalness={theme.materials.metalness}
          />
        ) : (
          <meshLambertMaterial />
        )}
      </instancedMesh>
      <instancedMesh
        key={`cone-${capacity}-${theme.id}`}
        ref={(m) => {
          meshRefs.current[2] = m;
        }}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
        castShadow
      >
        <coneGeometry args={[0.5, UNIT_HEIGHT, 8]} />
        {themed ? (
          <meshStandardMaterial
            roughness={theme.materials.roughness}
            metalness={theme.materials.metalness}
          />
        ) : (
          <meshLambertMaterial />
        )}
      </instancedMesh>
      <instancedMesh
        key={`sph-${capacity}-${theme.id}`}
        ref={(m) => {
          meshRefs.current[3] = m;
        }}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
        castShadow
      >
        <sphereGeometry args={[0.5, 12, 10]} />
        {themed ? (
          <meshStandardMaterial
            roughness={theme.materials.roughness}
            metalness={theme.materials.metalness}
          />
        ) : (
          <meshLambertMaterial />
        )}
      </instancedMesh>
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
      {themed && (
        <instancedMesh
          key={`band-${capacity}`}
          ref={bandRef}
          args={[undefined, undefined, capacity]}
          frustumCulled={false}
        >
          <cylinderGeometry args={[0.5, 0.5, UNIT_HEIGHT * 0.22, 10, 1, true]} />
          <meshStandardMaterial
            roughness={theme.materials.roughness}
            metalness={theme.materials.metalness}
            side={THREE.DoubleSide}
          />
        </instancedMesh>
      )}
      {themed && (
        <instancedMesh
          key={`eye-${capacity}`}
          ref={eyeRef}
          args={[undefined, undefined, capacity]}
          frustumCulled={false}
        >
          <octahedronGeometry args={[0.16, 0]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      )}
    </group>
  );
}
