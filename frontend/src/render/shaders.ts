// Shared GLSL snippets injected into ShaderMaterial sources and
// onBeforeCompile patches. Functions use the `ftd` prefix so they cannot
// collide with three's own shader chunk symbols.
import * as THREE from 'three';

/** Deterministic 2D hash → [0,1) plus bilinear value noise built on it. */
export const GLSL_NOISE = /* glsl */ `
float ftdHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float ftdValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(ftdHash(i), ftdHash(i + vec2(1.0, 0.0)), f.x),
    mix(ftdHash(i + vec2(0.0, 1.0)), ftdHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
`;

/** Formats a TS tuning constant as a GLSL float literal (`35` → `35.0`). */
export function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

/**
 * Anti-aliased cell-boundary line factor for world-space XZ coordinates:
 * ~1 on cell borders, 0 inside cells. `p` is in cells (scale before
 * calling for coarser grids).
 */
export const GLSL_GRID_LINE = /* glsl */ `
float ftdGridLine(vec2 p) {
  vec2 c = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(1e-4));
  return 1.0 - min(min(c.x, c.y), 1.0);
}
`;

// ── Fog of war ─────────────────────────────────────────────────────
// Reproduces the removed FogLayer film blend (see ADR 0039): the vision
// layer lives in a DataTexture green channel (alpha per cell), blurred
// 5-tap, curved toward unexplored, and mixed over the ground colour as
// `mix(color, fogCol, alpha)`. The camera-distance term fades the fog
// colour toward the horizon haze exactly like the film did; tactical
// mode zeroes uFtdFogHazeAmt and uses the slate fog colour.
const FOG_BLUR_TEXELS = 0.8;
const FOG_BLUR_CENTER = 0.44;
const FOG_BLUR_TAP = 0.14;
const FOG_SMOOTH_LO = 0.05;
const FOG_SMOOTH_HI = 0.95;
const FOG_UNEXP_LO = 0.55;
const FOG_UNEXP_HI = 0.8;
const FOG_SEEN_MIX = 0.35;
const FOG_UNEXP_MIX = 0.6;
const FOG_HAZE_START = 35;
const FOG_HAZE_END = 110;
const FOG_HAZE_MIX = 0.65;

/**
 * Shared mutable fog uniforms: one object is spread into every fogged
 * material's uniforms, so a single per-frame write (vision/render's
 * FogOfWar component) updates all consumers. Apply the mix AFTER the
 * material's `colorspace_fragment`: the old film blended in display
 * space with working-space colour uniforms, so a post-encode mix with
 * the same values reproduces the composite exactly.
 */
export interface FogUniforms {
  uFtdFogMap: { value: THREE.DataTexture | null };
  uFtdFogTexel: { value: THREE.Vector2 };
  uFtdFogMapSize: { value: THREE.Vector2 };
  uFtdFogColor: { value: THREE.Color };
  uFtdFogHaze: { value: THREE.Color };
  uFtdFogHazeAmt: { value: number };
}

export function createFogUniforms(): FogUniforms {
  return {
    uFtdFogMap: { value: null },
    uFtdFogTexel: { value: new THREE.Vector2(1, 1) },
    uFtdFogMapSize: { value: new THREE.Vector2(1, 1) },
    uFtdFogColor: { value: new THREE.Color('#3d453a') },
    uFtdFogHaze: { value: new THREE.Color('#3d453a') },
    uFtdFogHazeAmt: { value: 1 },
  };
}

/**
 * Fog sample + blend for ground/world materials. Requires a `vec3`
 * world position (consumers pass `vTerWorld` or `vFtdFogWorld`).
 */
export const GLSL_FOG = /* glsl */ `
uniform sampler2D uFtdFogMap;
uniform vec2 uFtdFogTexel;
uniform vec2 uFtdFogMapSize;
uniform vec3 uFtdFogColor;
uniform vec3 uFtdFogHaze;
uniform float uFtdFogHazeAmt;

float ftdFogSample(vec2 uv) {
  return texture2D(uFtdFogMap, uv).g;
}

vec3 ftdFogApply(vec3 color, vec2 worldXZ, float vDist) {
  vec2 uv = worldXZ / uFtdFogMapSize;
  vec2 o = uFtdFogTexel * ${glslFloat(FOG_BLUR_TEXELS)};
  float a = ftdFogSample(uv) * ${glslFloat(FOG_BLUR_CENTER)}
    + (ftdFogSample(uv + vec2(o.x, 0.0)) + ftdFogSample(uv - vec2(o.x, 0.0))
      + ftdFogSample(uv + vec2(0.0, o.y)) + ftdFogSample(uv - vec2(0.0, o.y)))
      * ${glslFloat(FOG_BLUR_TAP)};
  a = smoothstep(${glslFloat(FOG_SMOOTH_LO)}, ${glslFloat(FOG_SMOOTH_HI)}, a);
  float unexplored = smoothstep(${glslFloat(FOG_UNEXP_LO)}, ${glslFloat(FOG_UNEXP_HI)}, a);
  float hz = smoothstep(${glslFloat(FOG_HAZE_START)}, ${glslFloat(FOG_HAZE_END)}, vDist)
    * uFtdFogHazeAmt;
  vec3 col = mix(uFtdFogColor, uFtdFogHaze, hz * ${glslFloat(FOG_HAZE_MIX)});
  return mix(color, col, a * mix(${glslFloat(FOG_SEEN_MIX)}, ${glslFloat(FOG_UNEXP_MIX)}, unexplored));
}
`;

/** `varying vec3 vFtdFogWorld` / `varying float vFtdFogDist` for consumers. */
export const GLSL_FOG_WORLD_DECL = 'varying vec3 vFtdFogWorld;\nvarying float vFtdFogDist;';

/**
 * World-position assignment for three's `transformed` (instancing-aware).
 * The camera distance is computed per VERTEX and interpolated — the
 * removed film evaluated it the same way, so vertex-granularity
 * reproduces the haze falloff exactly.
 */
export const GLSL_FOG_WORLD_VERT = /* glsl */ `
vec4 ftdFogWp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  ftdFogWp = instanceMatrix * ftdFogWp;
#endif
vFtdFogWorld = (modelMatrix * ftdFogWp).xyz;
vFtdFogDist = distance(vFtdFogWorld, cameraPosition);`;

/**
 * Adds the fog-of-war blend to a built-in three material: shares the
 * FogUniforms objects, computes a world-position varying (instancing
 * aware), and mixes post-`colorspace_fragment` — matching the removed
 * film's display-space blend (after the fog_fragment include). Chains any existing onBeforeCompile.
 */
export function injectFog(material: THREE.Material, fog: FogUniforms): void {
  const prev = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, fog);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_FOG_WORLD_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GLSL_FOG_WORLD_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_FOG}\n${GLSL_FOG_WORLD_DECL}`)
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>\n gl_FragColor.rgb = ftdFogApply(gl_FragColor.rgb, vFtdFogWorld.xz, vFtdFogDist);`,
      );
  };
}
