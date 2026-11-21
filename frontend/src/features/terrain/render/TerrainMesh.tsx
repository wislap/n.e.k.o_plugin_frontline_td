// Merged static terrain mesh (M2 C2): built once from the first snapshot's
// height/surface layers plus the content palette; disposed on unmount.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { visibleGroundHeight } from '../../../client/camera-math';
import { useCameraStore } from '../../../client/camera-store';
import { useInteractionStore } from '../../../client/interaction-store';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../protocol';
import type { Snapshot } from '../../../core/index';
import { buildTerrainGeometry, parseHexColor } from './geometry';

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
  const extent = visibleGroundHeight(cam.mode, cam.zoom);
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

export function TerrainMesh({ snapshot, width, height, ramps, surfaceColors }: TerrainMeshProps) {
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

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  useEffect(() => {
    return () => {
      gridMatRef.current?.dispose();
      gridMatRef.current = null;
    };
  }, []);

  useFrame(() => {
    const gridMesh = gridMeshRef.current;
    if (gridMesh === null) {
      return;
    }
    gridMatRef.current ??= createTerrainGridMaterial();
    updateTerrainGrid(gridMesh, gridMatRef.current);
  });

  if (geometry === null) {
    return null;
  }
  return (
    <>
      <mesh ref={meshRef} geometry={geometry} frustumCulled={false}>
        <meshLambertMaterial vertexColors />
      </mesh>
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
