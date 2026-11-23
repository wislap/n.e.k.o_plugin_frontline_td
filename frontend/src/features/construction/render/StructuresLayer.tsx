// Structure/salvage rendering (ADR 0050): procedural multi-part
// silhouettes with vertex shading, roof tactical glyph badges (camera
// mode-responsive opacity), separated blueprint vs pulsing-waiting layers,
// rising construction sites, darkened demolishing structures, low-rubble
// ruins, and salvage crates. Reads snapshot channels in useFrame; no
// per-tick state in React. GPU assets and frame helpers live in
// structure-gpu.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { effectiveSpectatePitchDeg } from '../../../client/camera-math';
import { useCameraStore } from '../../../client/camera-store';
import type { SimClient } from '../../../client/sim-client';
import { useUiStore } from '../../../client/ui-store';
import type { ContentDb } from '../../../content/index';
import { useRenderTheme } from '../../../render/theme/index';
import { terrainY } from '../../../render/world';
import { factionColorHex } from '../../units/render/index';
import { STRUCTURE_SILHOUETTES, type StructureSilhouette } from '../content';
import {
  SalvageChannel,
  STATE_BLUEPRINT,
  STATE_DEMOLISHING,
  STATE_OPERATIONAL,
  STATE_RUIN,
  STATE_SITE,
  STATE_WAITING,
  StructuresChannel,
  type ConstructionSalvage,
  type ConstructionStructures,
} from '../protocol';
import { createPadMaterial } from './pad-material';
import { createThemedStructureMaterial } from './themed-structure-material';
import { ACTIVE_STRUCTURE_GLYPHS, disposeGlyphMaterials } from './structure-glyphs';
import {
  AMBER_COLOR,
  bindGpuToMeshes,
  commitMeshBuffers,
  DEMOLISH_DARKEN,
  ensureGpuAssets,
  makeGlyphCounts,
  makeSilhouetteCounts,
  OUTPOST_TINT,
  resetGlyphCounts,
  resetSilhouetteCounts,
  resolveGlyphTint,
  RUIN_COLOR,
  RUIN_HEIGHT,
  SALVAGE_COLOR,
  SALVAGE_SIZE,
  setWaitingOpacity,
  SITE_DARKEN,
  STATUS_COLOR,
  structureKindHeight,
  updateGlyphOpacity,
  type ActiveGlyph,
  type StructureGpuAssets,
} from './structure-gpu';
import { disposeSilhouetteGeometries } from './structure-geometries';

const ATTACH_MATERIAL = 'material';

export interface StructuresLayerProps {
  client: SimClient;
  db: ContentDb;
  heights: ArrayLike<number>;
  mapWidth: number;
  mapHeight: number;
  isHostile?: ((observer: number, faction: number) => boolean) | undefined;
}

export function StructuresLayer({
  client,
  db,
  heights,
  mapWidth,
  mapHeight,
  isHostile,
}: StructuresLayerProps) {
  const [capacity, setCapacity] = useState(64);
  const theme = useRenderTheme();
  const silRefs = useRef<Partial<Record<StructureSilhouette, THREE.InstancedMesh | null>>>({});
  const glyphRefs = useRef<Partial<Record<ActiveGlyph, THREE.InstancedMesh | null>>>({});
  const blueprintRef = useRef<THREE.InstancedMesh>(null);
  const waitingRef = useRef<THREE.InstancedMesh>(null);
  const crateRef = useRef<THREE.InstancedMesh>(null);
  const statusRef = useRef<THREE.InstancedMesh>(null);
  const padRef = useRef<THREE.InstancedMesh>(null);
  // Per-silhouette aDim instanced attributes (body/trim dim factor for the
  // themed material; legacy ignores them).
  const dimAttrsRef = useRef<Partial<Record<StructureSilhouette, THREE.InstancedBufferAttribute>>>(
    {},
  );

  const themed = useMemo(() => createThemedStructureMaterial(theme), [theme]);
  useEffect(() => {
    return () => {
      themed.material.dispose();
      themed.codes?.dispose();
    };
  }, [themed]);

  // Foundation pads (field): graphite slab + emissive edge under each
  // structure — what separates industry from nature.
  const pad = useMemo(() => createPadMaterial(theme), [theme]);
  useEffect(() => {
    return () => {
      pad.material.dispose();
    };
  }, [pad]);

  const gpuRef = useRef<StructureGpuAssets | null>(null);
  const silCountsRef = useRef<Record<StructureSilhouette, number> | null>(null);
  const glyphCountsRef = useRef<Record<ActiveGlyph, number> | null>(null);
  const dummyRef = useRef<THREE.Object3D | null>(null);
  const colorRef = useRef<THREE.Color | null>(null);

  useEffect(() => {
    return () => {
      const gpu = gpuRef.current;
      if (gpu !== null) {
        disposeSilhouetteGeometries(gpu.geos);
        disposeGlyphMaterials(gpu.glyphs);
        gpu.roofGeo.dispose();
        gpuRef.current = null;
      }
    };
  }, []);

  useFrame(({ camera }) => {
    const bpMesh = blueprintRef.current;
    const waitMesh = waitingRef.current;
    const crates = crateRef.current;
    const statusMesh = statusRef.current;
    if (bpMesh === null || waitMesh === null || crates === null) {
      return;
    }

    const gpu = ensureGpuAssets(gpuRef, theme.geometry.bevel);
    if (!bindGpuToMeshes(silRefs.current, glyphRefs.current, gpu)) {
      return;
    }
    const dimAttrs = dimAttrsRef.current;
    for (const s of STRUCTURE_SILHOUETTES) {
      const mesh = silRefs.current[s];
      if (mesh === undefined || mesh === null) {
        continue;
      }
      let attr = dimAttrs[s];
      if (attr === undefined || attr.count !== capacity) {
        attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
        mesh.geometry.setAttribute('aDim', attr);
        dimAttrs[s] = attr;
      }
    }

    silCountsRef.current ??= makeSilhouetteCounts();
    glyphCountsRef.current ??= makeGlyphCounts();
    dummyRef.current ??= new THREE.Object3D();
    colorRef.current ??= new THREE.Color();

    const silCounts = silCountsRef.current;
    const glyphCounts = glyphCountsRef.current;
    const dummy = dummyRef.current;
    const color = colorRef.current;

    const pair = client.snapshots();
    const latest = pair.latest;
    const channel = latest?.channels[StructuresChannel.id] as ConstructionStructures | undefined;
    const salvage = latest?.channels[SalvageChannel.id] as ConstructionSalvage | undefined;
    const localFaction = latest?.observer ?? null;

    const n = channel?.handles.length ?? 0;
    const cratesN = salvage?.handles.length ?? 0;
    if (n + cratesN > capacity) {
      setCapacity((n + cratesN) * 2);
      return;
    }

    resetSilhouetteCounts(silCounts);
    resetGlyphCounts(glyphCounts);
    let bpCount = 0;
    let waitCount = 0;
    let statusCount = 0;
    let padCount = 0;

    const cam = useCameraStore.getState();
    // Tactical info view (弱化显示): lerp the structure/pad dim uniforms
    // toward 1 while the camera is in tactical mode.
    const infoTarget =
      theme.info2d && useUiStore.getState().info2d && cam.mode === 'tactical' ? 1 : 0;
    for (const u of [themed.uniforms.info2d, pad.uniforms.info2d]) {
      u.value += (infoTarget - u.value) * 0.25;
      if (Math.abs(u.value - infoTarget) < 0.01) {
        u.value = infoTarget;
      }
    }
    const glyphYawRot = camera.rotation.y;
    updateGlyphOpacity(
      gpu.glyphs,
      cam.mode,
      effectiveSpectatePitchDeg(cam.zoom, cam.pitchOffsetDeg),
    );

    if (channel !== undefined) {
      for (let i = 0; i < channel.handles.length; i++) {
        const kindIndex = channel.kind[i] ?? 0;
        const kind = db.structures.byIndex(kindIndex);
        if (kind === undefined) {
          continue;
        }
        const state = channel.state[i] ?? 0;
        const faction = channel.faction[i] ?? 0;
        const w = kind.footprint.w;
        const h = kind.footprint.h;
        const cx = (channel.x[i] ?? 0) + w / 2;
        const cy = (channel.y[i] ?? 0) + h / 2;
        const groundY = terrainY(heights, mapWidth, mapHeight, cx, cy);
        const full = structureKindHeight(db, kindIndex);
        const progress = (channel.progressBp[i] ?? 0) / 10000;

        if (state === STATE_BLUEPRINT) {
          dummy.position.set(cx, groundY + (full * 0.5) / 2, cy);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(w * 0.9, full * 0.5, h * 0.9);
          dummy.updateMatrix();
          bpMesh.setMatrixAt(bpCount, dummy.matrix);
          color.set(factionColorHex(faction, localFaction));
          bpMesh.setColorAt(bpCount, color);
          bpCount += 1;
          continue;
        }

        if (state === STATE_WAITING) {
          dummy.position.set(cx, groundY + (full * 0.5) / 2, cy);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(w * 0.9, full * 0.5, h * 0.9);
          dummy.updateMatrix();
          waitMesh.setMatrixAt(waitCount, dummy.matrix);
          color.set(factionColorHex(faction, localFaction));
          color.lerp(AMBER_COLOR, 0.55);
          waitMesh.setColorAt(waitCount, color);
          waitCount += 1;
          continue;
        }

        const heightScale =
          state === STATE_RUIN
            ? RUIN_HEIGHT / full
            : state === STATE_SITE
              ? Math.max(0.15, progress)
              : 1;
        const silhouette: StructureSilhouette =
          state === STATE_RUIN ? 'block' : kind.visual.silhouette;
        const silMesh = silRefs.current[silhouette];
        if (silMesh !== undefined && silMesh !== null) {
          const slot = silCounts[silhouette];
          dummy.position.set(cx, groundY, cy);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(w * 0.92, full * heightScale, h * 0.92);
          dummy.updateMatrix();
          silMesh.setMatrixAt(slot, dummy.matrix);
          let dim = 1;
          if (state === STATE_RUIN) {
            color.set(RUIN_COLOR);
            dim = OUTPOST_TINT * DEMOLISH_DARKEN;
          } else {
            color.set(factionColorHex(faction, localFaction));
            if (kind.capture !== undefined) {
              color.multiplyScalar(OUTPOST_TINT);
            }
            if (state === STATE_SITE) {
              dim = SITE_DARKEN + progress * (1 - SITE_DARKEN);
            } else if (state === STATE_DEMOLISHING) {
              dim = DEMOLISH_DARKEN;
            }
            if (dim !== 1) {
              color.multiplyScalar(dim);
            }
          }
          dimAttrs[silhouette]?.setX(slot, dim);
          silMesh.setColorAt(slot, color);
          silCounts[silhouette] = slot + 1;
        }

        // Foundation pad under built structures (field): graphite slab
        // slightly larger than the footprint, sunk into the terrain.
        const padMesh = padRef.current;
        if (padMesh !== null && state !== STATE_RUIN) {
          const margin = theme.pad.margin;
          dummy.position.set(cx, groundY - 0.04 + theme.pad.height / 2, cy);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(w + margin * 2, theme.pad.height, h + margin * 2);
          dummy.updateMatrix();
          padMesh.setMatrixAt(padCount, dummy.matrix);
          padCount += 1;
        }

        // Damaged operational structures get a floating warning marker
        // (themed modes only; uses hpBp already in the channel).
        if (
          statusMesh !== null &&
          state === STATE_OPERATIONAL &&
          (channel.hpBp[i] ?? 10000) < 9000 &&
          statusCount < capacity
        ) {
          dummy.position.set(cx, groundY + full + 0.55, cy);
          dummy.rotation.set(0, glyphYawRot, 0);
          dummy.scale.set(0.22, 0.22, 0.22);
          dummy.updateMatrix();
          statusMesh.setMatrixAt(statusCount, dummy.matrix);
          statusCount += 1;
        }

        const glyph = kind.visual.glyph;
        if (state === STATE_OPERATIONAL && glyph !== 'none') {
          const gMesh = glyphRefs.current[glyph];
          if (gMesh !== undefined && gMesh !== null) {
            const gSlot = glyphCounts[glyph];
            const badgeSize = Math.max(0.42, Math.min(w, h) * 0.34);
            dummy.position.set(cx, groundY + full + 0.06, cy);
            dummy.rotation.set(0, glyphYawRot, 0);
            dummy.scale.set(badgeSize, 1, badgeSize);
            dummy.updateMatrix();
            gMesh.setMatrixAt(gSlot, dummy.matrix);
            color.set(resolveGlyphTint(faction, localFaction, isHostile));
            // HDR tint so roof glyphs feed bloom.
            color.multiplyScalar(theme.materials.emissiveBoost);
            gMesh.setColorAt(gSlot, color);
            glyphCounts[glyph] = gSlot + 1;
          }
        }
      }
    }

    for (const s of STRUCTURE_SILHOUETTES) {
      const silMesh = silRefs.current[s];
      if (silMesh !== undefined && silMesh !== null) {
        commitMeshBuffers(silMesh, silCounts[s]);
      }
      const dimAttr = dimAttrs[s];
      if (dimAttr !== undefined) {
        dimAttr.needsUpdate = true;
      }
    }
    for (const g of ACTIVE_STRUCTURE_GLYPHS) {
      const gMesh = glyphRefs.current[g];
      if (gMesh !== undefined && gMesh !== null) {
        commitMeshBuffers(gMesh, glyphCounts[g]);
      }
    }

    if (statusMesh !== null) {
      statusMesh.count = statusCount;
      statusMesh.instanceMatrix.needsUpdate = true;
    }
    commitMeshBuffers(bpMesh, bpCount);
    commitMeshBuffers(waitMesh, waitCount);
    const pulse = 0.38 + 0.3 * (0.5 + 0.5 * Math.sin(performance.now() / 180));
    setWaitingOpacity(waitMesh, pulse);

    if (salvage !== undefined) {
      for (let i = 0; i < salvage.handles.length; i++) {
        const x = salvage.x[i] ?? 0;
        const y = salvage.y[i] ?? 0;
        const groundY = terrainY(heights, mapWidth, mapHeight, x, y);
        dummy.position.set(x, groundY + SALVAGE_SIZE / 2, y);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(SALVAGE_SIZE, SALVAGE_SIZE, SALVAGE_SIZE);
        dummy.updateMatrix();
        crates.setMatrixAt(i, dummy.matrix);
      }
      crates.count = salvage.handles.length;
    } else {
      crates.count = 0;
    }
    crates.instanceMatrix.needsUpdate = true;

    const padMesh = padRef.current;
    if (padMesh !== null) {
      padMesh.count = padCount;
      padMesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {STRUCTURE_SILHOUETTES.map((s) => (
        <instancedMesh
          key={`sil-${s}-${capacity}`}
          ref={(m) => {
            silRefs.current[s] = m;
          }}
          args={[undefined, undefined, capacity]}
          frustumCulled={false}
          castShadow
        >
          <primitive object={themed.material} attach={ATTACH_MATERIAL} />
        </instancedMesh>
      ))}
      {ACTIVE_STRUCTURE_GLYPHS.map((g) => (
        <instancedMesh
          key={`gly-${g}-${capacity}`}
          ref={(m) => {
            glyphRefs.current[g] = m;
          }}
          args={[undefined, undefined, capacity]}
          frustumCulled={false}
          renderOrder={1}
        />
      ))}
      <instancedMesh
        key={`bp-${capacity}`}
        ref={blueprintRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0.28} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        key={`wait-${capacity}`}
        ref={waitingRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0.5} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        key={`c-${capacity}`}
        ref={crateRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={SALVAGE_COLOR} />
      </instancedMesh>
      <instancedMesh
        key={`status-${capacity}`}
        ref={statusRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
      >
        <octahedronGeometry args={[0.16, 0]} />
        <meshBasicMaterial color={STATUS_COLOR} toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        key={`pad-${capacity}`}
        ref={padRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={pad.material} attach={ATTACH_MATERIAL} />
      </instancedMesh>
    </group>
  );
}
