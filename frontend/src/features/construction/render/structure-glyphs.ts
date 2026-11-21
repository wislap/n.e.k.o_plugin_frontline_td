// Procedural roof tactical glyph badges for structures (ADR 0050 / ADR 0051):
// draws 128x128 high-contrast CanvasTexture badges at startup (100% offline,
// zero external assets) and disposes textures + materials on unmount.
import * as THREE from 'three';
import { STRUCTURE_GLYPHS, type StructureGlyph } from '../content';

type ActiveGlyph = Exclude<StructureGlyph, 'none'>;

export const ACTIVE_STRUCTURE_GLYPHS: readonly ActiveGlyph[] = STRUCTURE_GLYPHS.filter(
  (g): g is ActiveGlyph => g !== 'none',
);

export interface GlyphMaterialEntry {
  texture: THREE.CanvasTexture;
  material: THREE.MeshBasicMaterial;
}

const LOGICAL_SIZE = 64;
const CENTER = LOGICAL_SIZE / 2;
const TEX_SCALE = 2;
const BADGE_BG = 'rgba(6, 10, 18, 0.78)';
const BADGE_BORDER = 'rgba(235, 245, 255, 0.85)';
const SYMBOL_COLOR = '#ffffff';

function drawOctagonBadge(ctx: CanvasRenderingContext2D): void {
  const r = 27;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = CENTER + Math.cos(a) * r;
    const y = CENTER + Math.sin(a) * r;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = BADGE_BG;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = BADGE_BORDER;
  ctx.stroke();
}

function drawGlyphSymbol(ctx: CanvasRenderingContext2D, glyph: ActiveGlyph): void {
  ctx.strokeStyle = SYMBOL_COLOR;
  ctx.fillStyle = SYMBOL_COLOR;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.6;

  switch (glyph) {
    case 'core_star': {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? 17 : 6.5;
        const x = CENTER + Math.cos(a) * r;
        const y = CENTER + Math.sin(a) * r;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.fill();
      return;
    }

    case 'relay_arrows': {
      // Opposing horizontal transfer arrows.
      ctx.beginPath();
      ctx.moveTo(16, 25);
      ctx.lineTo(46, 25);
      ctx.lineTo(39, 18);
      ctx.moveTo(46, 25);
      ctx.lineTo(39, 32);
      ctx.moveTo(48, 39);
      ctx.lineTo(18, 39);
      ctx.lineTo(25, 32);
      ctx.moveTo(18, 39);
      ctx.lineTo(25, 46);
      ctx.stroke();
      return;
    }

    case 'supply_cross': {
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(CENTER, 17);
      ctx.lineTo(CENTER, 47);
      ctx.moveTo(17, CENTER);
      ctx.lineTo(47, CENTER);
      ctx.stroke();
      return;
    }

    case 'fort_shield': {
      ctx.beginPath();
      ctx.moveTo(CENTER, 15);
      ctx.lineTo(46, 20);
      ctx.lineTo(44, 34);
      ctx.lineTo(CENTER, 49);
      ctx.lineTo(20, 34);
      ctx.lineTo(18, 20);
      ctx.closePath();
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(CENTER, 21);
      ctx.lineTo(CENTER, 42);
      ctx.stroke();
      return;
    }

    case 'drill_tri': {
      ctx.beginPath();
      ctx.moveTo(18, 19);
      ctx.lineTo(46, 19);
      ctx.lineTo(CENTER, 47);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(23, 27);
      ctx.lineTo(41, 27);
      ctx.stroke();
      return;
    }

    case 'power_bolt': {
      ctx.beginPath();
      ctx.moveTo(35, 14);
      ctx.lineTo(20, 34);
      ctx.lineTo(31, 34);
      ctx.lineTo(28, 50);
      ctx.lineTo(44, 29);
      ctx.lineTo(33, 29);
      ctx.closePath();
      ctx.fill();
      return;
    }

    case 'ammo_diamond': {
      ctx.beginPath();
      ctx.moveTo(CENTER, 15);
      ctx.lineTo(47, CENTER);
      ctx.lineTo(CENTER, 49);
      ctx.lineTo(17, CENTER);
      ctx.closePath();
      ctx.stroke();
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(CENTER, 24);
      ctx.lineTo(CENTER, 40);
      ctx.stroke();
      return;
    }

    case 'reticle': {
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(CENTER, 14);
      ctx.lineTo(CENTER, 22);
      ctx.moveTo(CENTER, 42);
      ctx.lineTo(CENTER, 50);
      ctx.moveTo(14, CENTER);
      ctx.lineTo(22, CENTER);
      ctx.moveTo(42, CENTER);
      ctx.lineTo(50, CENTER);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, 2.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    case 'gantry_bot': {
      // Simplified visor chassis + twin antennae.
      ctx.lineWidth = 3.2;
      ctx.strokeRect(20, 24, 24, 20);
      ctx.beginPath();
      ctx.moveTo(25, 32);
      ctx.lineTo(39, 32);
      ctx.moveTo(26, 24);
      ctx.lineTo(24, 16);
      ctx.moveTo(38, 24);
      ctx.lineTo(40, 16);
      ctx.stroke();
      return;
    }

    case 'bio_hazard': {
      ctx.lineWidth = 3.4;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
        const cx = CENTER + Math.cos(a) * 8.5;
        const cy = CENTER + Math.sin(a) * 8.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 7.5, a - Math.PI * 0.72, a + Math.PI * 0.72);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, 3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
  }
}

export function createGlyphMaterials(): Record<ActiveGlyph, GlyphMaterialEntry> {
  const record: Partial<Record<ActiveGlyph, GlyphMaterialEntry>> = {};
  for (const glyph of ACTIVE_STRUCTURE_GLYPHS) {
    const canvas = document.createElement('canvas');
    canvas.width = LOGICAL_SIZE * TEX_SCALE;
    canvas.height = LOGICAL_SIZE * TEX_SCALE;
    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      ctx.scale(TEX_SCALE, TEX_SCALE);
      drawOctagonBadge(ctx);
      drawGlyphSymbol(ctx, glyph);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    record[glyph] = { texture, material };
  }
  return record as Record<ActiveGlyph, GlyphMaterialEntry>;
}

export function disposeGlyphMaterials(glyphs: Record<ActiveGlyph, GlyphMaterialEntry>): void {
  for (const glyph of ACTIVE_STRUCTURE_GLYPHS) {
    glyphs[glyph].material.dispose();
    glyphs[glyph].texture.dispose();
  }
}
