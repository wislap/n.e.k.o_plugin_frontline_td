// Foundation pad material (visual-languages, field): a graphite slab with
// an emissive edge trim. One instanced unit box scaled per structure
// footprint; the edge distance is recovered from the instance scale so
// the trim stays a constant world-space width regardless of footprint.
import * as THREE from 'three';
import type { RenderVisual } from '../../../render/theme/index';

export interface PadUniforms {
  info2d: { value: number };
}

export function createPadMaterial(theme: RenderVisual): {
  material: THREE.MeshStandardMaterial;
  uniforms: PadUniforms;
} {
  const pad = theme.pad;
  const uniforms: PadUniforms = { info2d: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({
    color: pad.color,
    roughness: pad.roughness,
    metalness: pad.metalness,
    envMapIntensity: pad.envMapIntensity,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uEdge'] = { value: new THREE.Color(pad.edge) };
    shader.uniforms['uEmissiveBoost'] = { value: pad.emissiveBoost };
    shader.uniforms['uInfo2D'] = uniforms.info2d;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vPadLocal;
        varying vec2 vPadScale;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vPadLocal = position;
        #ifdef USE_INSTANCING
          vPadScale = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
        #else
          vPadScale = vec2(1.0);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uEdge;
        uniform float uEmissiveBoost;
        uniform float uInfo2D;
        varying vec3 vPadLocal;
        varying vec2 vPadScale;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Distance to the slab rim in world units (top face only).
          float edgeDist = (0.5 - max(abs(vPadLocal.x), abs(vPadLocal.z))) * min(vPadScale.x, vPadScale.y);
          float topFace = step(0.4, vPadLocal.y);
          float rim = (1.0 - smoothstep(0.02, 0.09, edgeDist)) * topFace;
          diffuseColor.rgb = mix(diffuseColor.rgb, uEdge, rim * 0.85);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.6, uInfo2D);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float edgeDist = (0.5 - max(abs(vPadLocal.x), abs(vPadLocal.z))) * min(vPadScale.x, vPadScale.y);
          float topFace = step(0.4, vPadLocal.y);
          float rim = (1.0 - smoothstep(0.02, 0.09, edgeDist)) * topFace;
          totalEmissiveRadiance += uEdge * rim * uEmissiveBoost;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'pad';
  return { material: mat, uniforms };
}
