// Runtime-generated printed-code decal atlas (visual-languages): a
// CanvasTexture of fake stencil markings (code blocks, bar ticks, small
// glyphs) sampled by the themed structure material on top faces. No
// network assets — everything is drawn procedurally and deterministic.
import * as THREE from 'three';

const ATLAS_W = 256;
const ATLAS_H = 64;
const COLS = 8;

function hash(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d);
    s = Math.imul(s ^ (s >>> 12), 0x297a2d39);
    s ^= s >>> 15;
    return (s >>> 0) / 4294967296;
  };
}

// Draws COLS rows of "printed codes": a bold mark, a row of letter-like
// blocks and a bar-code strip. Sampled with uv.x = local x (0..1 across a
// face), uv.y = row pick — the shader reads one cell of the atlas.
export function createCodesTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return new THREE.CanvasTexture(canvas);
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
  ctx.fillStyle = '#ffffff';
  const rnd = hash(0xc0ffee);
  const rowH = ATLAS_H;
  const colW = ATLAS_W / COLS;
  for (let row = 0; row < 1; row++) {
    for (let c = 0; c < COLS; c++) {
      const x0 = c * colW;
      // Glyph mark: 1-3 blocky characters made of small rects.
      const glyphCount = 1 + Math.floor(rnd() * 3);
      for (let g = 0; g < glyphCount; g++) {
        const gx = x0 + 2 + g * 7;
        for (let b = 0; b < 6; b++) {
          if (rnd() < 0.55) {
            ctx.fillRect(gx + (b % 3) * 2, 2 + Math.floor(b / 3) * 4, 2, 3);
          }
        }
      }
      // Letter row: short bars like tiny text.
      let tx = x0 + 2;
      while (tx < x0 + colW - 6) {
        const w = 1 + Math.floor(rnd() * 4);
        if (rnd() < 0.8) {
          ctx.fillRect(tx, rowH * 0.45 + row * 0, w, 2);
        }
        tx += w + 1 + Math.floor(rnd() * 2);
      }
      // Bar-code strip.
      let bx = x0 + 2;
      while (bx < x0 + colW - 6) {
        const w = rnd() < 0.5 ? 1 : 2;
        if (rnd() < 0.75) {
          ctx.fillRect(bx, rowH - 8, w, 6);
        }
        bx += w + 1 + Math.floor(rnd() * 3);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
