// Merged static terrain mesh (M2 C2): built once from the first snapshot's
// height/surface layers plus the content palette; disposed on unmount.
// Themed worlds also get an out-of-bounds noise-hill skirt (never
// pickable) and a uInfo2D uniform for the tactical info dim.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { visibleGroundHeight } from '../../../client/camera-math';
import { useCameraStore } from '../../../client/camera-store';
import { useInteractionStore } from '../../../client/interaction-store';
import { useUiStore } from '../../../client/ui-store';
import { useRenderTheme } from '../../../render/theme/index';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../protocol';
import type { Snapshot } from '../../../core/index';
import { buildOutskirtsGeometry, buildTerrainGeometry, parseHexColor } from './geometry';
import { createThemedTerrainMaterial, type ThemedTerrainUniforms } from './themed-material';

export interface TerrainMeshProps {
  snapshot: Snapshot | null;
  width: number;
  height: number;
  ramps: ArrayLike<number>;
  surfaceColors: readonly string[];
}

function createTerrainGridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uOpacity: { value: 0 },
    },
    vertexShader: `
      varying vec2 vWorldXZ;
      varying float vUp;
      void main() {
        vWorldXZ = position.xz;
        vUp = normal.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec2 vWorldXZ;
      varying float vUp;
      void main() {
        vec2 cellCoord = abs(fract(vWorldXZ - 0.5) - 0.5) / max(fwidth(vWorldXZ), vec2(1e-4));
        float cellLine = 1.0 - min(min(cellCoord.x, cellCoord.y), 1.0);
        vec2 secCoord = abs(fract(vWorldXZ / 8.0 - 0.5) - 0.5) / max(fwidth(vWorldXZ / 8.0), vec2(1e-4));
        float secLine = 1.0 - min(min(secCoord.x, secCoord.y), 1.0);
        float flatMask = smoothstep(0.35, 0.75, vUp);
        float alpha = clamp(max(cellLine * 0.65, secLine * 1.15) * flatMask * uOpacity, 0.0, 1.0);
        gl_FragColor = vec4(0.55, 0.78, 0.96, alpha);
      }
    `,
  });
}

function updateTerrainGrid(mesh: THREE.Mesh, mat: THREE.ShaderMaterial): void {
  if (mesh.material !== mat) {
    mesh.material = mat;
  }
  mesh.visible = true;
  const cam = useCameraStore.getState();
  const mode = useInteractionStore.getState().mode;
  const extent = visibleGroundHeight(cam.mode, cam.zoom, cam.pitchOffsetDeg);
  const opacity =
    cam.mode === 'tactical' || mode !== 'command'
      ? extent > 85
        ? 0.11
        : 0.24
      : extent < 16
        ? 0.03
        : extent > 70
          ? 0.04
          : 0.09;
  const uOpacity = mat.uniforms['uOpacity'];
  if (uOpacity !== undefined) {
    uOpacity.value = opacity;
  }
}

// Tactical info view (弱化显示): lerp the terrain's uInfo2D uniform toward
// 1 while the camera is in tactical mode and the debug toggle allows it.
function updateInfoUniform(
  uniforms: ThemedTerrainUniforms | null,
  themeInfo: boolean,
  delta: number,
): void {
  if (uniforms === null) {
    return;
  }
  const cam = useCameraStore.getState();
  const target = themeInfo && useUiStore.getState().info2d && cam.mode === 'tactical' ? 1 : 0;
  const u = uniforms.info2d;
  u.value += (target - u.value) * Math.min(1, delta * 8);
  if (Math.abs(u.value - target) < 0.01) {
    u.value = target;
  }
}

const NO_RAYCAST: THREE.Object3D['raycast'] = () => {};

export function TerrainMesh({ snapshot, width, height, ramps, surfaceColors }: TerrainMeshProps) {
  const theme = useRenderTheme();
  const meshRef = useRef<THREE.Mesh>(null);
  const gridMeshRef = useRef<THREE.Mesh>(null);
  const gridMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const heights = snapshot?.layers[TERRAIN_HEIGHT_LAYER_ID];
  const surfaces = snapshot?.layers[TERRAIN_SURFACE_LAYER_ID];

  const data = useMemo(() => {
    if (heights === undefined || surfaces === undefined) {
      return null;
    }
    return buildTerrainGeometry(
      width,
      height,
      heights,
      surfaces,
      ramps,
      surfaceColors.map(parseHexColor),
    );
  }, [heights, surfaces, width, height, ramps, surfaceColors]);

  const geometry = useMemo(() => {
    if (data === null) {
      return null;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [data]);

  // Out-of-bounds noise-hill ring (visual-languages): same themed ramp
  // material, faded toward the horizon haze by distance past the border.
  const outskirtsGeometry = useMemo(() => {
    if (heights === undefined || theme.terrain.skirtCells <= 0) {
      return null;
    }
    const out = buildOutskirtsGeometry(width, height, heights, ramps, theme.terrain.skirtCells);
    if (out.indices.length === 0) {
      return null;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(out.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(out.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(out.indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [heights, width, height, ramps, theme]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  useEffect(() => {
    return () => {
      outskirtsGeometry?.dispose();
    };
  }, [outskirtsGeometry]);

  useEffect(() => {
    return () => {
      gridMatRef.current?.dispose();
      gridMatRef.current = null;
    };
  }, []);

  // The same material instance serves the outskirts skirt mesh (in-bounds
  // cells see dOut = 0 so the haze fade is a no-op there).
  const themed = useMemo(() => {
    if (heights === undefined) {
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
    });
  }, [theme, heights, width, height]);

  useEffect(() => {
    return () => {
      themed?.material.dispose();
    };
  }, [themed]);

  useFrame((_state, delta) => {
    const gridMesh = gridMeshRef.current;
    if (gridMesh !== null) {
      gridMatRef.current ??= createTerrainGridMaterial();
      updateTerrainGrid(gridMesh, gridMatRef.current);
    }
    updateInfoUniform(themed?.uniforms ?? null, theme.info2d, delta);
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
        <mesh
          geometry={outskirtsGeometry}
          frustumCulled={false}
          raycast={NO_RAYCAST}
          receiveShadow
          {...(themed !== null ? { material: themed.material } : {})}
        />
      )}
      <mesh
        ref={gridMeshRef}
        geometry={geometry}
        renderOrder={1}
        visible={false}
        frustumCulled={false}
      />
    </>
  );
}
