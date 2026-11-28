// Merged static terrain mesh (M2 C2): built once from the first snapshot's
// height layer; disposed on unmount. Themed worlds also get an
// out-of-bounds noise-hill skirt (never pickable) and shared uniforms
// for tactical info dim, blue cell-grid overlay, and logistics cover.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { visibleGroundHeight } from '../../../client/camera-math';
import { useCameraStore } from '../../../client/camera-store';
import { useInteractionStore } from '../../../client/interaction-store';
import { useUiStore } from '../../../client/ui-store';
import { cameraTransitionState } from '../../../render/camera-transition';
import { VISUAL } from '../../../render/theme/index';
import { TERRAIN_HEIGHT_LAYER_ID } from '../protocol';
import { readLayer } from '../../../core/index';
import type { SceneLayerProps } from '../../../render/scene';
import { useGpuResource } from '../../../render/use-gpu-resource';
import { buildOutskirtsGeometry, buildTerrainGeometry } from './geometry';
import { createThemedTerrainMaterial, type ThemedTerrainUniforms } from './themed-material';

function updateGridOverlayUniform(uniforms: ThemedTerrainUniforms | null): void {
  if (uniforms === null) {
    return;
  }
  const cam = useCameraStore.getState();
  const mode = useInteractionStore.getState().mode;
  const extent = visibleGroundHeight(cam.mode, cam.zoom, cam.pitchOffsetDeg);
  const specOpacity = extent < 16 ? 0.03 : extent > 70 ? 0.04 : 0.09;
  const tacOpacity = extent > 85 ? 0.11 : 0.24;
  const gridBlend = mode !== 'command' ? 1 : cameraTransitionState.blend;
  uniforms.gridOverlayOpacity.value = specOpacity + (tacOpacity - specOpacity) * gridBlend;
}

// Tactical info view (弱化显示): lock terrain uInfo2D in phase with the
// camera transition, or lerp toward the stationary debug-panel toggle.
function updateInfoUniform(
  uniforms: ThemedTerrainUniforms | null,
  themeInfo: boolean,
  delta: number,
): void {
  if (uniforms === null) {
    return;
  }
  const blend = cameraTransitionState.blend;
  const desired = themeInfo && useUiStore.getState().info2d ? blend : 0;
  const u = uniforms.info2d;
  if (blend > 0 && blend < 1) {
    u.value = desired;
    return;
  }
  u.value += (desired - u.value) * Math.min(1, delta * 8);
  if (Math.abs(u.value - desired) < 0.01) {
    u.value = desired;
  }
}

const NO_RAYCAST: THREE.Object3D['raycast'] = () => {};

export function TerrainMesh({ ctx }: SceneLayerProps) {
  const { map, fog, cover } = ctx;
  const { width, height, ramps } = map.grid;
  const theme = VISUAL;
  const meshRef = useRef<THREE.Mesh>(null);
  // Same read GameCanvas used to do and pass as a prop: this layer only
  // mounts after the ready gate, so the latest snapshot is populated.
  // Re-render semantics are unchanged (the component still re-renders
  // whenever GameCanvas does).
  const snapshot = ctx.client.snapshots().latest;
  const heights = readLayer(snapshot, TERRAIN_HEIGHT_LAYER_ID);

  const data = useMemo(() => {
    if (heights === null) {
      return null;
    }
    return buildTerrainGeometry(width, height, heights, ramps);
  }, [heights, width, height, ramps]);

  const geometry = useMemo(() => {
    if (data === null) {
      return null;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [data]);

  // Out-of-bounds noise-hill ring (visual-languages): same themed ramp
  // material, faded toward the horizon haze by distance past the border.
  const outskirtsGeometry = useMemo(() => {
    if (heights === null || theme.terrain.skirtCells <= 0) {
      return null;
    }
    const out = buildOutskirtsGeometry(width, height, heights, ramps, theme.terrain.skirtCells);
    if (out.indices.length === 0) {
      return null;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(out.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(out.indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [heights, width, height, ramps, theme]);

  useGpuResource(geometry);

  useGpuResource(outskirtsGeometry);

  // The same material instance serves the outskirts skirt mesh (in-bounds
  // cells see dOut = 0 so the haze fade is a no-op there).
  const themed = useMemo(() => {
    if (heights === null) {
      return null;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i] ?? 0;
      if (h < lo) {
        lo = h;
      }
      if (h > hi) {
        hi = h;
      }
    }
    return createThemedTerrainMaterial(theme, {
      heightMin: lo,
      heightMax: hi,
      mapWidth: width,
      mapHeight: height,
      hazeFade:
        theme.terrain.skirtCells > 0 && theme.background.haze !== ''
          ? {
              color: theme.background.haze,
              start: theme.terrain.skirtCells * 0.3,
              end: theme.terrain.skirtCells * 0.95,
            }
          : undefined,
      fog,
      cover,
    });
  }, [theme, heights, width, height, fog, cover]);

  useGpuResource(themed?.material);

  useFrame((_state, delta) => {
    const uniforms = themed?.uniforms ?? null;
    updateGridOverlayUniform(uniforms);
    updateInfoUniform(uniforms, theme.info2d, delta);
  });

  if (geometry === null) {
    return null;
  }
  return (
    <>
      <mesh
        ref={meshRef}
        geometry={geometry}
        frustumCulled={false}
        receiveShadow
        {...(themed !== null ? { material: themed.material } : {})}
      />
      {outskirtsGeometry !== null && (
        // No receiveShadow: projected shadows band across the rolling
        // skirt hills, and the dim/haze mixes flatten them into dirty
        // stripes — normal-based shading alone keeps the relief soft.
        <mesh
          geometry={outskirtsGeometry}
          frustumCulled={false}
          raycast={NO_RAYCAST}
          {...(themed !== null ? { material: themed.material } : {})}
        />
      )}
    </>
  );
}
