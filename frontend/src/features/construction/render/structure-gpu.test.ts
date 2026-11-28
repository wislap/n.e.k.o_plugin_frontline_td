import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { commitDimAttr, commitMeshBuffers, resolveGlyphOpacity } from './structure-gpu';

describe('structure-gpu buffer commits', () => {
  it('hides mesh and skips upload ranges when count is 0', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, 8);
    mesh.setColorAt(0, new THREE.Color('#ffffff'));
    mesh.visible = true;
    const matVer = mesh.instanceMatrix.version;
    const colVer = mesh.instanceColor?.version ?? 0;

    commitMeshBuffers(mesh, 0);

    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);
    expect(mesh.instanceMatrix.version).toBe(matVer);
    expect(mesh.instanceColor?.version).toBe(colVer);
  });

  it('shows mesh and sets bounded updateRanges when count > 0', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, 8);
    mesh.setColorAt(0, new THREE.Color('#ffffff'));
    mesh.visible = false;

    commitMeshBuffers(mesh, 3);

    expect(mesh.count).toBe(3);
    expect(mesh.visible).toBe(true);
    expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 48 }]);
    expect(mesh.instanceColor?.updateRanges).toEqual([{ start: 0, count: 9 }]);
  });

  it('commits aDim updateRange only when count > 0', () => {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(8), 1);
    const ver0 = attr.version;
    commitDimAttr(attr, 0);
    expect(attr.version).toBe(ver0);

    commitDimAttr(attr, 5);
    expect(attr.updateRanges).toEqual([{ start: 0, count: 5 }]);
    expect(attr.version).toBe(ver0 + 1);
  });

  it('resolves glyph opacity across tactical and spectate pitch angles', () => {
    expect(resolveGlyphOpacity('tactical', 30)).toBeCloseTo(0.94, 4);
    expect(resolveGlyphOpacity('spectate', 20)).toBeCloseTo(0.45, 4);
    expect(resolveGlyphOpacity('spectate', 70)).toBeCloseTo(0.72, 4);
  });
});
