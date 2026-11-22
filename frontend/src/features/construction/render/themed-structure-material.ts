// Themed structure material (visual-slice item 1): MeshStandardMaterial so
// structures receive light, shadow and AO, with onBeforeCompile injections
// that map the geometry `aSlot` attribute (0 body, 1 trim, 2 faction accent,
// 3 emissive) to the theme palette. instanceColor still carries
// faction*dim (accent reads it directly); a per-instance `aDim` attribute
// carries the same dim scalar so body/trim darken consistently; `color`
// keeps the grayscale vertex shade. One material per theme; the caller
// disposes it on change.
import * as THREE from 'three';
import type { RenderTheme } from '../../../render/theme/index';

export function createThemedStructureMaterial(theme: RenderTheme): THREE.MeshStandardMaterial {
  const m = theme.materials;
  const factionEmissive = m.structureEmissive === 'faction';
  const mat = new THREE.MeshStandardMaterial({
    roughness: m.roughness,
    metalness: m.metalness,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uBody'] = { value: new THREE.Color(m.structureBody) };
    shader.uniforms['uTrim'] = { value: new THREE.Color(m.structureTrim) };
    shader.uniforms['uEmissive'] = {
      value: new THREE.Color(factionEmissive ? '#ffffff' : m.structureEmissive),
    };
    shader.uniforms['uEmissiveIsFaction'] = { value: factionEmissive ? 1 : 0 };
    shader.uniforms['uEmissiveBoost'] = { value: m.emissiveBoost };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 color;
        attribute float aSlot;
        attribute float aDim;
        varying vec3 vShade;
        varying float vSlot;
        varying float vDim;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vShade = color;
        vSlot = aSlot;
        vDim = aDim;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uBody;
        uniform vec3 uTrim;
        uniform vec3 uEmissive;
        uniform float uEmissiveIsFaction;
        uniform float uEmissiveBoost;
        varying vec3 vShade;
        varying float vSlot;
        varying float vDim;`,
      )
      .replace(
        '#include <color_fragment>',
        `{
          float trimM = step(0.5, vSlot) * (1.0 - step(1.5, vSlot));
          float accM = step(1.5, vSlot) * (1.0 - step(2.5, vSlot));
          vec3 base = mix(uBody, uTrim, trimM);
          #ifdef USE_INSTANCING_COLOR
            base = mix(base, vColor.rgb, accM);
          #endif
          diffuseColor.rgb = base * vShade * mix(vDim, 1.0, accM);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 emis = uEmissive;
          #ifdef USE_INSTANCING_COLOR
            emis = mix(uEmissive, vColor.rgb, uEmissiveIsFaction);
          #endif
          totalEmissiveRadiance += emis * step(2.5, vSlot) * uEmissiveBoost * vDim;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `themed-structure-${theme.id}`;
  return mat;
}
