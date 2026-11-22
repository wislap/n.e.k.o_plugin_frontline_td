// Themed terrain material (visual-slice item 4): MeshStandardMaterial so
// the ground still receives light and shadow, with onBeforeCompile
// injections for the theme height ramp, per-cell/pixel hash noise, grid
// lines, cliff-face recolor by slope, slope darkening and map-edge
// occlusion. One material per theme; callers dispose on change.
import * as THREE from 'three';
import type { RenderTheme } from '../../../render/theme/index';

export interface ThemedTerrainParams {
  heightMin: number;
  heightMax: number;
  mapWidth: number;
  mapHeight: number;
}

export function createThemedTerrainMaterial(
  theme: RenderTheme,
  params: ThemedTerrainParams,
): THREE.MeshStandardMaterial {
  const t = theme.terrain;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uRampLow'] = { value: new THREE.Color(t.rampLow) };
    shader.uniforms['uRampHigh'] = { value: new THREE.Color(t.rampHigh) };
    shader.uniforms['uRampStrength'] = { value: t.rampStrength };
    shader.uniforms['uCliffColor'] = { value: new THREE.Color(t.cliffColor) };
    shader.uniforms['uCliffStart'] = { value: t.cliffStart };
    shader.uniforms['uCliffEnd'] = { value: t.cliffEnd };
    shader.uniforms['uGridStrength'] = { value: t.gridStrength };
    shader.uniforms['uNoiseAmp'] = { value: t.noiseAmp };
    shader.uniforms['uPixelMode'] = { value: t.noiseStyle === 'pixel' ? 1 : 0 };
    shader.uniforms['uSlopeDarken'] = { value: t.slopeDarken };
    shader.uniforms['uEdgeOcc'] = { value: t.edgeOcc };
    shader.uniforms['uEdgeFade'] = { value: t.edgeFadeDist };
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
        uniform float uNoiseAmp;
        uniform float uPixelMode;
        uniform float uSlopeDarken;
        uniform float uEdgeOcc;
        uniform float uEdgeFade;
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
          vec2 np = uPixelMode > 0.5 ? floor(terP * 8.0) / 8.0 : floor(terP);
          float hn = fract(sin(dot(np, vec2(127.1, 311.7))) * 43758.5453);
          diffuseColor.rgb *= 1.0 + (hn - 0.5) * uNoiseAmp;
          // Macro variation: 3-octave value noise at ~6-20 cell scales, a few
          // percent of lightness plus a slight hue drift toward the ramp ends.
          float macro = terNoise(terP / 17.0) * 0.5
            + terNoise(terP / 8.5 + 13.7) * 0.3
            + terNoise(terP / 4.2 + 41.3) * 0.2;
          diffuseColor.rgb *= 1.0 + (macro - 0.5) * 0.14;
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(uRampLow, uRampHigh, macro), 0.1);
          vec2 gw = max(fwidth(terP), vec2(1e-4));
          vec2 g = abs(fract(terP - 0.5) - 0.5) / gw;
          float gline = 1.0 - min(min(g.x, g.y), 1.0);
          diffuseColor.rgb *= 1.0 - uGridStrength * gline;
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
        }`,
      );
  };
  mat.customProgramCacheKey = () => `themed-terrain-${theme.id}`;
  return mat;
}
