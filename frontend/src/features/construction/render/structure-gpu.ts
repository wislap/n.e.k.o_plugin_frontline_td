// Structure-layer GPU assets and per-frame helpers (ADR 0050): shared
// silhouette geometries + glyph materials lifecycle, instanced-buffer
// bookkeeping, glyph opacity/tint rules, and the content-db height query.
// Extracted from StructuresLayer so the layer file is just the component.
import * as THREE from 'three';
import type { ContentDb } from '../../../content/index';
import { STRUCTURE_SILHOUETTES, type StructureSilhouette } from '../content';
import { createSilhouetteGeometries, disposeSilhouetteGeometries } from './structure-geometries';
import {
  ACTIVE_STRUCTURE_GLYPHS,
  createGlyphMaterials,
  type GlyphMaterialEntry,
} from './structure-glyphs';

export const STATUS_COLOR = '#ffb84d';
export const SALVAGE_SIZE = 0.3;
export const SALVAGE_COLOR = '#8a6a3f';
export const SITE_DARKEN = 0.45;
export const DEMOLISH_DARKEN = 0.4;
// Outposts read as squat fortified pads; ruins are faction-neutral rubble.
export const OUTPOST_TINT = 0.8;
export const RUIN_COLOR = '#3a3430';
export const RUIN_HEIGHT = 0.3;
export const AMBER_COLOR = new THREE.Color('#ffb84d');
const GLYPH_OWN_COLOR = '#9be2ff';
const GLYPH_HOSTILE_COLOR = '#ff8a80';
const GLYPH_ALLY_COLOR = '#8ce8b8';

export type ActiveGlyph = (typeof ACTIVE_STRUCTURE_GLYPHS)[number];

export interface StructureGpuAssets {
  geos: Record<StructureSilhouette, THREE.BufferGeometry>;
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

export function resetSilhouetteCounts(counts: Record<StructureSilhouette, number>): void {
  for (const s of STRUCTURE_SILHOUETTES) {
    counts[s] = 0;
  }
}

export function resetGlyphCounts(counts: Record<ActiveGlyph, number>): void {
  for (const g of ACTIVE_STRUCTURE_GLYPHS) {
    counts[g] = 0;
  }
}

export function ensureGpuAssets(
  gpuRef: { current: StructureGpuAssets | null },
  bevel: number,
): StructureGpuAssets {
  if (gpuRef.current !== null && gpuRef.current.bevel !== bevel) {
    disposeSilhouetteGeometries(gpuRef.current.geos);
    gpuRef.current = null;
  }
  if (gpuRef.current === null) {
    const roofGeo = new THREE.PlaneGeometry(1, 1);
    roofGeo.rotateX(-Math.PI / 2);
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
    const geo = gpu.geos[s];
    if (mesh.geometry !== geo) {
      // Silhouette geos are shared GPU assets (userData.shared); only the
      // default geometry R3F created for the mesh gets disposed here.
      if (mesh.geometry.userData['shared'] !== true) {
        mesh.geometry.dispose();
      }
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

export function updateGlyphOpacity(
  glyphs: Record<ActiveGlyph, GlyphMaterialEntry>,
  mode: 'spectate' | 'tactical',
  pitchDeg: number,
): void {
  const t = Math.max(0, Math.min(1, (pitchDeg - 26) / (70 - 26)));
  const opacity = mode === 'tactical' ? 0.94 : 0.45 + t * (0.72 - 0.45);
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
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) {
    mesh.instanceColor.needsUpdate = true;
  }
}

export function resolveGlyphTint(
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
