// Shared InstancedMesh matrix writer: one scratch Object3D per layer
// instead of a bare `dummy`, with named methods for the poses the layers
// actually use. Every method sets position + rotation + scale explicitly
// so stale state can never leak between writes.

import * as THREE from 'three';

const FLAT_ROT_X = -Math.PI / 2;

// Structural: any InstancedMesh regardless of its generic parameters.
type MatrixTarget = Pick<THREE.InstancedMesh, 'setMatrixAt'>;

export class InstanceWriter {
  private readonly dummy = new THREE.Object3D();

  /** Upright instance: identity rotation, optional non-uniform scale. */
  set(
    mesh: MatrixTarget,
    index: number,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
  ): void {
    const d = this.dummy;
    d.position.set(x, y, z);
    d.rotation.set(0, 0, 0);
    d.scale.set(sx, sy, sz);
    d.updateMatrix();
    mesh.setMatrixAt(index, d.matrix);
  }

  /**
   * XY-plane geometry (rings/discs) laid flat on the ground. The -90° X
   * rotation maps local X → world X and local Y → world Z, so `sz` scales
   * the local Y axis — that is the ground-plane axis, not local Z.
   */
  setFlat(
    mesh: MatrixTarget,
    index: number,
    x: number,
    groundY: number,
    z: number,
    sx: number,
    sz: number,
  ): void {
    const d = this.dummy;
    d.position.set(x, groundY, z);
    d.rotation.set(FLAT_ROT_X, 0, 0);
    d.scale.set(sx, sz, 1);
    d.updateMatrix();
    mesh.setMatrixAt(index, d.matrix);
  }

  /** Euler-rotated instance (scatter props lean + yaw). */
  setEuler(
    mesh: MatrixTarget,
    index: number,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    sx = 1,
    sy = 1,
    sz = 1,
  ): void {
    const d = this.dummy;
    d.position.set(x, y, z);
    d.rotation.set(rx, ry, rz);
    d.scale.set(sx, sy, sz);
    d.updateMatrix();
    mesh.setMatrixAt(index, d.matrix);
  }

  /** Quaternion-oriented instance (billboards, direction cones). */
  setQuat(
    mesh: MatrixTarget,
    index: number,
    x: number,
    y: number,
    z: number,
    quat: THREE.Quaternion,
    sx = 1,
    sy = 1,
    sz = 1,
  ): void {
    const d = this.dummy;
    d.position.set(x, y, z);
    d.quaternion.copy(quat);
    d.scale.set(sx, sy, sz);
    d.updateMatrix();
    mesh.setMatrixAt(index, d.matrix);
  }
}
