// Procedural compound silhouettes for structures (ADR 0050): pure geometry
// builder returning unit-box buffers (x, z in [-0.5, 0.5], base at y = 0,
// top <= 1.0) with outward-wound triangles and neutral vertex grayscale
// shading so MeshLambertMaterial({ vertexColors: true }) multiplies cleanly
// with instanceColor.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { STRUCTURE_SILHOUETTES, type StructureSilhouette } from '../content';

type Vec3 = readonly [number, number, number];

// Vertex slots: 0 = body, 1 = trim, 2 = faction accent, 3 = emissive.
// The themed structure material maps slots to palette colors; the legacy
// material ignores the attribute entirely.
type PartSlot = 0 | 1 | 2 | 3;

const BEVEL_SEGMENTS = 2;

class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly norm: number[] = [];
  private readonly col: number[] = [];
  private readonly slots: number[] = [];
  private readonly idx: number[] = [];

  // Chamfer radius in unit-box space; 0 keeps razor-sharp boxes (legacy).
  private readonly bevel: number;
  constructor(bevel = 0) {
    this.bevel = bevel;
  }

  private pushVertex(p: Vec3, n: Vec3, shade: number, slot: PartSlot): number {
    const v = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.norm.push(n[0], n[1], n[2]);
    this.col.push(shade, shade, shade);
    this.slots.push(slot);
    return v;
  }

  private pushTri(a: Vec3, b: Vec3, c: Vec3, n: Vec3, shade: number, slot: PartSlot): void {
    const ia = this.pushVertex(a, n, shade, slot);
    const ib = this.pushVertex(b, n, shade, slot);
    const ic = this.pushVertex(c, n, shade, slot);
    this.idx.push(ia, ib, ic);
  }

  private pushQuad(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    n: Vec3,
    shade: number,
    slot: PartSlot,
  ): void {
    const ia = this.pushVertex(a, n, shade, slot);
    const ib = this.pushVertex(b, n, shade, slot);
    const ic = this.pushVertex(c, n, shade, slot);
    const id = this.pushVertex(d, n, shade, slot);
    this.idx.push(ia, ib, ic, ia, ic, id);
  }

  // Bake an arbitrary generated BufferGeometry (indexed) into the merged
  // buffers at a translation — used for chamfered primitives whose
  // topology comes from three's geometry helpers.
  private bake(
    geo: THREE.BufferGeometry,
    ox: number,
    oy: number,
    oz: number,
    shade: number,
    slot: PartSlot,
  ): void {
    const posAttr = geo.getAttribute('position');
    const normAttr = geo.getAttribute('normal');
    // RoundedBoxGeometry is non-indexed; emit sequential triangles.
    const index = geo.getIndex();
    const base = this.pos.length / 3;
    for (let i = 0; i < posAttr.count; i++) {
      this.pos.push(posAttr.getX(i) + ox, posAttr.getY(i) + oy, posAttr.getZ(i) + oz);
      this.norm.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
      this.col.push(shade, shade, shade);
      this.slots.push(slot);
    }
    const triCount = index === null ? posAttr.count : index.count;
    for (let i = 0; i < triCount; i++) {
      this.idx.push(base + (index === null ? i : index.getX(i)));
    }
  }

  pushBox(
    cx: number,
    y0: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    shade: number,
    slot: PartSlot = 0,
  ): void {
    const minDim = Math.min(sx, sy, sz);
    // Hard-surface chamfer: ~5% of the part's smallest dimension — enough
    // to catch a highlight line, far from the rounded "inflatable" look.
    const r = Math.min(this.bevel, minDim * 0.05);
    if (r > 1e-4) {
      const rounded = new RoundedBoxGeometry(sx, sy, sz, BEVEL_SEGMENTS, r);
      this.bake(rounded, cx, y0 + sy / 2, cz, shade, slot);
      rounded.dispose();
      return;
    }
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y1 = y0 + sy;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    // +Y top
    this.pushQuad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], shade, slot);
    // -Y bottom
    this.pushQuad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], shade, slot);
    // +Z front
    this.pushQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], shade, slot);
    // -Z back
    this.pushQuad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], shade, slot);
    // +X right
    this.pushQuad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], shade, slot);
    // -X left
    this.pushQuad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], shade, slot);
  }

  pushCylinderPrism(
    cx: number,
    y0: number,
    cz: number,
    rBot: number,
    rTop: number,
    sy: number,
    sides: number,
    shade: number,
    rotY = 0,
    slot: PartSlot = 0,
  ): void {
    const y1 = y0 + sy;
    const step = (Math.PI * 2) / sides;
    const cTop: Vec3 = [cx, y1, cz];
    const cBot: Vec3 = [cx, y0, cz];

    for (let k = 0; k < sides; k++) {
      const a0 = rotY + k * step;
      const a1 = rotY + (k + 1) * step;
      const cos0 = Math.cos(a0);
      const sin0 = Math.sin(a0);
      const cos1 = Math.cos(a1);
      const sin1 = Math.sin(a1);

      const b0: Vec3 = [cx + rBot * cos0, y0, cz + rBot * sin0];
      const b1: Vec3 = [cx + rBot * cos1, y0, cz + rBot * sin1];
      const t0: Vec3 = [cx + rTop * cos0, y1, cz + rTop * sin0];
      const t1: Vec3 = [cx + rTop * cos1, y1, cz + rTop * sin1];

      const n = faceNormal(b1, b0, rTop > 1e-6 ? t0 : cTop);
      if (rTop <= 1e-6) {
        this.pushTri(b1, b0, cTop, n, shade, slot);
      } else if (rBot <= 1e-6) {
        this.pushTri(cBot, t0, t1, faceNormal(cBot, t0, t1), shade, slot);
      } else {
        this.pushQuad(b1, b0, t0, t1, n, shade, slot);
      }

      if (rTop > 1e-6) {
        this.pushTri(cTop, t1, t0, [0, 1, 0], shade, slot);
      }
      if (rBot > 1e-6) {
        this.pushTri(cBot, b0, b1, [0, -1, 0], shade, slot);
      }
    }
  }

  finish(): {
    positions: Float32Array;
    normals: Float32Array;
    colors: Float32Array;
    slots: Float32Array;
    indices: Uint16Array;
  } {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.norm),
      colors: new Float32Array(this.col),
      slots: new Float32Array(this.slots),
      indices: new Uint16Array(this.idx),
    };
  }
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const e1x = b[0] - a[0];
  const e1y = b[1] - a[1];
  const e1z = b[2] - a[2];
  const e2x = c[0] - a[0];
  const e2y = c[1] - a[1];
  const e2z = c[2] - a[2];
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function populateSilhouette(b: MeshBuilder, silhouette: StructureSilhouette): void {
  switch (silhouette) {
    case 'block':
      b.pushBox(0, 0, 0, 0.98, 0.14, 0.98, 0.78, 1);
      b.pushBox(0, 0.14, 0, 0.92, 0.86, 0.92, 1.0);
      return;

    case 'hq_citadel':
      b.pushBox(0, 0, 0, 0.98, 0.16, 0.98, 0.68, 1);
      for (const sx of [-0.34, 0.34]) {
        for (const sz of [-0.34, 0.34]) {
          b.pushBox(sx, 0.16, sz, 0.22, 0.44, 0.22, 0.86);
        }
      }
      b.pushBox(0, 0.16, 0, 0.64, 0.5, 0.64, 0.95);
      // Thin accent band under the roof cap — a stripe of faction colour,
      // not a whole striped top face.
      b.pushCylinderPrism(0, 0.64, 0, 0.27, 0.27, 0.05, 8, 1.06, Math.PI / 8, 2);
      b.pushCylinderPrism(0, 0.69, 0, 0.26, 0.2, 0.19, 8, 1.08, Math.PI / 8);
      b.pushCylinderPrism(0, 0.88, 0, 0.08, 0.03, 0.12, 8, 1.15, 0, 3);
      return;

    case 'rail_hub':
      b.pushBox(0, 0, 0, 0.98, 0.14, 0.98, 0.66, 1);
      b.pushBox(0, 0.14, -0.28, 0.92, 0.34, 0.26, 0.92);
      b.pushBox(0, 0.14, 0.28, 0.92, 0.34, 0.26, 0.92);
      b.pushBox(0, 0.48, 0, 0.44, 0.3, 0.78, 1.06, 2);
      b.pushCylinderPrism(-0.14, 0.78, 0, 0.035, 0.02, 0.22, 6, 1.14, 0, 3);
      b.pushCylinderPrism(0.14, 0.78, 0, 0.035, 0.02, 0.22, 6, 1.14, 0, 3);
      return;

    case 'twin_depot':
      b.pushBox(0, 0, 0, 0.98, 0.14, 0.98, 0.66, 1);
      b.pushBox(-0.24, 0.14, 0, 0.38, 0.56, 0.88, 0.96);
      b.pushBox(0.24, 0.14, 0, 0.38, 0.56, 0.88, 0.96);
      b.pushBox(0, 0.42, 0, 0.28, 0.3, 0.52, 1.08, 2);
      b.pushBox(-0.24, 0.7, 0.16, 0.2, 0.18, 0.28, 1.12, 3);
      b.pushBox(0.24, 0.7, -0.16, 0.2, 0.18, 0.28, 1.12, 3);
      return;

    case 'octagon_fort':
      b.pushCylinderPrism(0, 0, 0, 0.5, 0.47, 0.22, 8, 0.68, Math.PI / 8, 1);
      b.pushCylinderPrism(0, 0.22, 0, 0.43, 0.38, 0.42, 8, 0.92, Math.PI / 8);
      b.pushCylinderPrism(0, 0.64, 0, 0.26, 0.24, 0.2, 8, 1.06, Math.PI / 8, 2);
      b.pushCylinderPrism(0, 0.84, 0, 0.16, 0.08, 0.16, 8, 1.14, 0, 3);
      return;

    case 'drill_rig':
      b.pushBox(0, 0, 0, 0.96, 0.14, 0.96, 0.64, 1);
      for (const sx of [-0.32, 0.32]) {
        for (const sz of [-0.32, 0.32]) {
          b.pushBox(sx, 0.14, sz, 0.12, 0.66, 0.12, 0.88, 1);
        }
      }
      b.pushBox(0, 0.8, 0, 0.78, 0.14, 0.78, 1.04);
      b.pushCylinderPrism(0, 0.14, 0, 0.08, 0.24, 0.66, 8, 1.12, 0, 2);
      b.pushBox(0, 0.94, 0, 0.32, 0.06, 0.32, 1.15, 3);
      return;

    case 'reactor_pair':
      b.pushBox(0, 0, 0, 0.98, 0.14, 0.94, 0.65, 1);
      b.pushBox(0, 0.14, 0.26, 0.82, 0.36, 0.34, 0.88);
      b.pushCylinderPrism(-0.24, 0.14, -0.14, 0.22, 0.17, 0.82, 12, 1.04);
      b.pushCylinderPrism(0.24, 0.14, -0.14, 0.22, 0.17, 0.82, 12, 1.04);
      b.pushBox(0, 0.5, 0.26, 0.42, 0.18, 0.22, 1.12, 2);
      b.pushBox(0, 0.68, 0.26, 0.3, 0.06, 0.14, 1.15, 3);
      return;

    case 'foundry_press':
      b.pushBox(0, 0, 0, 0.98, 0.16, 0.96, 0.64, 1);
      b.pushBox(0, 0.16, 0.06, 0.86, 0.46, 0.72, 0.9);
      b.pushBox(0, 0.62, 0.06, 0.62, 0.24, 0.44, 1.06, 2);
      b.pushCylinderPrism(-0.28, 0.16, -0.32, 0.1, 0.08, 0.84, 8, 1.12, 0, 1);
      b.pushCylinderPrism(0.28, 0.16, -0.32, 0.1, 0.08, 0.84, 8, 1.12, 0, 1);
      return;

    case 'turret_mount':
      b.pushCylinderPrism(0, 0, 0, 0.48, 0.42, 0.22, 8, 0.66, Math.PI / 8, 1);
      b.pushCylinderPrism(0, 0.22, 0, 0.34, 0.3, 0.36, 10, 0.94);
      b.pushBox(0, 0.58, -0.02, 0.42, 0.26, 0.46, 1.08, 2);
      b.pushBox(0, 0.64, 0.32, 0.14, 0.12, 0.32, 1.14, 1);
      b.pushCylinderPrism(0, 0.84, -0.06, 0.1, 0.07, 0.14, 8, 1.12, 0, 3);
      return;

    case 'gantry_bay':
      b.pushBox(0, 0, 0, 0.98, 0.12, 0.98, 0.64, 1);
      b.pushBox(-0.34, 0.12, 0, 0.24, 0.58, 0.88, 0.88);
      b.pushBox(0.34, 0.12, 0, 0.24, 0.58, 0.88, 0.88);
      b.pushBox(0, 0.7, 0, 0.92, 0.18, 0.42, 1.08, 1);
      b.pushBox(0, 0.88, 0, 0.36, 0.12, 0.34, 1.14, 2);
      b.pushBox(0, 0.12, 0, 0.3, 0.36, 0.46, 0.96, 3);
      return;

    case 'bio_spire':
      b.pushCylinderPrism(0, 0, 0, 0.49, 0.38, 0.22, 6, 0.62, 0, 1);
      b.pushCylinderPrism(-0.24, 0.14, 0.18, 0.14, 0.04, 0.44, 6, 0.84, 0.4);
      b.pushCylinderPrism(0.24, 0.14, 0.16, 0.14, 0.04, 0.48, 6, 0.84, 0.1);
      b.pushCylinderPrism(0, 0.14, -0.26, 0.15, 0.04, 0.52, 6, 0.86, 0.2);
      b.pushCylinderPrism(0, 0.22, 0, 0.26, 0.1, 0.64, 6, 1.0, Math.PI / 6, 2);
      b.pushCylinderPrism(0, 0.86, 0, 0.11, 0.03, 0.14, 6, 1.15, 0, 3);
      return;
  }
}

export function buildSilhouetteGeometryData(
  silhouette: StructureSilhouette,
  bevel = 0,
): {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  slots: Float32Array;
  indices: Uint16Array;
} {
  const builder = new MeshBuilder(bevel);
  populateSilhouette(builder, silhouette);
  return builder.finish();
}

// Per-theme geometry set: `bevel` is the language's chamfer radius
// (RoundedBoxGeometry) applied to every MeshBuilder box part.
export function createSilhouetteGeometries(
  bevel = 0,
): Record<StructureSilhouette, THREE.BufferGeometry> {
  const record: Partial<Record<StructureSilhouette, THREE.BufferGeometry>> = {};
  for (const silhouette of STRUCTURE_SILHOUETTES) {
    const data = buildSilhouetteGeometryData(silhouette, bevel);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute('aSlot', new THREE.BufferAttribute(data.slots, 1));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.userData['shared'] = true;
    record[silhouette] = geo;
  }
  return record as Record<StructureSilhouette, THREE.BufferGeometry>;
}

export function disposeSilhouetteGeometries(
  geos: Record<StructureSilhouette, THREE.BufferGeometry>,
): void {
  for (const silhouette of STRUCTURE_SILHOUETTES) {
    geos[silhouette].dispose();
  }
}
