// Shared GLSL snippets injected into ShaderMaterial sources and
// onBeforeCompile patches. Functions use the `ftd` prefix so they cannot
// collide with three's own shader chunk symbols.

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
