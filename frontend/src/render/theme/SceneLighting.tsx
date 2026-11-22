// Theme-driven scene lighting + renderer setup: hemisphere fill, shadow-
// casting sun fitted to the map bounds, rim light, tone mapping.
// GPU/state changes are applied in effects so theme switches restore the
// renderer cleanly; light objects themselves are recreated via `key`.
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useRenderTheme } from './useTheme';

const SHADOW_MAP_SIZE = 2048;
const SHADOW_MARGIN = 1.15;

// Renderer/scene mutations live in module-scope helpers: the react-compiler
// lint treats hook-derived objects as immutable, so the writes happen inside
// plain functions whose params are not tracked (same pattern as the fog
// texture upload in FogLayer).
function applyRendererSettings(
  gl: THREE.WebGLRenderer,
  themed: boolean,
  exposure: number,
): () => void {
  const prev = {
    tone: gl.toneMapping,
    exposure: gl.toneMappingExposure,
    shadow: gl.shadowMap.enabled,
    shadowType: gl.shadowMap.type,
  };
  if (themed) {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
  } else {
    gl.toneMapping = THREE.NoToneMapping;
    gl.toneMappingExposure = 1;
    gl.shadowMap.enabled = false;
  }
  return () => {
    gl.toneMapping = prev.tone;
    gl.toneMappingExposure = prev.exposure;
    gl.shadowMap.enabled = prev.shadow;
    gl.shadowMap.type = prev.shadowType;
  };
}

function applySceneBackground(
  scene: THREE.Scene,
  themed: boolean,
  haze: string,
  extent: number,
): () => void {
  const prev = scene.background;
  const prevFog = scene.fog;
  if (!themed) {
    scene.background = null;
  }
  if (themed && haze !== '') {
    scene.fog = new THREE.Fog(new THREE.Color(haze), extent * 0.9, extent * 2.6);
  }
  return () => {
    scene.background = prev;
    scene.fog = prevFog;
  };
}

export function SceneLighting({ mapWidth, mapHeight }: { mapWidth: number; mapHeight: number }) {
  const theme = useRenderTheme();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const { lighting, exposure, id } = theme;

  // Tone mapping + shadow map toggle; restored to renderer defaults on
  // theme change/unmount so `legacy` stays the untouched control.
  useEffect(() => {
    return applyRendererSettings(gl, id !== 'legacy', exposure);
  }, [gl, id, exposure]);

  const diag = Math.hypot(mapWidth, mapHeight);

  useEffect(() => {
    return applySceneBackground(scene, id !== 'legacy', theme.background.haze, diag * 0.5);
  }, [scene, id, theme.background.haze, diag]);
  const cx = mapWidth / 2;
  const cz = mapHeight / 2;
  const sunPos: [number, number, number] = [
    cx + lighting.sunDir[0] * diag,
    lighting.sunDir[1] * diag,
    cz + lighting.sunDir[2] * diag,
  ];
  const rimPos: [number, number, number] = [
    cx + lighting.rimDir[0] * diag,
    lighting.rimDir[1] * diag,
    cz + lighting.rimDir[2] * diag,
  ];
  const extent = (diag / 2) * SHADOW_MARGIN;
  // The light target must live in the scene graph for its matrix to update.
  const target = useMemo(() => new THREE.Object3D(), []);

  return (
    <group key={id}>
      <primitive object={target} position={[cx, 0, cz]} />
      <hemisphereLight args={[lighting.hemiSky, lighting.hemiGround, lighting.hemiIntensity]} />
      <directionalLight
        position={sunPos}
        intensity={lighting.sunIntensity}
        color={lighting.sunColor}
        castShadow={lighting.shadow}
        target={target}
        shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
        shadow-camera-near={1}
        shadow-camera-far={diag * 3}
      />
      <directionalLight
        position={rimPos}
        intensity={lighting.rimIntensity}
        color={lighting.rimColor}
      />
    </group>
  );
}
