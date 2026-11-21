// Structure/salvage rendering (ADR 0050): procedural multi-part
// silhouettes with vertex shading, roof tactical glyph badges (camera
// mode-responsive opacity), separated blueprint vs pulsing-waiting layers,
// rising construction sites, darkened demolishing structures, low-rubble
// ruins, and salvage crates. Reads snapshot channels in useFrame; no
// per-tick state in React.
import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCameraStore } from '../../../client/camera-store';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb } from '../../../content/index';
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
import { createSilhouetteGeometries, disposeSilhouetteGeometries } from './structure-geometries';
import {
  ACTIVE_STRUCTURE_GLYPHS,
  createGlyphMaterials,
  disposeGlyphMaterials,
  type GlyphMaterialEntry,
} from './structure-glyphs';

const SALVAGE_SIZE = 0.3;
const SALVAGE_COLOR = '#8a6a3f';
const SITE_DARKEN = 0.45;
const DEMOLISH_DARKEN = 0.4;
// Outposts read as squat fortified pads; ruins are faction-neutral rubble.
const OUTPOST_TINT = 0.8;
const RUIN_COLOR = '#3a3430';
const RUIN_HEIGHT = 0.3;
const AMBER_COLOR = new THREE.Color('#ffb84d');
const GLYPH_OWN_COLOR = '#9be2ff';
const GLYPH_HOSTILE_COLOR = '#ff8a80';
const GLYPH_ALLY_COLOR = '#8ce8b8';

type ActiveGlyph = (typeof ACTIVE_STRUCTURE_GLYPHS)[number];

interface StructureGpuAssets {
  geos: Record<StructureSilhouette, THREE.BufferGeometry>;
  glyphs: Record<ActiveGlyph, GlyphMaterialEntry>;
  roofGeo: THREE.PlaneGeometry;
}

function makeSilhouetteCounts(): Record<StructureSilhouette, number> {
  const counts = {} as Record<StructureSilhouette, number>;
  for (const s of STRUCTURE_SILHOUETTES) {
    counts[s] = 0;
  }
  return counts;
}

function makeGlyphCounts(): Record<ActiveGlyph, number> {
  const counts = {} as Record<ActiveGlyph, number>;
  for (const g of ACTIVE_STRUCTURE_GLYPHS) {
    counts[g] = 0;
  }
  return counts;
}

function resetSilhouetteCounts(counts: Record<StructureSilhouette, number>): void {
  for (const s of STRUCTURE_SILHOUETTES) {
    counts[s] = 0;
  }
}

function resetGlyphCounts(counts: Record<ActiveGlyph, number>): void {
  for (const g of ACTIVE_STRUCTURE_GLYPHS) {
    counts[g] = 0;
  }
}

function ensureGpuAssets(gpuRef: { current: StructureGpuAssets | null }): StructureGpuAssets {
  if (gpuRef.current === null) {
    const roofGeo = new THREE.PlaneGeometry(1, 1);
    roofGeo.rotateX(-Math.PI / 2);
    gpuRef.current = {
      geos: createSilhouetteGeometries(),
      glyphs: createGlyphMaterials(),
      roofGeo,
    };
  }
  return gpuRef.current;
}

function bindGpuToMeshes(
  silMeshes: Partial<Record<StructureSilhouette, THREE.InstancedMesh | null>>,
  glyphMeshes: Partial<Record<ActiveGlyph, THREE.InstancedMesh | null>>,
  gpu: StructureGpuAssets,
): boolean {
  for (const s of STRUCTURE_SILHOUETTES) {
    const mesh = silMeshes[s];
    if (mesh === undefined || mesh === null) {
      return false;
    }
    const geo = gpu.geos[s];
    if (mesh.geometry !== geo) {
      mesh.geometry.dispose();
      mesh.geometry = geo;
    }
  }
  for (const g of ACTIVE_STRUCTURE_GLYPHS) {
    const mesh = glyphMeshes[g];
    if (mesh === undefined || mesh === null) {
      return false;
    }
    if (mesh.geometry !== gpu.roofGeo) {
      mesh.geometry.dispose();
      mesh.geometry = gpu.roofGeo;
    }
    const mat = gpu.glyphs[g].material;
    if (mesh.material !== mat) {
      if (!Array.isArray(mesh.material)) {
        mesh.material.dispose();
      }
      mesh.material = mat;
    }
  }
  return true;
}

function updateGlyphOpacity(
  glyphs: Record<ActiveGlyph, GlyphMaterialEntry>,
  mode: 'spectate' | 'tactical',
): void {
  const opacity = mode === 'tactical' ? 0.94 : 0.68;
  for (const g of ACTIVE_STRUCTURE_GLYPHS) {
    glyphs[g].material.opacity = opacity;
  }
}

function setWaitingOpacity(waitingMesh: THREE.InstancedMesh, opacity: number): void {
  const mat = waitingMesh.material;
  if (!Array.isArray(mat) && mat instanceof THREE.MeshBasicMaterial) {
    mat.opacity = opacity;
  }
}

function commitMeshBuffers(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) {
    mesh.instanceColor.needsUpdate = true;
  }
}

function resolveGlyphTint(
  faction: number,
  localFaction: number | null,
  isHostile?: (observer: number, faction: number) => boolean,
): string {
  if (localFaction !== null && faction === localFaction) {
    return GLYPH_OWN_COLOR;
  }
  if (faction === 0) {
    return GLYPH_ALLY_COLOR;
  }
  if (localFaction !== null && isHostile !== undefined) {
    return isHostile(localFaction, faction) ? GLYPH_HOSTILE_COLOR : GLYPH_ALLY_COLOR;
  }
  return GLYPH_HOSTILE_COLOR;
}

// Greybox height from content (`visual.height`, required per kind);
// unknown indices fall back to a unit-height box.
export function structureKindHeight(db: ContentDb, kindIndex: number): number {
  return db.structures.byIndex(kindIndex)?.visual.height ?? 1;
}

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
  const silRefs = useRef<Partial<Record<StructureSilhouette, THREE.InstancedMesh | null>>>({});
  const glyphRefs = useRef<Partial<Record<ActiveGlyph, THREE.InstancedMesh | null>>>({});
  const blueprintRef = useRef<THREE.InstancedMesh>(null);
  const waitingRef = useRef<THREE.InstancedMesh>(null);
  const crateRef = useRef<THREE.InstancedMesh>(null);

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

  useFrame(() => {
    const bpMesh = blueprintRef.current;
    const waitMesh = waitingRef.current;
    const crates = crateRef.current;
    if (bpMesh === null || waitMesh === null || crates === null) {
      return;
    }

    const gpu = ensureGpuAssets(gpuRef);
    if (!bindGpuToMeshes(silRefs.current, glyphRefs.current, gpu)) {
      return;
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

    updateGlyphOpacity(gpu.glyphs, useCameraStore.getState().mode);

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
          dummy.scale.set(w * 0.92, full * heightScale, h * 0.92);
          dummy.updateMatrix();
          silMesh.setMatrixAt(slot, dummy.matrix);
          if (state === STATE_RUIN) {
            color.set(RUIN_COLOR);
          } else {
            color.set(factionColorHex(faction, localFaction));
            if (kind.capture !== undefined) {
              color.multiplyScalar(OUTPOST_TINT);
            }
            if (state === STATE_SITE) {
              color.multiplyScalar(SITE_DARKEN + progress * (1 - SITE_DARKEN));
            } else if (state === STATE_DEMOLISHING) {
              color.multiplyScalar(DEMOLISH_DARKEN);
            }
          }
          silMesh.setColorAt(slot, color);
          silCounts[silhouette] = slot + 1;
        }

        const glyph = kind.visual.glyph;
        if (state === STATE_OPERATIONAL && glyph !== 'none') {
          const gMesh = glyphRefs.current[glyph];
          if (gMesh !== undefined && gMesh !== null) {
            const gSlot = glyphCounts[glyph];
            const badgeSize = Math.max(0.7, Math.min(w, h) * 0.66);
            dummy.position.set(cx, groundY + full + 0.04, cy);
            dummy.scale.set(badgeSize, 1, badgeSize);
            dummy.updateMatrix();
            gMesh.setMatrixAt(gSlot, dummy.matrix);
            color.set(resolveGlyphTint(faction, localFaction, isHostile));
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
    }
    for (const g of ACTIVE_STRUCTURE_GLYPHS) {
      const gMesh = glyphRefs.current[g];
      if (gMesh !== undefined && gMesh !== null) {
        commitMeshBuffers(gMesh, glyphCounts[g]);
      }
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
        dummy.scale.set(SALVAGE_SIZE, SALVAGE_SIZE, SALVAGE_SIZE);
        dummy.updateMatrix();
        crates.setMatrixAt(i, dummy.matrix);
      }
      crates.count = salvage.handles.length;
    } else {
      crates.count = 0;
    }
    crates.instanceMatrix.needsUpdate = true;
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
        >
          <meshLambertMaterial vertexColors />
        </instancedMesh>
      ))}
      {ACTIVE_STRUCTURE_GLYPHS.map((g) => (
        <instancedMesh
          key={`gly-${g}-${capacity}`}
          ref={(m) => {
            glyphRefs.current[g] = m;
          }}
          args={[undefined, undefined, capacity]}
          renderOrder={1}
        />
      ))}
      <instancedMesh
        key={`bp-${capacity}`}
        ref={blueprintRef}
        args={[undefined, undefined, capacity]}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0.28} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        key={`wait-${capacity}`}
        ref={waitingRef}
        args={[undefined, undefined, capacity]}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0.5} depthWrite={false} />
      </instancedMesh>
      <instancedMesh key={`c-${capacity}`} ref={crateRef} args={[undefined, undefined, capacity]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={SALVAGE_COLOR} />
      </instancedMesh>
    </group>
  );
}
