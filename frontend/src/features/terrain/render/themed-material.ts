// Themed terrain material (visual-slice item 4): MeshStandardMaterial so
// the ground still receives light and shadow, with onBeforeCompile
// injections for the theme height ramp, per-cell hash noise, grid
// lines, cliff-face recolor by slope, slope darkening and map-edge
// occlusion. One material per theme; callers dispose on change.
// Optional haze-fade tint blends the out-of-bounds skirt into the
// horizon; uInfo2D dims the ground for the tactical info view.
import * as THREE from 'three';
import type { RenderVisual } from '../../../render/theme/index';

export interface ThemedTerrainParams {
  heightMin: number;
  heightMax: number;
  mapWidth: number;
  mapHeight: number;
  // Skirt mode: fade the surface toward the horizon haze color outside
  // the map rect (distance in cells past the border).
  hazeFade?: { color: string; start: number; end: number } | undefined;
}

// Shared mutable uniforms (module-scope, mutated per frame by callers):
// uInfo2D is the tactical-info dim factor, uTime drives nothing here but
// is reserved for parity with other themed materials.
export interface ThemedTerrainUniforms {
  info2d: { value: number };
}

export function createThemedTerrainMaterial(
  theme: RenderVisual,
  params: ThemedTerrainParams,
): { material: THREE.MeshStandardMaterial; uniforms: ThemedTerrainUniforms } {
  const t = theme.terrain;
  const uniforms: ThemedTerrainUniforms = { info2d: { value: 0 } };
  const haze = params.hazeFade;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    (mat as unknown as { _dbg?: unknown })._dbg = shader;
    shader.uniforms['uRampLow'] = { value: new THREE.Color(t.rampLow) };
    shader.uniforms['uRampHigh'] = { value: new THREE.Color(t.rampHigh) };
    shader.uniforms['uRampStrength'] = { value: t.rampStrength };
    shader.uniforms['uCliffColor'] = { value: new THREE.Color(t.cliffColor) };
    shader.uniforms['uCliffStart'] = { value: t.cliffStart };
    shader.uniforms['uCliffEnd'] = { value: t.cliffEnd };
    shader.uniforms['uGridStrength'] = { value: t.gridStrength };
    shader.uniforms['uGrid3D'] = { value: t.grid3d ?? 1 };
    shader.uniforms['uNoiseAmp'] = { value: t.noiseAmp };
    shader.uniforms['uDirtColor'] = { value: new THREE.Color(t.dirt ?? '#000000') };
    shader.uniforms['uDirtOn'] = { value: t.dirt === undefined ? 0 : 1 };
    shader.uniforms['uSlopeDarken'] = { value: t.slopeDarken };
    shader.uniforms['uEdgeOcc'] = { value: t.edgeOcc };
    shader.uniforms['uEdgeFade'] = { value: t.edgeFadeDist };
    shader.uniforms['uInfo2D'] = uniforms.info2d;
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
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTerWorld;
        varying vec3 vTerNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTerWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uRampLow;
        uniform vec3 uRampHigh;
        uniform float uRampStrength;
        uniform vec3 uCliffColor;
        uniform float uCliffStart;
        uniform float uCliffEnd;
        uniform float uGridStrength;
        uniform float uGrid3D;
        uniform float uNoiseAmp;
        uniform vec3 uDirtColor;
        uniform float uDirtOn;
        uniform float uSlopeDarken;
        uniform float uEdgeOcc;
        uniform float uEdgeFade;
        uniform float uInfo2D;
        uniform vec3 uInfo2DTint;
        uniform float uHazeOn;
        uniform vec3 uHazeColor;
        uniform vec2 uHazeRange;
        uniform vec2 uHRange;
        uniform vec2 uMapSize;
        varying vec3 vTerWorld;
        varying vec3 vTerNormal;
        float terHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float terNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(terHash(i), terHash(i + vec2(1.0, 0.0)), f.x),
            mix(terHash(i + vec2(0.0, 1.0)), terHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }
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
          vec3 ramp = mix(uRampLow, uRampHigh, hNorm);
          diffuseColor.rgb = mix(diffuseColor.rgb, ramp, uRampStrength);
          float hn = fract(sin(dot(floor(terP), vec2(127.1, 311.7))) * 43758.5453);
          diffuseColor.rgb *= 1.0 + (hn - 0.5) * uNoiseAmp;
          // Macro variation: continuous multi-octave value noise at
          // ~4-35 cell scales — large meadow patches with a slight hue
          // drift between the ramp ends, no per-cell tiling.
          float macro = terNoise(terP / 34.0) * 0.4
            + terNoise(terP / 17.0 + 13.7) * 0.3
            + terNoise(terP / 8.5 + 41.3) * 0.2
            + terNoise(terP / 4.2 + 71.9) * 0.1;
          diffuseColor.rgb *= 1.0 + (macro - 0.5) * 0.16;
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(uRampLow, uRampHigh, macro), 0.16);
          if (uDirtOn > 0.5) {
            // Dirt/gravel patches: a second low-frequency field picks out
            // worn ground around ~10-cell blobs.
            float dirtM = smoothstep(0.56, 0.72, terNoise(terP / 11.0 + 91.3))
              * (0.75 + terNoise(terP / 3.0 + 17.7) * 0.5);
            diffuseColor.rgb = mix(diffuseColor.rgb, uDirtColor, dirtM * 0.65);
          }
          vec2 gw = max(fwidth(terP), vec2(1e-4));
          vec2 g = abs(fract(terP - 0.5) - 0.5) / gw;
          float gline = 1.0 - min(min(g.x, g.y), 1.0);
          diffuseColor.rgb *= 1.0 - uGridStrength * mix(uGrid3D, 1.0, uInfo2D) * gline;
          float ny = clamp(vTerNormal.y, 0.0, 1.0);
          // Cliff edges: where the up-normal changes fast across pixels the
          // fragment sits in a top/bottom transition band; brighten the top
          // rim slightly and darken the cliff base.
          float slopeChange = fwidth(ny);
          float topRim = smoothstep(0.12, 0.45, slopeChange) * smoothstep(0.55, 0.92, ny);
          float baseBand = smoothstep(0.12, 0.45, slopeChange) * (1.0 - smoothstep(0.05, 0.55, ny));
          diffuseColor.rgb *= 1.0 + topRim * 0.12 - baseBand * 0.2;
          diffuseColor.rgb = mix(uCliffColor, diffuseColor.rgb, smoothstep(uCliffStart, uCliffEnd, ny));
          diffuseColor.rgb *= 1.0 - uSlopeDarken * (1.0 - ny);
          float dEdge = min(min(terP.x, terP.y), min(uMapSize.x - terP.x, uMapSize.y - terP.y));
          diffuseColor.rgb *= mix(1.0 - uEdgeOcc, 1.0, smoothstep(0.0, uEdgeFade, dEdge));
          // Out-of-bounds skirt: blend into the horizon haze by distance
          // outside the map rect.
          if (uHazeOn > 0.5) {
            float dOut = terEdgeDist(terP, uMapSize);
            diffuseColor.rgb = mix(diffuseColor.rgb, uHazeColor, smoothstep(uHazeRange.x, uHazeRange.y, dOut));
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
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'themed-terrain';
  return { material: mat, uniforms };
}
