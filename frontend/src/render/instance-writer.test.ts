import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { InstanceWriter } from './instance-writer';

function worldExtents(
  mesh: THREE.InstancedMesh,
  index: number,
): { x: number; y: number; z: number } {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  const geo = mesh.geometry;
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (box === null) {
    throw new Error('geometry has no bounding box');
  }
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
  const world = new THREE.Box3();
  for (const c of corners) {
    world.expandByPoint(c.applyMatrix4(matrix));
  }
  const size = world.getSize(new THREE.Vector3());
  return { x: size.x, y: size.y, z: size.z };
}

describe('InstanceWriter', () => {
  it('set writes position and scale', () => {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
      1,
    );
    new InstanceWriter().set(mesh, 0, 3, 4, 5, 2, 3, 4);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.toArray()).toEqual([3, 4, 5]);
    expect(worldExtents(mesh, 0)).toEqual({ x: 2, y: 3, z: 4 });
  });

  it('setFlat gives an XY-plane ring circular world-space extent', () => {
    const mesh = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.9, 1, 16),
      new THREE.MeshBasicMaterial(),
      1,
    );
    const writer = new InstanceWriter();
    const scale = 2.5;
    writer.setFlat(mesh, 0, 10, 1, 20, scale, scale);
    const ext = worldExtents(mesh, 0);
    // Local X maps to world X and local Y to world Z, so a ring scaled by
    // `scale` on both ground axes keeps a circular footprint: equal X and Z
    // extents and zero height.
    expect(ext.x).toBeCloseTo(scale * 2, 5);
    expect(ext.z).toBeCloseTo(scale * 2, 5);
    expect(ext.y).toBeCloseTo(0, 5);
  });

  it('setFlat honours non-uniform ground scale', () => {
    const mesh = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.9, 1, 16),
      new THREE.MeshBasicMaterial(),
      1,
    );
    new InstanceWriter().setFlat(mesh, 0, 0, 0, 0, 2, 5);
    const ext = worldExtents(mesh, 0);
    expect(ext.x).toBeCloseTo(4, 5);
    expect(ext.z).toBeCloseTo(10, 5);
  });

  it('a flat write does not leak rotation into the next upright write', () => {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
      2,
    );
    const writer = new InstanceWriter();
    writer.setFlat(mesh, 0, 0, 0, 0, 3, 3);
    writer.set(mesh, 1, 0, 0, 0, 1, 1, 1);
    expect(worldExtents(mesh, 1)).toEqual({ x: 1, y: 1, z: 1 });
  });
});
