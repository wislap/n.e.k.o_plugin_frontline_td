// Themed terrain material (visual-slice item 4): MeshStandardMaterial so
// the ground still receives light and shadow, with onBeforeCompile
// injections for the theme height ramp, macro noise, grid lines,
// cliff-face recolor by slope, slope darkening, map-edge occlusion,
// service-coverage tint, and blue cell-grid overlay. One material per
// theme; callers dispose on change.
// Optional haze-fade tint blends the out-of-bounds skirt into the
// horizon; uInfo2D dims the ground for the tactical info view.
import * as THREE from 'three';
import { GLSL_COVER, type CoverUniforms } from '../../../render/cover-uniforms';
import { GLSL_FOG, GLSL_GRID_LINE, GLSL_NOISE, type FogUniforms } from '../../../render/shaders';
import type { RenderVisual } from '../../../render/theme/index';

export interface ThemedTerrainParams {
  heightMin: number;
  heightMax: number;
  mapWidth: number;
  mapHeight: number;
  // Skirt mode: fade the surface toward the horizon haze color outside
  // the map rect (distance in cells past the border).
  hazeFade?: { color: string; start: number; end: number } | undefined;
  // Fog-of-war uniforms (shared object; mixed after scene fog in
  // Linear working space under EffectComposer's HalfFloatType target).
  fog: FogUniforms;
  // Shared logistics service-coverage uniforms.
  cover: CoverUniforms;
}

// Shared mutable uniforms (module-scope, mutated per frame by callers):
// uInfo2D is the tactical-info dim factor; gridOverlayOpacity drives the
// blue 1x1 + 8x8 cell grid blended after scene fog.
export interface ThemedTerrainUniforms {
  info2d: { value: number };
  gridOverlayOpacity: { value: number };
}

export function createThemedTerrainMaterial(
  theme: RenderVisual,
  params: ThemedTerrainParams,
): { material: THREE.MeshStandardMaterial; uniforms: ThemedTerrainUniforms } {
  const t = theme.terrain;
  const uniforms: ThemedTerrainUniforms = {
    info2d: { value: 0 },
    gridOverlayOpacity: { value: 0 },
  };
  const haze = params.hazeFade;
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.95,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    (mat as unknown as { _dbg?: unknown })._dbg = shader;
    shader.uniforms['uRampLow'] = { value: new THREE.Color(t.rampLow) };
    shader.uniforms['uRampHigh'] = { value: new THREE.Color(t.rampHigh) };
    shader.uniforms['uCliffColor'] = { value: new THREE.Color(t.cliffColor) };
    shader.uniforms['uCliffStart'] = { value: t.cliffStart };
    shader.uniforms['uCliffEnd'] = { value: t.cliffEnd };
    shader.uniforms['uGridStrength'] = { value: t.gridStrength };
    shader.uniforms['uDirtColor'] = { value: new THREE.Color(t.dirt ?? '#000000') };
    shader.uniforms['uDirtOn'] = { value: t.dirt === undefined ? 0 : 1 };
    shader.uniforms['uSlopeDarken'] = { value: t.slopeDarken };
    shader.uniforms['uEdgeOcc'] = { value: t.edgeOcc };
    shader.uniforms['uEdgeFade'] = { value: t.edgeFadeDist };
    shader.uniforms['uInfo2D'] = uniforms.info2d;
    shader.uniforms['uGridOverlayOpacity'] = uniforms.gridOverlayOpacity;
    shader.uniforms['uInfo2DTint'] = {
      value: new THREE.Vector3(0.2, 0.26, 0.22),
    };
    shader.uniforms['uHazeOn'] = { value: haze === undefined ? 0 : 1 };
    shader.uniforms['uHazeColor'] = { value: new THREE.Color(haze?.color ?? '#000000') };
    shader.uniforms['uHazeRange'] = {
      value: new THREE.Vector2(haze?.start ?? 0, Math.max(haze?.end ?? 1, 0.001)),
    };
    shader.uniforms['uHRange'] = {
      value: new THREE.Vector2(
        params.heightMin,
        Math.max(params.heightMax, params.heightMin + 1e-3),
      ),
    };
    shader.uniforms['uMapSize'] = {
      value: new THREE.Vector2(params.mapWidth, params.mapHeight),
    };
    Object.assign(shader.uniforms, params.fog, params.cover);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTerWorld;
        varying vec3 vTerNormal;
        varying float vFtdFogDist;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTerWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vFtdFogDist = distance(vTerWorld, cameraPosition);
        vTerNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uRampLow;
        uniform vec3 uRampHigh;
        uniform vec3 uCliffColor;
        uniform float uCliffStart;
        uniform float uCliffEnd;
        uniform float uGridStrength;
        uniform vec3 uDirtColor;
        uniform float uDirtOn;
        uniform float uSlopeDarken;
        uniform float uEdgeOcc;
        uniform float uEdgeFade;
        uniform float uInfo2D;
        uniform float uGridOverlayOpacity;
        uniform vec3 uInfo2DTint;
        uniform float uHazeOn;
        uniform vec3 uHazeColor;
        uniform vec2 uHazeRange;
        uniform vec2 uHRange;
        uniform vec2 uMapSize;
        varying vec3 vTerWorld;
        varying vec3 vTerNormal;
        varying float vFtdFogDist;
        ${GLSL_COVER}
        ${GLSL_FOG}
        ${GLSL_NOISE}
        ${GLSL_GRID_LINE}
        float terEdgeDist(vec2 p, vec2 size) {
          vec2 a = min(p, vec2(0.0));
          vec2 b = max(p - size, vec2(0.0));
          vec2 outV = a + b;
          return length(outV);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 terP = vTerWorld.xz;
          float hNorm = clamp((vTerWorld.y - uHRange.x) / (uHRange.y - uHRange.x), 0.0, 1.0);
          diffuseColor.rgb = mix(uRampLow, uRampHigh, hNorm);
          // Macro variation: continuous multi-octave value noise at
          // ~4-35 cell scales — large meadow patches with a slight hue
          // drift between the ramp ends, no per-cell tiling.
          float macro = ftdValueNoise(terP / 34.0) * 0.4
            + ftdValueNoise(terP / 17.0 + 13.7) * 0.3
            + ftdValueNoise(terP / 8.5 + 41.3) * 0.2
            + ftdValueNoise(terP / 4.2 + 71.9) * 0.1;
          diffuseColor.rgb *= 1.0 + (macro - 0.5) * 0.16;
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(uRampLow, uRampHigh, macro), 0.16);
          if (uDirtOn > 0.5) {
            // Dirt/gravel patches: a second low-frequency field picks out
            // worn ground around ~10-cell blobs.
            float dirtM = smoothstep(0.56, 0.72, ftdValueNoise(terP / 11.0 + 91.3))
              * (0.75 + ftdValueNoise(terP / 3.0 + 17.7) * 0.5);
            diffuseColor.rgb = mix(diffuseColor.rgb, uDirtColor, dirtM * 0.65);
          }
          if (uInfo2D > 0.001) {
            float gline = ftdGridLine(terP);
            diffuseColor.rgb *= 1.0 - uGridStrength * uInfo2D * gline;
          }
          float ny = clamp(vTerNormal.y, 0.0, 1.0);
          diffuseColor.rgb = mix(uCliffColor, diffuseColor.rgb, smoothstep(uCliffStart, uCliffEnd, ny));
          diffuseColor.rgb *= 1.0 - uSlopeDarken * (1.0 - ny);
          float dEdge = min(min(terP.x, terP.y), min(uMapSize.x - terP.x, uMapSize.y - terP.y));
          diffuseColor.rgb *= mix(1.0 - uEdgeOcc, 1.0, smoothstep(0.0, uEdgeFade, dEdge));
          // Out-of-bounds skirt: blend into the horizon haze by distance
          // outside the map rect, darkening toward tactical slate during transitions.
          if (uHazeOn > 0.5) {
            float dOut = terEdgeDist(terP, uMapSize);
            vec3 skirtHaze = mix(uHazeColor, vec3(0.06, 0.08, 0.075), min(1.0, uInfo2D * 1.35));
            diffuseColor.rgb = mix(diffuseColor.rgb, skirtHaze, smoothstep(uHazeRange.x, uHazeRange.y, dOut));
          }
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        {
          // Tactical info view (弱化显示): sink the ground into a dark
          // slate grey-green so markers read as the bright layer on top.
          // Applied post-lighting so sun warmth, fill light and grading
          // cannot lift the map back toward pale olive.
          float grey = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(grey) * uInfo2DTint, uInfo2D);
          gl_FragColor.rgb = ftdCoverApply(gl_FragColor.rgb, vTerWorld.xz);
        }`,
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
        if (uGridOverlayOpacity > 0.0) {
          float cellLine = ftdGridLine(vTerWorld.xz);
          float secLine = ftdGridLine(vTerWorld.xz / 8.0);
          float inBounds = step(0.0, vTerWorld.x) * step(vTerWorld.x, uMapSize.x)
            * step(0.0, vTerWorld.z) * step(vTerWorld.z, uMapSize.y);
          float flatMask = smoothstep(0.35, 0.75, vTerNormal.y);
          float gridAlpha = clamp(
            max(cellLine * 0.65, secLine * 1.15) * flatMask * uGridOverlayOpacity,
            0.0,
            1.0
          ) * inBounds;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.55, 0.78, 0.96), gridAlpha);
        }
        // Both scene.fog and ftdFogApply run in Linear working space
        // (EffectComposer's offscreen HalfFloatType target makes
        // colorspace_fragment a pass-through before EffectPass encodes sRGB).
        gl_FragColor.rgb = ftdFogApply(gl_FragColor.rgb, vTerWorld.xz, vFtdFogDist);`,
      );
  };
  mat.customProgramCacheKey = () => 'themed-terrain-fog-cover-v2';
  return { material: mat, uniforms };
}
