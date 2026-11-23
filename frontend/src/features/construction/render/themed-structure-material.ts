// Themed structure material (visual-slice item 1): MeshStandardMaterial so
// structures receive light, shadow and AO, with onBeforeCompile injections
// that map the geometry `aSlot` attribute (0 body, 1 trim, 2 faction accent,
// 3 emissive) to the theme palette. instanceColor still carries
// faction*dim (accent reads it directly); a per-instance `aDim` attribute
// carries the same dim scalar so body/trim darken consistently; `color`
// keeps the grayscale vertex shade. One material per theme; the caller
// disposes it on change.
// materials.detail > 0 adds procedural surface language: panel seams,
// hazard stripes on accent trim and a printed-code decal on top faces.
// uInfo2D dims structures into dark footprints for the tactical info view.
import * as THREE from 'three';
import type { RenderTheme } from '../../../render/theme/index';
import { createCodesTexture } from './decal-texture';

interface ThemedStructureUniforms {
  info2d: { value: number };
}

export interface ThemedStructureMaterial {
  material: THREE.MeshStandardMaterial;
  uniforms: ThemedStructureUniforms;
  // Decal atlas when materials.detail > 0 — the caller disposes it with
  // the material on theme change/unmount.
  codes: THREE.CanvasTexture | null;
}

export function createThemedStructureMaterial(theme: RenderTheme): ThemedStructureMaterial {
  const m = theme.materials;
  const factionEmissive = m.structureEmissive === 'faction';
  const detail = m.detail > 0;
  const codes = detail ? createCodesTexture() : null;
  const uniforms: ThemedStructureUniforms = { info2d: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({
    roughness: m.roughness,
    metalness: m.metalness,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uBody'] = { value: new THREE.Color(m.structureBody) };
    shader.uniforms['uTrim'] = { value: new THREE.Color(m.structureTrim) };
    shader.uniforms['uAccent'] = { value: new THREE.Color(theme.accent) };
    shader.uniforms['uEmissive'] = {
      value: new THREE.Color(factionEmissive ? '#ffffff' : m.structureEmissive),
    };
    shader.uniforms['uEmissiveIsFaction'] = { value: factionEmissive ? 1 : 0 };
    shader.uniforms['uEmissiveBoost'] = { value: m.emissiveBoost };
    shader.uniforms['uDetail'] = { value: m.detail };
    shader.uniforms['uInfo2D'] = uniforms.info2d;
    shader.uniforms['uCodes'] = { value: codes };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 color;
        attribute float aSlot;
        attribute float aDim;
        varying vec3 vShade;
        varying float vSlot;
        varying float vDim;
        varying vec3 vLocal;
        varying vec3 vLocalN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vShade = color;
        vSlot = aSlot;
        vDim = aDim;
        vLocal = position;
        vLocalN = objectNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uBody;
        uniform vec3 uTrim;
        uniform vec3 uAccent;
        uniform vec3 uEmissive;
        uniform float uEmissiveIsFaction;
        uniform float uEmissiveBoost;
        uniform float uDetail;
        uniform float uInfo2D;
        uniform sampler2D uCodes;
        varying vec3 vShade;
        varying float vSlot;
        varying float vDim;
        varying vec3 vLocal;
        varying vec3 vLocalN;`,
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
          if (uDetail > 0.0) {
            // Panel seams on body surfaces: faint darker lines on a ~0.25
            // unit grid so shells read as assembled plating.
            vec2 seamP = abs(vLocalN.y) > 0.5 ? vLocal.xz : vLocal.xy + vLocal.zy;
            vec2 sw = max(fwidth(seamP), vec2(1e-4));
            vec2 sg = abs(fract(seamP * 4.0 - 0.5) - 0.5) / (sw * 4.0);
            float seam = (1.0 - min(min(sg.x, sg.y), 1.0)) * (1.0 - accM);
            base *= 1.0 - seam * 0.1 * uDetail;
            // Hazard stripes on accent parts: alternating accent/ink bands.
            float stripe = step(0.5, fract((vLocal.x + vLocal.y) * 10.0));
            base = mix(base, mix(uAccent * 0.22, uAccent, stripe), accM * 0.55 * uDetail);
            // Printed codes on upward body faces (stencil decals).
            if (vLocalN.y > 0.6) {
              vec2 cuv = vec2(fract(vLocal.x * 2.0 + 0.5), fract(vLocal.z * 2.0));
              float code = texture2D(uCodes, cuv).r;
              base *= 1.0 - code * 0.35 * uDetail * (1.0 - accM);
            }
          }
          diffuseColor.rgb = base * vShade * mix(vDim, 1.0, accM);
          // Tactical info view (弱化显示): structures collapse to dark
          // graphite footprints so glyphs/markers carry the information.
          diffuseColor.rgb = mix(diffuseColor.rgb, uTrim * 0.55 * vShade * vDim, uInfo2D);
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
  return { material: mat, uniforms, codes };
}
