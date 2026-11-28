// Dynamic line-segment buffers (render perf): position/color/lineDistance
// attributes are allocated once at capacity and written in place each frame —
// `setDrawRange` limits the drawn vertices, `addUpdateRange` + `needsUpdate`
// upload only the active slice, and `boundingSphere` is initialized once so
// `WebGLRenderer.projectObject` never rescans unused capacity. Exceeding
// capacity disposes the geometry (frees GPU buffers) and reallocates at
// double size. Components must dispose the geometry on unmount.
import * as THREE from 'three';

const DEFAULT_BOUNDING_CENTER = new THREE.Vector3(128, 0, 128);
const DEFAULT_BOUNDING_RADIUS = 1024;

export interface LineBuffer {
  geometry: THREE.BufferGeometry;
  // Write targets; replaced on grow, so always index the current refs.
  positions: Float32Array;
  colors: Float32Array | null;
  lineDistances: Float32Array | null;
  capacity: number; // vertices
}

function installAttributes(buf: LineBuffer): void {
  const position = new THREE.BufferAttribute(buf.positions, 3);
  position.setUsage(THREE.DynamicDrawUsage);
  buf.geometry.setAttribute('position', position);
  if (buf.colors !== null) {
    const color = new THREE.BufferAttribute(buf.colors, 3);
    color.setUsage(THREE.DynamicDrawUsage);
    buf.geometry.setAttribute('color', color);
  }
  if (buf.lineDistances !== null) {
    const lineDistance = new THREE.BufferAttribute(buf.lineDistances, 1);
    lineDistance.setUsage(THREE.DynamicDrawUsage);
    buf.geometry.setAttribute('lineDistance', lineDistance);
  }
  buf.geometry.setDrawRange(0, 0);
  buf.geometry.boundingSphere = new THREE.Sphere(
    DEFAULT_BOUNDING_CENTER.clone(),
    DEFAULT_BOUNDING_RADIUS,
  );
}

export function createLineBuffer(
  capacityVertices: number,
  colored: boolean,
  dashed = false,
): LineBuffer {
  const buf: LineBuffer = {
    geometry: new THREE.BufferGeometry(),
    positions: new Float32Array(capacityVertices * 3),
    colors: colored ? new Float32Array(capacityVertices * 3) : null,
    lineDistances: dashed ? new Float32Array(capacityVertices) : null,
    capacity: capacityVertices,
  };
  installAttributes(buf);
  return buf;
}

// Grow to hold at least `vertices` (capacity doubles). The geometry is
// disposed so the previous upload buffers are released; it re-initializes
// on the next render.
export function ensureLineCapacity(buf: LineBuffer, vertices: number): void {
  if (vertices <= buf.capacity) {
    return;
  }
  let capacity = buf.capacity;
  while (capacity < vertices) {
    capacity *= 2;
  }
  buf.geometry.dispose();
  buf.positions = new Float32Array(capacity * 3);
  buf.colors = buf.colors === null ? null : new Float32Array(capacity * 3);
  buf.lineDistances = buf.lineDistances === null ? null : new Float32Array(capacity);
  buf.capacity = capacity;
  installAttributes(buf);
}

// Disposes R3F's initial default empty geometry before binding `buf.geometry`.
export function bindLineBuffer(lines: THREE.LineSegments, buf: LineBuffer): void {
  if (lines.geometry !== buf.geometry) {
    lines.geometry.dispose();
    lines.geometry = buf.geometry;
  }
}

// Call after writing `vertices` xyz triples into the arrays.
export function commitLineBuffer(buf: LineBuffer, vertices: number): void {
  const count = Math.max(0, Math.min(vertices, buf.capacity));
  buf.geometry.setDrawRange(0, count);
  if (count === 0) {
    return;
  }
  const floatCount = count * 3;
  const position = buf.geometry.getAttribute('position');
  if (position instanceof THREE.BufferAttribute) {
    position.clearUpdateRanges();
    position.addUpdateRange(0, floatCount);
    position.needsUpdate = true;
  }
  const color = buf.geometry.getAttribute('color');
  if (color instanceof THREE.BufferAttribute) {
    color.clearUpdateRanges();
    color.addUpdateRange(0, floatCount);
    color.needsUpdate = true;
  }
}

// Computes pairwise segment distances into the preallocated `lineDistance`
// attribute for `LineDashedMaterial` without calling `LineSegments.computeLineDistances`
// (which scans full capacity and leaks a BufferAttribute GPU buffer per call).
export function commitLineDistances(buf: LineBuffer, vertices: number): void {
  const distances = buf.lineDistances;
  if (distances === null) {
    return;
  }
  const count = Math.max(0, Math.min(vertices, buf.capacity));
  if (count === 0) {
    return;
  }
  const pos = buf.positions;
  for (let i = 0; i + 1 < count; i += 2) {
    const a = i * 3;
    const b = a + 3;
    const dx = (pos[b] ?? 0) - (pos[a] ?? 0);
    const dy = (pos[b + 1] ?? 0) - (pos[a + 1] ?? 0);
    const dz = (pos[b + 2] ?? 0) - (pos[a + 2] ?? 0);
    const startDist = i === 0 ? 0 : (distances[i - 1] ?? 0);
    distances[i] = startDist;
    distances[i + 1] = startDist + Math.hypot(dx, dy, dz);
  }
  const attr = buf.geometry.getAttribute('lineDistance');
  if (attr instanceof THREE.BufferAttribute) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, count);
    attr.needsUpdate = true;
  }
}
