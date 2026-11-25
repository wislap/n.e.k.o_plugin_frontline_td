// Fog-of-war state texture owner (P2): uploads the per-observer vision
// layer into an RGBA DataTexture (alpha per cell in the green channel —
// state 0 unexplored 0.85, 1 explored 0.45, 2 visible 0) and drives the
// shared FogUniforms (fog colour / haze per camera mode). The texture is
// rewritten in place only when the layer array identity changes.
// Consumption is inverted vs the old film: GameCanvas passes the shared
// uniforms to the ground materials, which apply `ftdFogApply`
// (render/shaders.ts) in their own fragments — there is no film mesh.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCameraStore } from '../../../client/camera-store';
import type { ResolvedMap } from '../../../content/index';
import { readLayer } from '../../../core/index';
import type { SceneLayerProps } from '../../../render/scene';
import type { FogUniforms } from '../../../render/shaders';
import { VISUAL } from '../../../render/theme/index';
import { markBuilt, useGpuResource } from '../../../render/use-gpu-resource';
import { VISION_STATE_LAYER_ID } from '../protocol';

const STATE_ALPHA = [Math.round(0.85 * 255), Math.round(0.45 * 255), 0] as const;

// Texture uploads live in a module-scope helper: the react-compiler lint
// treats hook-derived objects (refs) as immutable, so mutations of the
// texture happen inside a plain function whose params are not tracked.
function uploadFog(texture: THREE.DataTexture, layer: ArrayLike<number>, cells: number): void {
  const data = texture.image.data as Uint8Array;
  for (let i = 0; i < cells; i++) {
    data[i * 4 + 1] = STATE_ALPHA[layer[i] ?? 0] ?? 0;
  }
  texture.needsUpdate = true;
}

// Uniform sync lives in a module-scope helper for the same reason as
// uploadFog: shared uniform objects are mutated per frame.
function syncFogUniforms(
  uniforms: FogUniforms,
  texture: THREE.DataTexture,
  map: ResolvedMap,
): void {
  const theme = VISUAL;
  uniforms.uFtdFogMap.value = texture;
  uniforms.uFtdFogTexel.value.set(1 / map.grid.width, 1 / map.grid.height);
  uniforms.uFtdFogMapSize.value.set(map.grid.width, map.grid.height);
  const tactical = useCameraStore.getState().mode === 'tactical';
  // Same colour values the film carried; consumers mix them
  // post-encoding (see GLSL_FOG in render/shaders.ts).
  uniforms.uFtdFogColor.value.set(tactical ? '#333c3a' : theme.fogColor);
  uniforms.uFtdFogHaze.value.set(theme.background.haze || theme.fogColor);
  uniforms.uFtdFogHazeAmt.value = tactical ? 0 : 1;
}

export function FogOfWar({ ctx }: SceneLayerProps): null {
  const { client, map, fog: uniforms } = ctx;
  const texture = useMemo(() => {
    const { width, height } = map.grid;
    const tex = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }, [map]);
  useGpuResource(texture);
  const builtForLayer = useRef<ArrayLike<number> | null>(null);
  const builtForTexture = useRef<THREE.DataTexture | null>(null);

  useFrame(() => {
    syncFogUniforms(uniforms, texture, map);
    const latest = client.snapshots().latest;
    if (latest === null) {
      return;
    }
    const layer = readLayer(latest, `${VISION_STATE_LAYER_ID}#${latest.observer}`) ?? undefined;
    if (layer === undefined) {
      return;
    }
    // Key on both identities: a recreated texture (map change) must be
    // filled even when the layer array itself did not change.
    const freshLayer = markBuilt(builtForLayer, layer);
    const freshTexture = markBuilt(builtForTexture, texture);
    if (!freshLayer && !freshTexture) {
      return;
    }
    uploadFog(texture, layer, map.grid.width * map.grid.height);
  });

  return null;
}
