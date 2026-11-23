// Road layer (M3 E3): paved cells from the global
// 'frontline_td:logistics.road' layer drawn as quads slightly above the
// terrain (z-fighting lift). Layers arrive as deltas, so the instance
// buffer is rebuilt only when the layer array identity changes.
// Visual-languages: the `field` theme swaps the flat lambert fill for a
// graphite track bed with a glowing edge trim (bloom feeds the road net).
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import type { ResolvedMap } from '../../../content/index';
import { useRenderTheme } from '../../../render/theme/index';
import { terrainY } from '../../../render/world';
import { ROAD_LAYER_ID } from '../protocol';

const ROAD_COLOR = '#8f7355';
const LIFT = 0.03;
const CAP = 65536;
const ATTACH_MATERIAL = 'material';

function createRoadGlowMaterial(edge: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBed: { value: new THREE.Color('#24282b') },
      uEdge: { value: new THREE.Color(edge) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uBed;
      uniform vec3 uEdge;
      varying vec2 vUv;
      void main() {
        // Thin emissive trim just inside the cell border + two darker
        // tread bands along the road axis.
        vec2 b = min(vUv, 1.0 - vUv);
        float edge = 1.0 - smoothstep(0.02, 0.07, min(b.x, b.y));
        float tread = smoothstep(0.30, 0.34, abs(vUv.y - 0.5));
        vec3 col = uBed * mix(0.72, 1.0, tread);
        col = mix(col, uEdge * 1.6, edge);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export interface RoadLayerProps {
  client: SimClient;
  map: ResolvedMap;
  heights: ArrayLike<number>;
}

export function RoadLayer({ client, map, heights }: RoadLayerProps) {
  const theme = useRenderTheme();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const builtFor = useRef<ArrayLike<number> | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const glowMat = useMemo(
    () => (theme.id === 'field' ? createRoadGlowMaterial(theme.markers.link) : null),
    [theme],
  );
  useEffect(() => {
    return () => {
      glowMat?.dispose();
    };
  }, [glowMat]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (mesh === null) {
      return;
    }
    const layer = client.snapshots().latest?.layers[ROAD_LAYER_ID];
    if (layer === undefined || layer === builtFor.current) {
      return;
    }
    builtFor.current = layer;
    const { width, height } = map.grid;
    let count = 0;
    for (let y = 0; y < height && count < CAP; y++) {
      for (let x = 0; x < width && count < CAP; x++) {
        if ((layer[y * width + x] ?? 0) < 1) {
          continue;
        }
        dummy.position.set(
          x + 0.5,
          terrainY(heights, width, height, x + 0.5, y + 0.5) + LIFT,
          y + 0.5,
        );
        dummy.scale.set(0.96, 1, 0.96);
        dummy.updateMatrix();
        mesh.setMatrixAt(count, dummy.matrix);
        count += 1;
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, CAP]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} rotateX={-Math.PI / 2} />
      {glowMat === null ? (
        <meshLambertMaterial color={ROAD_COLOR} />
      ) : (
        <primitive object={glowMat} attach={ATTACH_MATERIAL} />
      )}
    </instancedMesh>
  );
}
