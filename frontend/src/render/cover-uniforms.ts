// Shared service-coverage uniforms (M2A): LogisticsOverlay owns a
// single-byte RedFormat DataTexture and mutates these uniforms;
// TerrainMesh and RoadLayer sample them in Linear working space before
// scene.fog and ftdFogApply.
import * as THREE from 'three';
import { VISUAL } from './theme/visual';

export interface CoverUniforms {
  uFtdCoverMap: { value: THREE.DataTexture | null };
  uFtdCoverSize: { value: THREE.Vector2 };
  uFtdCoverColor: { value: THREE.Color };
  uFtdCoverFill: { value: number };
  uFtdCoverEdge: { value: number };
  uFtdCoverOn: { value: number };
}

export function createCoverUniforms(): CoverUniforms {
  return {
    uFtdCoverMap: { value: null },
    uFtdCoverSize: { value: new THREE.Vector2(1, 1) },
    uFtdCoverColor: { value: new THREE.Color(VISUAL.markers.link) },
    uFtdCoverFill: { value: 0.05 },
    uFtdCoverEdge: { value: 0.6 },
    uFtdCoverOn: { value: 0 },
  };
}

/**
 * Service-coverage fill + iso-contour overlay for ground and road
 * materials. Guards `uFtdCoverOn <= 0.5` in uniform control flow so
 * `fwidth` never executes divergently, and masks `worldXZ` to
 * `[0, uFtdCoverSize]` so ClampToEdgeWrapping never bleeds onto the
 * out-of-bounds terrain skirt.
 */
export const GLSL_COVER = /* glsl */ `
uniform sampler2D uFtdCoverMap;
uniform vec2 uFtdCoverSize;
uniform vec3 uFtdCoverColor;
uniform float uFtdCoverFill;
uniform float uFtdCoverEdge;
uniform float uFtdCoverOn;

vec3 ftdCoverApply(vec3 color, vec2 worldXZ) {
  if (uFtdCoverOn <= 0.5) {
    return color;
  }
  vec2 uv = worldXZ / uFtdCoverSize;
  float c = texture2D(uFtdCoverMap, uv).r;
  float w = max(fwidth(c) * 1.5, 0.03);
  float inBounds = step(0.0, worldXZ.x) * step(worldXZ.x, uFtdCoverSize.x)
    * step(0.0, worldXZ.y) * step(worldXZ.y, uFtdCoverSize.y);
  float line = 1.0 - smoothstep(0.01, 0.035 + w, abs(c - 0.5));
  float fill = step(0.5, c) * uFtdCoverFill;
  float alpha = max(fill, line * uFtdCoverEdge) * inBounds;
  if (alpha < 0.01) {
    return color;
  }
  return mix(color, uFtdCoverColor, alpha);
}
`;
