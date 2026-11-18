// Dynamic line-segment buffers (render perf): position/color attributes
// are allocated once at capacity and written in place each frame —
// `setDrawRange` limits the drawn vertices, `needsUpdate` re-uploads.
// Exceeding capacity disposes the geometry (frees GPU buffers) and
// reallocates at double size. Components must dispose the geometry on
// unmount.
import * as THREE from 'three';

export interface LineBuffer {
  geometry: THREE.BufferGeometry;
  // Write targets; replaced on grow, so always index the current refs.
  positions: Float32Array;
  colors: Float32Array | null;
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
  buf.geometry.setDrawRange(0, 0);
}

export function createLineBuffer(capacityVertices: number, colored: boolean): LineBuffer {
  const buf: LineBuffer = {
    geometry: new THREE.BufferGeometry(),
    positions: new Float32Array(capacityVertices * 3),
    colors: colored ? new Float32Array(capacityVertices * 3) : null,
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
  buf.capacity = capacity;
  installAttributes(buf);
}

// Call after writing `vertices` xyz triples into the arrays.
export function commitLineBuffer(buf: LineBuffer, vertices: number): void {
  buf.geometry.setDrawRange(0, vertices);
  const position = buf.geometry.getAttribute('position');
  if (position instanceof THREE.BufferAttribute) {
    position.needsUpdate = true;
  }
  const color = buf.geometry.getAttribute('color');
  if (color instanceof THREE.BufferAttribute) {
    color.needsUpdate = true;
  }
  buf.geometry.computeBoundingSphere();
}
