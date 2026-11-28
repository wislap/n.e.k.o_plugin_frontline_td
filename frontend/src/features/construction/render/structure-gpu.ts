// Structure-layer GPU assets and per-frame helpers (ADR 0050): shared
// silhouette geometries + glyph materials lifecycle, instanced-buffer
// bookkeeping, glyph opacity/tint rules, and the content-db height query.
// Extracted from StructuresLayer so the layer file is just the component.
import * as THREE from 'three';
import type { ContentDb } from '../../../content/index';
import type { InstanceWriter } from '../../../render/instance-writer';
import { VISUAL } from '../../../render/theme/index';
import { bindGeometry } from '../../../render/use-gpu-resource';
import { terrainY } from '../../../client/world';
import { factionColorHex } from '../../../render/faction-colors';
import { STRUCTURE_SILHOUETTES, type StructureSilhouette } from '../content';
import {
  STATE_BLUEPRINT,
  STATE_DEMOLISHING,
  STATE_OPERATIONAL,
  STATE_RUIN,
  STATE_SITE,
  STATE_WAITING,
  type ConstructionSalvage,
  type ConstructionStructures,
} from '../protocol';
import {
  createSilhouetteGeometries,
  disposeSilhouetteGeometries,
  type SilhouetteGeometries,
} from './structure-geometries';
import {
  ACTIVE_STRUCTURE_GLYPHS,
  createGlyphMaterials,
  disposeGlyphMaterials,
  type GlyphMaterialEntry,
} from './structure-glyphs';

export const STATUS_COLOR = VISUAL.markers.warn;
const SALVAGE_SIZE = 0.3;
export const SALVAGE_COLOR = '#8a6a3f';
const SITE_DARKEN = 0.45;
const DEMOLISH_DARKEN = 0.4;
// Outposts read as squat fortified pads; ruins are faction-neutral rubble.
const OUTPOST_TINT = 0.8;
const RUIN_COLOR = '#3a3430';
const RUIN_HEIGHT = 0.3;
const AMBER_COLOR = new THREE.Color(VISUAL.markers.warn);
const GLYPH_OWN_COLOR = '#9be2ff';
const GLYPH_HOSTILE_COLOR = VISUAL.markers.hostileGlyph;
const GLYPH_ALLY_COLOR = '#8ce8b8';

export type ActiveGlyph = (typeof ACTIVE_STRUCTURE_GLYPHS)[number];

export interface StructureGpuAssets {
  geos: SilhouetteGeometries;
  glyphs: Record<ActiveGlyph, GlyphMaterialEntry>;
  roofGeo: THREE.PlaneGeometry;
  // Bevel the geos were built with — rebuilt when the theme changes it.
  bevel: number;
}

export function makeSilhouetteCounts(): Record<StructureSilhouette, number> {
  const counts = {} as Record<StructureSilhouette, number>;
  for (const s of STRUCTURE_SILHOUETTES) {
    counts[s] = 0;
  }
  return counts;
}

export function makeGlyphCounts(): Record<ActiveGlyph, number> {
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

function disposeAssets(gpu: StructureGpuAssets): void {
  disposeSilhouetteGeometries(gpu.geos);
  disposeGlyphMaterials(gpu.glyphs);
  gpu.roofGeo.dispose();
}

export function ensureGpuAssets(
  gpuRef: { current: StructureGpuAssets | null },
  bevel: number,
): StructureGpuAssets {
  if (gpuRef.current !== null && gpuRef.current.bevel !== bevel) {
    disposeAssets(gpuRef.current);
    gpuRef.current = null;
  }
  if (gpuRef.current === null) {
    const roofGeo = new THREE.PlaneGeometry(1, 1);
    roofGeo.rotateX(-Math.PI / 2);
    roofGeo.userData['shared'] = true;
    gpuRef.current = {
      geos: createSilhouetteGeometries(bevel),
      glyphs: createGlyphMaterials(),
      roofGeo,
      bevel,
    };
  }
  return gpuRef.current;
}

export function bindGpuToMeshes(
  silMeshes: Partial<Record<StructureSilhouette, THREE.InstancedMesh | null>>,
  glyphMeshes: Partial<Record<ActiveGlyph, THREE.InstancedMesh | null>>,
  gpu: StructureGpuAssets,
): boolean {
  for (const s of STRUCTURE_SILHOUETTES) {
    const mesh = silMeshes[s];
    if (mesh === undefined || mesh === null) {
      return false;
    }
    bindGeometry(mesh, gpu.geos[s]);
  }
  for (const g of ACTIVE_STRUCTURE_GLYPHS) {
    const mesh = glyphMeshes[g];
    if (mesh === undefined || mesh === null) {
      return false;
    }
    bindGeometry(mesh, gpu.roofGeo);
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

export function resolveGlyphOpacity(mode: 'spectate' | 'tactical', pitchDeg: number): number {
  if (mode === 'tactical') {
    return 0.94;
  }
  const t = Math.max(0, Math.min(1, (pitchDeg - 26) / (70 - 26)));
  return 0.45 + t * (0.72 - 0.45);
}

export function updateGlyphOpacity(
  glyphs: Record<ActiveGlyph, GlyphMaterialEntry>,
  opacity: number,
): void {
  for (const g of ACTIVE_STRUCTURE_GLYPHS) {
    glyphs[g].material.opacity = opacity;
  }
}

export function setWaitingOpacity(waitingMesh: THREE.InstancedMesh, opacity: number): void {
  const mat = waitingMesh.material;
  if (!Array.isArray(mat) && mat instanceof THREE.MeshBasicMaterial) {
    mat.opacity = opacity;
  }
}

export function commitMeshBuffers(mesh: THREE.InstancedMesh, count: number): void {
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

export function commitDimAttr(attr: THREE.InstancedBufferAttribute, count: number): void {
  if (count > 0) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, count);
    attr.needsUpdate = true;
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

export interface StructCache {
  channel: ConstructionStructures | undefined;
  localFaction: number | null;
  heights: ArrayLike<number> | null;
  isHostile: ((observer: number, faction: number) => boolean) | undefined;
  capacity: number;
  bevel: number;
  bpCount: number;
  waitCount: number;
  statusCount: number;
  padCount: number;
  silCounts: Record<StructureSilhouette, number>;
  glyphCounts: Record<ActiveGlyph, number>;
  yaw: number;
  glyphOpacity: number;
}

export interface CrateCache {
  salvage: ConstructionSalvage | undefined;
  heights: ArrayLike<number> | null;
  capacity: number;
  crateCount: number;
}

export function makeStructCache(): StructCache {
  return {
    channel: undefined,
    localFaction: null,
    heights: null,
    isHostile: undefined,
    capacity: 0,
    bevel: -1,
    bpCount: 0,
    waitCount: 0,
    statusCount: 0,
    padCount: 0,
    silCounts: makeSilhouetteCounts(),
    glyphCounts: makeGlyphCounts(),
    yaw: NaN,
    glyphOpacity: -1,
  };
}

export function makeCrateCache(): CrateCache {
  return {
    salvage: undefined,
    heights: null,
    capacity: 0,
    crateCount: 0,
  };
}

export function stepInfo2dUniforms(uniforms: readonly { value: number }[], target: number): void {
  for (const u of uniforms) {
    if (u.value === target) {
      continue;
    }
    u.value += (target - u.value) * 0.25;
    if (Math.abs(u.value - target) < 0.01) {
      u.value = target;
    }
  }
}

export function hasNonZeroGlyphs(counts: Readonly<Record<ActiveGlyph, number>>): boolean {
  for (const g of ACTIVE_STRUCTURE_GLYPHS) {
    if (counts[g] > 0) {
      return true;
    }
  }
  return false;
}

export function ensureDimAttrs(
  silRefs: Partial<Record<StructureSilhouette, THREE.InstancedMesh | null>>,
  dimAttrs: Partial<Record<StructureSilhouette, THREE.InstancedBufferAttribute>>,
  capacity: number,
): void {
  for (const s of STRUCTURE_SILHOUETTES) {
    const mesh = silRefs[s];
    if (mesh === undefined || mesh === null) {
      continue;
    }
    let attr = dimAttrs[s];
    if (attr === undefined || attr.count !== capacity) {
      attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
      attr.setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.setAttribute('aDim', attr);
      dimAttrs[s] = attr;
    } else if (mesh.geometry.getAttribute('aDim') !== attr) {
      mesh.geometry.setAttribute('aDim', attr);
    }
  }
}

export function hideAllStructureMeshes(
  silRefs: Partial<Record<StructureSilhouette, THREE.InstancedMesh | null>>,
  glyphRefs: Partial<Record<ActiveGlyph, THREE.InstancedMesh | null>>,
  bpMesh: THREE.InstancedMesh,
  waitMesh: THREE.InstancedMesh,
  crates: THREE.InstancedMesh,
  statusMesh: THREE.InstancedMesh | null,
  padMesh: THREE.InstancedMesh | null,
): void {
  for (const s of STRUCTURE_SILHOUETTES) {
    const m = silRefs[s];
    if (m !== undefined && m !== null) {
      m.visible = false;
    }
  }
  for (const g of ACTIVE_STRUCTURE_GLYPHS) {
    const m = glyphRefs[g];
    if (m !== undefined && m !== null) {
      m.visible = false;
    }
  }
  bpMesh.visible = false;
  waitMesh.visible = false;
  crates.visible = false;
  if (statusMesh !== null) {
    statusMesh.visible = false;
  }
  if (padMesh !== null) {
    padMesh.visible = false;
  }
}

export function updateCrates(
  crates: THREE.InstancedMesh,
  salvage: ConstructionSalvage | undefined,
  heights: ArrayLike<number>,
  mapWidth: number,
  mapHeight: number,
  capacity: number,
  writer: InstanceWriter,
  cache: CrateCache,
): void {
  if (salvage === cache.salvage && heights === cache.heights && capacity === cache.capacity) {
    crates.visible = cache.crateCount > 0;
    return;
  }
  const crateCount = salvage !== undefined ? salvage.handles.length : 0;
  if (salvage !== undefined) {
    for (let i = 0; i < crateCount; i++) {
      const x = salvage.x[i] ?? 0;
      const y = salvage.y[i] ?? 0;
      const groundY = terrainY(heights, mapWidth, mapHeight, x, y);
      writer.set(
        crates,
        i,
        x,
        groundY + SALVAGE_SIZE / 2,
        y,
        SALVAGE_SIZE,
        SALVAGE_SIZE,
        SALVAGE_SIZE,
      );
    }
  }
  commitMeshBuffers(crates, crateCount);
  cache.salvage = salvage;
  cache.heights = heights;
  cache.capacity = capacity;
  cache.crateCount = crateCount;
}

export function rebuildStructuresFull(
  channel: ConstructionStructures | undefined,
  localFaction: number | null,
  heights: ArrayLike<number>,
  mapWidth: number,
  mapHeight: number,
  db: ContentDb,
  isHostile: ((observer: number, faction: number) => boolean) | undefined,
  capacity: number,
  bevel: number,
  padMargin: number,
  padHeight: number,
  emissiveBoost: number,
  glyphYawRot: number,
  silRefs: Partial<Record<StructureSilhouette, THREE.InstancedMesh | null>>,
  glyphRefs: Partial<Record<ActiveGlyph, THREE.InstancedMesh | null>>,
  dimAttrs: Partial<Record<StructureSilhouette, THREE.InstancedBufferAttribute>>,
  bpMesh: THREE.InstancedMesh,
  waitMesh: THREE.InstancedMesh,
  statusMesh: THREE.InstancedMesh | null,
  padMesh: THREE.InstancedMesh | null,
  silCounts: Record<StructureSilhouette, number>,
  glyphCounts: Record<ActiveGlyph, number>,
  writer: InstanceWriter,
  color: THREE.Color,
  cache: StructCache,
): void {
  resetSilhouetteCounts(silCounts);
  resetGlyphCounts(glyphCounts);
  let bpCount = 0;
  let waitCount = 0;
  let statusCount = 0;
  let padCount = 0;

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
        writer.set(
          bpMesh,
          bpCount,
          cx,
          groundY + (full * 0.5) / 2,
          cy,
          w * 0.9,
          full * 0.5,
          h * 0.9,
        );
        color.set(factionColorHex(faction, localFaction));
        bpMesh.setColorAt(bpCount, color);
        bpCount += 1;
        continue;
      }

      if (state === STATE_WAITING) {
        writer.set(
          waitMesh,
          waitCount,
          cx,
          groundY + (full * 0.5) / 2,
          cy,
          w * 0.9,
          full * 0.5,
          h * 0.9,
        );
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
      const silMesh = silRefs[silhouette];
      if (silMesh !== undefined && silMesh !== null) {
        const slot = silCounts[silhouette];
        writer.set(silMesh, slot, cx, groundY, cy, w * 0.92, full * heightScale, h * 0.92);
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
      if (padMesh !== null && state !== STATE_RUIN) {
        writer.set(
          padMesh,
          padCount,
          cx,
          groundY - 0.04 + padHeight / 2,
          cy,
          w + padMargin * 2,
          padHeight,
          h + padMargin * 2,
        );
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
        writer.setEuler(
          statusMesh,
          statusCount,
          cx,
          groundY + full + 0.55,
          cy,
          0,
          glyphYawRot,
          0,
          0.22,
          0.22,
          0.22,
        );
        statusCount += 1;
      }

      const glyph = kind.visual.glyph;
      if (state === STATE_OPERATIONAL && glyph !== 'none') {
        const gMesh = glyphRefs[glyph];
        if (gMesh !== undefined && gMesh !== null) {
          const gSlot = glyphCounts[glyph];
          const badgeSize = Math.max(0.42, Math.min(w, h) * 0.34);
          writer.setEuler(
            gMesh,
            gSlot,
            cx,
            groundY + full + 0.06,
            cy,
            0,
            glyphYawRot,
            0,
            badgeSize,
            1,
            badgeSize,
          );
          color.set(resolveGlyphTint(faction, localFaction, isHostile));
          // HDR tint so roof glyphs feed bloom.
          color.multiplyScalar(emissiveBoost);
          gMesh.setColorAt(gSlot, color);
          glyphCounts[glyph] = gSlot + 1;
        }
      }
    }
  }

  for (const s of STRUCTURE_SILHOUETTES) {
    const silMesh = silRefs[s];
    const count = silCounts[s];
    if (silMesh !== undefined && silMesh !== null) {
      commitMeshBuffers(silMesh, count);
    }
    const dimAttr = dimAttrs[s];
    if (dimAttr !== undefined) {
      commitDimAttr(dimAttr, count);
    }
    cache.silCounts[s] = count;
  }
  for (const g of ACTIVE_STRUCTURE_GLYPHS) {
    const gMesh = glyphRefs[g];
    const count = glyphCounts[g];
    if (gMesh !== undefined && gMesh !== null) {
      commitMeshBuffers(gMesh, count);
    }
    cache.glyphCounts[g] = count;
  }

  if (statusMesh !== null) {
    commitMeshBuffers(statusMesh, statusCount);
  }
  commitMeshBuffers(bpMesh, bpCount);
  commitMeshBuffers(waitMesh, waitCount);
  if (padMesh !== null) {
    commitMeshBuffers(padMesh, padCount);
  }

  cache.channel = channel;
  cache.localFaction = localFaction;
  cache.heights = heights;
  cache.isHostile = isHostile;
  cache.capacity = capacity;
  cache.bevel = bevel;
  cache.bpCount = bpCount;
  cache.waitCount = waitCount;
  cache.statusCount = statusCount;
  cache.padCount = padCount;
  cache.yaw = glyphYawRot;
}

export function updateStructureYawOnly(
  channel: ConstructionStructures | undefined,
  heights: ArrayLike<number>,
  mapWidth: number,
  mapHeight: number,
  db: ContentDb,
  capacity: number,
  glyphYawRot: number,
  glyphRefs: Partial<Record<ActiveGlyph, THREE.InstancedMesh | null>>,
  statusMesh: THREE.InstancedMesh | null,
  glyphCounts: Record<ActiveGlyph, number>,
  writer: InstanceWriter,
  cache: StructCache,
): void {
  resetGlyphCounts(glyphCounts);
  let statusCount = 0;

  if (channel !== undefined) {
    for (let i = 0; i < channel.handles.length; i++) {
      const kindIndex = channel.kind[i] ?? 0;
      const kind = db.structures.byIndex(kindIndex);
      if (kind === undefined) {
        continue;
      }
      const state = channel.state[i] ?? 0;
      if (state !== STATE_OPERATIONAL) {
        continue;
      }
      const w = kind.footprint.w;
      const h = kind.footprint.h;
      const cx = (channel.x[i] ?? 0) + w / 2;
      const cy = (channel.y[i] ?? 0) + h / 2;
      const groundY = terrainY(heights, mapWidth, mapHeight, cx, cy);
      const full = structureKindHeight(db, kindIndex);

      if (statusMesh !== null && (channel.hpBp[i] ?? 10000) < 9000 && statusCount < capacity) {
        writer.setEuler(
          statusMesh,
          statusCount,
          cx,
          groundY + full + 0.55,
          cy,
          0,
          glyphYawRot,
          0,
          0.22,
          0.22,
          0.22,
        );
        statusCount += 1;
      }

      const glyph = kind.visual.glyph;
      if (glyph !== 'none') {
        const gMesh = glyphRefs[glyph];
        if (gMesh !== undefined && gMesh !== null) {
          const gSlot = glyphCounts[glyph];
          const badgeSize = Math.max(0.42, Math.min(w, h) * 0.34);
          writer.setEuler(
            gMesh,
            gSlot,
            cx,
            groundY + full + 0.06,
            cy,
            0,
            glyphYawRot,
            0,
            badgeSize,
            1,
            badgeSize,
          );
          glyphCounts[glyph] = gSlot + 1;
        }
      }
    }
  }

  if (statusMesh !== null && statusCount > 0) {
    statusMesh.instanceMatrix.clearUpdateRanges();
    statusMesh.instanceMatrix.addUpdateRange(0, statusCount * 16);
    statusMesh.instanceMatrix.needsUpdate = true;
  }
  for (const g of ACTIVE_STRUCTURE_GLYPHS) {
    const count = glyphCounts[g];
    const gMesh = glyphRefs[g];
    if (count > 0 && gMesh !== undefined && gMesh !== null) {
      gMesh.instanceMatrix.clearUpdateRanges();
      gMesh.instanceMatrix.addUpdateRange(0, count * 16);
      gMesh.instanceMatrix.needsUpdate = true;
    }
  }
  cache.yaw = glyphYawRot;
}
