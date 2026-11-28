import { describe, expect, it } from 'vitest';
import { createScatterTransitionUniforms } from './scatter-assets';

describe('createScatterTransitionUniforms', () => {
  it('initializes scatter transition uniforms to visible 3D state', () => {
    const uniforms = createScatterTransitionUniforms();
    expect(uniforms.presence.value).toBe(1);
    expect(uniforms.info2d.value).toBe(0);
  });
});
