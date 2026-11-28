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
import { useUiStore } from '../../../client/ui-store';
import { cameraTransitionState } from '../../../render/camera-transition';
import type { SceneLayerProps } from '../../../render/scene';
import { VISUAL } from '../../../render/theme/index';
import { useGpuResource } from '../../../render/use-gpu-resource';
import { InstanceWriter } from '../../../render/instance-writer';
import { STRUCTURE_SILHOUETTES, type StructureSilhouette } from '../content';
import { SalvageChannel, StructuresChannel } from '../protocol';
import { createPadMaterial } from './pad-material';
import { createThemedStructureMaterial } from './themed-structure-material';
import { ACTIVE_STRUCTURE_GLYPHS, disposeGlyphMaterials } from './structure-glyphs';
import {
  bindGpuToMeshes,
  ensureDimAttrs,
  ensureGpuAssets,
  hasNonZeroGlyphs,
  hideAllStructureMeshes,
  makeCrateCache,
  makeGlyphCounts,
  makeSilhouetteCounts,
  makeStructCache,
  rebuildStructuresFull,
  resolveGlyphOpacity,
  SALVAGE_COLOR,
  setWaitingOpacity,
  STATUS_COLOR,
  stepInfo2dUniforms,
  updateCrates,
  updateGlyphOpacity,
  updateStructureYawOnly,
  type ActiveGlyph,
  type CrateCache,
  type StructCache,
  type StructureGpuAssets,
} from './structure-gpu';
import { disposeSilhouetteGeometries } from './structure-geometries';
import { renderNowMs } from '../../../client/capture-mode';
import { readChannel } from '../../../core/index';

const ATTACH_MATERIAL = 'material';
const YAW_EPSILON = 1e-4;

function setInfo2dUniforms(uniforms: readonly { value: number }[], value: number): void {
  for (const u of uniforms) {
    u.value = value;
  }
}

export function StructuresLayer({ ctx }: SceneLayerProps) {
  const { client, db, heights, isHostile } = ctx;
  const { width: mapWidth, height: mapHeight } = ctx.map.grid;
  const [capacity, setCapacity] = useState(64);
  const theme = VISUAL;
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
  useGpuResource(themed.material);
  useGpuResource(themed.codes);

  // Foundation pads (field): graphite slab + emissive edge under each
  // structure — what separates industry from nature.
  const pad = useMemo(() => createPadMaterial(theme), [theme]);
  useGpuResource(pad.material);

  const gpuRef = useRef<StructureGpuAssets | null>(null);
  const silCountsRef = useRef<Record<StructureSilhouette, number> | null>(null);
  const glyphCountsRef = useRef<Record<ActiveGlyph, number> | null>(null);
  const writerRef = useRef<InstanceWriter | null>(null);
  const colorRef = useRef<THREE.Color | null>(null);
  const structCacheRef = useRef<StructCache | null>(null);
  const crateCacheRef = useRef<CrateCache | null>(null);

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
    const padMesh = padRef.current;
    if (bpMesh === null || waitMesh === null || crates === null) {
      return;
    }

    const gpu = ensureGpuAssets(gpuRef, theme.geometry.bevel);
    if (!bindGpuToMeshes(silRefs.current, glyphRefs.current, gpu)) {
      return;
    }
    ensureDimAttrs(silRefs.current, dimAttrsRef.current, capacity);

    silCountsRef.current ??= makeSilhouetteCounts();
    glyphCountsRef.current ??= makeGlyphCounts();
    writerRef.current ??= new InstanceWriter();
    colorRef.current ??= new THREE.Color();
    structCacheRef.current ??= makeStructCache();
    crateCacheRef.current ??= makeCrateCache();

    const pair = client.snapshots();
    const latest = pair.latest;
    const channel = readChannel(latest, StructuresChannel) ?? undefined;
    const salvage = readChannel(latest, SalvageChannel) ?? undefined;
    const localFaction = latest?.observer ?? null;

    const n = channel?.handles.length ?? 0;
    const cratesN = salvage?.handles.length ?? 0;
    if (n + cratesN > capacity) {
      hideAllStructureMeshes(
        silRefs.current,
        glyphRefs.current,
        bpMesh,
        waitMesh,
        crates,
        statusMesh,
        padMesh,
      );
      setCapacity((n + cratesN) * 2);
      return;
    }

    const blend = cameraTransitionState.blend;
    const info2dActive = theme.info2d && useUiStore.getState().info2d;
    if (blend > 0 && blend < 1) {
      setInfo2dUniforms([themed.uniforms.info2d, pad.uniforms.info2d], info2dActive ? blend : 0);
    } else {
      stepInfo2dUniforms(
        [themed.uniforms.info2d, pad.uniforms.info2d],
        info2dActive && blend >= 1 ? 1 : 0,
      );
    }

    const structCache = structCacheRef.current;
    if (gpu.bevel !== structCache.bevel) {
      structCache.glyphOpacity = -1;
    }
    const opacity = resolveGlyphOpacity(
      blend >= 1 ? 'tactical' : 'spectate',
      cameraTransitionState.visualPitchDeg,
    );
    if (opacity !== structCache.glyphOpacity) {
      updateGlyphOpacity(gpu.glyphs, opacity);
      structCache.glyphOpacity = opacity;
    }

    updateCrates(
      crates,
      salvage,
      heights,
      mapWidth,
      mapHeight,
      capacity,
      writerRef.current,
      crateCacheRef.current,
    );

    const glyphYawRot = camera.rotation.y;
    if (
      channel !== structCache.channel ||
      localFaction !== structCache.localFaction ||
      heights !== structCache.heights ||
      isHostile !== structCache.isHostile ||
      capacity !== structCache.capacity ||
      gpu.bevel !== structCache.bevel
    ) {
      rebuildStructuresFull(
        channel,
        localFaction,
        heights,
        mapWidth,
        mapHeight,
        db,
        isHostile,
        capacity,
        gpu.bevel,
        theme.pad.margin,
        theme.pad.height,
        theme.materials.emissiveBoost,
        glyphYawRot,
        silRefs.current,
        glyphRefs.current,
        dimAttrsRef.current,
        bpMesh,
        waitMesh,
        statusMesh,
        padMesh,
        silCountsRef.current,
        glyphCountsRef.current,
        writerRef.current,
        colorRef.current,
        structCache,
      );
    } else if (
      Math.abs(glyphYawRot - structCache.yaw) > YAW_EPSILON &&
      (structCache.statusCount > 0 || hasNonZeroGlyphs(structCache.glyphCounts))
    ) {
      updateStructureYawOnly(
        channel,
        heights,
        mapWidth,
        mapHeight,
        db,
        capacity,
        glyphYawRot,
        glyphRefs.current,
        statusMesh,
        glyphCountsRef.current,
        writerRef.current,
        structCache,
      );
    }

    if (waitMesh.visible) {
      const pulse = 0.38 + 0.3 * (0.5 + 0.5 * Math.sin(renderNowMs() / 180));
      setWaitingOpacity(waitMesh, pulse);
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
          visible={false}
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
          visible={false}
          frustumCulled={false}
          renderOrder={1}
        />
      ))}
      <instancedMesh
        key={`bp-${capacity}`}
        ref={blueprintRef}
        args={[undefined, undefined, capacity]}
        visible={false}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0.28} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        key={`wait-${capacity}`}
        ref={waitingRef}
        args={[undefined, undefined, capacity]}
        visible={false}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0.5} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        key={`c-${capacity}`}
        ref={crateRef}
        args={[undefined, undefined, capacity]}
        visible={false}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={SALVAGE_COLOR} />
      </instancedMesh>
      <instancedMesh
        key={`status-${capacity}`}
        ref={statusRef}
        args={[undefined, undefined, capacity]}
        visible={false}
        frustumCulled={false}
      >
        <octahedronGeometry args={[0.16, 0]} />
        <meshBasicMaterial color={STATUS_COLOR} toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        key={`pad-${capacity}`}
        ref={padRef}
        args={[undefined, undefined, capacity]}
        visible={false}
        frustumCulled={false}
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={pad.material} attach={ATTACH_MATERIAL} />
      </instancedMesh>
    </group>
  );
}
