// Themed unit material (visual-languages): MeshStandardMaterial with the
// same slot convention as the structure material — 0 body (unitBody), 1
// trim (unitTrim treads), 2 faction accent (instanceColor), 3 emissive
// (unitEmissive or faction). aDim carries per-instance dimming (empty
// energy, selection brightening). uInfo2D dims units in tactical view.
import * as THREE from 'three';
import type { RenderTheme } from '../../../render/theme/index';

export interface ThemedUnitUniforms {
  info2d: { value: number };
}

export function createThemedUnitMaterial(theme: RenderTheme): {
  material: THREE.MeshStandardMaterial;
  uniforms: ThemedUnitUniforms;
} {
  const m = theme.materials;
  const factionEmissive = m.unitEmissive === 'faction';
  const uniforms: ThemedUnitUniforms = { info2d: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({
    roughness: m.roughness,
    metalness: m.metalness,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uBody'] = { value: new THREE.Color(m.unitBody) };
    shader.uniforms['uTrim'] = { value: new THREE.Color(m.unitTrim) };
    shader.uniforms['uEmissive'] = {
      value: new THREE.Color(factionEmissive ? '#ffffff' : m.unitEmissive),
    };
    shader.uniforms['uEmissiveIsFaction'] = { value: factionEmissive ? 1 : 0 };
    shader.uniforms['uEmissiveBoost'] = { value: m.emissiveBoost };
    shader.uniforms['uInfo2D'] = uniforms.info2d;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aSlot;
        attribute float aDim;
        varying float vSlot;
        varying float vDim;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
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
        uniform float uInfo2D;
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
          diffuseColor.rgb = base * mix(vDim, 1.0, accM);
          // Tactical info view: units become small bright markers in
          // faction colour on the darkened slate world.
          vec3 marker = vec3(0.85, 0.88, 0.8);
          #ifdef USE_INSTANCING_COLOR
            marker = mix(vColor.rgb, vec3(1.0), 0.35);
          #endif
          diffuseColor.rgb = mix(diffuseColor.rgb, marker, uInfo2D);
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
  mat.customProgramCacheKey = () => `themed-unit-${theme.id}`;
  return { material: mat, uniforms };
}
