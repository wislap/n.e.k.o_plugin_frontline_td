import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDashRingMaterial } from './dash-ring';

describe('createDashRingMaterial', () => {
  it('uses expected default uniforms and empty optional defines', () => {
    const mat = createDashRingMaterial('#ffd24f');
    expect(mat.uniforms.uColor.value.getHexString()).toBe(
      new THREE.Color('#ffd24f').getHexString(),
    );
    expect(mat.uniforms.uTime.value).toBe(0);
    expect(mat.uniforms.uDash.value).toBe(1);
    expect(mat.uniforms.uWidth.value).toBe(0.06);
    expect(mat.uniforms.uOpacity.value).toBe(0.55);
    expect(mat.defines).toEqual({});
    expect(mat.vertexShader).toContain('USE_INSTANCING_COLOR');
    expect(mat.fragmentShader).toContain('uColor * vInstanceColor');
    mat.dispose();
  });

  it('applies custom dash, width, opacity, instancedArc, and instancedDash options', () => {
    const mat = createDashRingMaterial('#ffffff', {
      dash: 0,
      width: 0.16,
      opacity: 0.9,
      instancedArc: true,
      instancedDash: true,
    });
    expect(mat.uniforms.uDash.value).toBe(0);
    expect(mat.uniforms.uWidth.value).toBe(0.16);
    expect(mat.uniforms.uOpacity.value).toBe(0.9);
    expect(mat.defines).toEqual({ USE_ARC: 1, USE_INSTANCED_DASH: 1 });
    expect(mat.vertexShader).toContain('attribute vec2 aArc;');
    expect(mat.vertexShader).toContain('attribute float aDash;');
    expect(mat.fragmentShader).toContain('USE_ARC');
    expect(mat.fragmentShader).toContain('USE_INSTANCED_DASH');
    expect(mat.fragmentShader).toContain('m * uOpacity');
    mat.dispose();
  });
});
