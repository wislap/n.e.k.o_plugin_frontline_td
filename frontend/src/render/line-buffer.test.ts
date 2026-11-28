import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  bindLineBuffer,
  commitLineBuffer,
  commitLineDistances,
  createLineBuffer,
  ensureLineCapacity,
} from './line-buffer';

describe('line-buffer', () => {
  it('initializes boundingSphere once and omits lineDistance when not dashed', () => {
    const buf = createLineBuffer(8, true);
    expect(buf.geometry.boundingSphere).not.toBeNull();
    expect(buf.geometry.boundingSphere?.radius).toBe(1024);
    expect(buf.lineDistances).toBeNull();
    expect(buf.geometry.getAttribute('lineDistance')).toBeUndefined();
    expect(buf.geometry.drawRange).toEqual({ start: 0, count: 0 });
    buf.geometry.dispose();
  });

  it('skips needsUpdate and upload ranges when commitLineBuffer is called with 0 vertices', () => {
    const buf = createLineBuffer(8, true);
    const posAttr = buf.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = buf.geometry.getAttribute('color') as THREE.BufferAttribute;
    const posVer = posAttr.version;
    const colVer = colAttr.version;

    commitLineBuffer(buf, 0);

    expect(buf.geometry.drawRange.count).toBe(0);
    expect(posAttr.version).toBe(posVer);
    expect(colAttr.version).toBe(colVer);
    expect(posAttr.updateRanges).toEqual([]);
    expect(colAttr.updateRanges).toEqual([]);
    buf.geometry.dispose();
  });

  it('sets drawRange, exact updateRanges without accumulation, and does not recompute boundingSphere', () => {
    const buf = createLineBuffer(16, true);
    const computeSpy = vi.spyOn(buf.geometry, 'computeBoundingSphere');
    const posAttr = buf.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = buf.geometry.getAttribute('color') as THREE.BufferAttribute;

    commitLineBuffer(buf, 4);
    expect(buf.geometry.drawRange.count).toBe(4);
    expect(posAttr.updateRanges).toEqual([{ start: 0, count: 12 }]);
    expect(colAttr.updateRanges).toEqual([{ start: 0, count: 12 }]);

    commitLineBuffer(buf, 2);
    expect(buf.geometry.drawRange.count).toBe(2);
    expect(posAttr.updateRanges).toEqual([{ start: 0, count: 6 }]);
    expect(colAttr.updateRanges).toEqual([{ start: 0, count: 6 }]);
    expect(computeSpy).not.toHaveBeenCalled();

    buf.geometry.dispose();
  });

  it('preserves boundingSphere and reallocates lineDistances on ensureLineCapacity', () => {
    const buf = createLineBuffer(4, false, true);
    const oldGeo = buf.geometry;
    const disposeSpy = vi.spyOn(oldGeo, 'dispose');

    ensureLineCapacity(buf, 6);

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(buf.capacity).toBe(8);
    expect(buf.positions.length).toBe(24);
    expect(buf.colors).toBeNull();
    expect(buf.lineDistances?.length).toBe(8);
    expect(buf.geometry.boundingSphere?.radius).toBe(1024);
    expect(buf.geometry.getAttribute('lineDistance')).toBeInstanceOf(THREE.BufferAttribute);
    buf.geometry.dispose();
  });

  it('computes pairwise lineDistances and exact updateRange for dashed buffers', () => {
    const buf = createLineBuffer(8, false, true);
    buf.positions.set([0, 0, 0, 3, 0, 4, 1, 2, 3, 1, 5, 3]);
    const distAttr = buf.geometry.getAttribute('lineDistance') as THREE.BufferAttribute;
    const initialVer = distAttr.version;

    commitLineDistances(buf, 0);
    expect(distAttr.version).toBe(initialVer);
    expect(distAttr.updateRanges).toEqual([]);

    commitLineDistances(buf, 4);
    expect(buf.lineDistances?.slice(0, 4)).toEqual(new Float32Array([0, 5, 5, 8]));
    expect(distAttr.updateRanges).toEqual([{ start: 0, count: 4 }]);
    expect(distAttr.version).toBe(initialVer + 1);
    buf.geometry.dispose();
  });

  it('disposes non-matching previous geometry in bindLineBuffer and skips when already bound', () => {
    const buf = createLineBuffer(4, false);
    const lines = new THREE.LineSegments();
    const initialGeo = lines.geometry;
    const disposeSpy = vi.spyOn(initialGeo, 'dispose');

    bindLineBuffer(lines, buf);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(lines.geometry).toBe(buf.geometry);

    const bufDisposeSpy = vi.spyOn(buf.geometry, 'dispose');
    bindLineBuffer(lines, buf);
    expect(bufDisposeSpy).not.toHaveBeenCalled();

    buf.geometry.dispose();
  });
});
