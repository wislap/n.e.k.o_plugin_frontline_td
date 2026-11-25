// Scene lighting + renderer setup: hemisphere fill, shadow-casting sun
// fitted to the map bounds, rim light, PMREM sky
// environment. GPU/state changes are applied in effects.
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCameraStore } from '../../client/camera-store';
import { useUiStore } from '../../client/ui-store';
import { VISUAL } from './visual';
import type { RenderVisual } from './visual';

const SHADOW_MAP_SIZE = 2048;
const SHADOW_MARGIN = 1.15;

// Renderer/scene mutations live in module-scope helpers: the react-compiler
// lint treats hook-derived objects as immutable, so the writes happen inside
// plain functions whose params are not tracked (same pattern as the fog
// texture upload in FogOfWar).
function applyRendererSettings(gl: THREE.WebGLRenderer): () => void {
  const prev = {
    shadow: gl.shadowMap.enabled,
    shadowType: gl.shadowMap.type,
    onShaderError: gl.debug.onShaderError,
  };
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFShadowMap;
  // One-line shader failure marker: the e2e console listener turns any
  // console.error into a test failure, so a broken program can never ship
  // silently (three's default report is multi-line and buries the cause).
  gl.debug.onShaderError = (
    _ctx: WebGLRenderingContext,
    program: WebGLProgram,
    vertexShader: WebGLShader,
    fragmentShader: WebGLShader,
  ) => {
    const firstLine = (log: string | null): string => (log ?? '').trim().split('\n')[0] ?? '';
    const name = (program as unknown as { name?: string }).name ?? 'unnamed';
    console.error(
      `ShaderCompileError: ${name} | ${firstLine(_ctx.getProgramInfoLog(program))}` +
        ` | vertex: ${firstLine(_ctx.getShaderInfoLog(vertexShader))}` +
        ` | fragment: ${firstLine(_ctx.getShaderInfoLog(fragmentShader))}`,
    );
  };
  return () => {
    gl.shadowMap.enabled = prev.shadow;
    gl.shadowMap.type = prev.shadowType;
    gl.debug.onShaderError = prev.onShaderError;
  };
}

// Builds the tiny gradient-sky scene the PMREM generator samples so
// ambient light/reflections come from the theme's own sky palette.
function buildSkyEnvScene(theme: RenderVisual): { scene: THREE.Scene; dispose: () => void } {
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTop: { value: new THREE.Color(theme.background.top) },
      uHorizon: { value: new THREE.Color(theme.background.horizon) },
      uBottom: { value: new THREE.Color(theme.background.bottom) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uBottom;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h > 0.0
          ? mix(uHorizon, uTop, pow(min(h * 1.6, 1.0), 0.7))
          : mix(uHorizon, uBottom, min(-h * 2.5, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geo, mat));
  return {
    scene,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

function applyPmremEnvironment(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  theme: RenderVisual,
): () => void {
  const sky = buildSkyEnvScene(theme);
  const pmrem = new THREE.PMREMGenerator(gl);
  const rt = pmrem.fromScene(sky.scene, 0.06);
  const prev = scene.environment;
  const prevIntensity = scene.environmentIntensity;
  scene.environment = rt.texture;
  scene.environmentIntensity = theme.envIntensity ?? 1;
  return () => {
    scene.environment = prev;
    scene.environmentIntensity = prevIntensity;
    rt.dispose();
    pmrem.dispose();
    sky.dispose();
  };
}

// Per-frame haze gate: the horizon fog is a 3D-spectate effect. At
// tactical height the whole map sits inside the fog range and washes out
// to paper, so near/far are pushed out of range in the 2D info view.
// Module-scope so the react-compiler immutability rule does not track
// the hook-derived scene.
function updateSceneFog(
  scene: THREE.Scene,
  mode: string,
  diag: number,
  nearF: number,
  farF: number,
): void {
  const fog = scene.fog;
  if (fog === null || !(fog instanceof THREE.Fog)) {
    return;
  }
  const near = mode === 'tactical' ? diag * 20 : diag * nearF;
  const far = mode === 'tactical' ? diag * 21 : diag * farF;
  if (fog.near !== near) {
    fog.near = near;
    fog.far = far;
  }
}

function applySceneBackground(scene: THREE.Scene, haze: string, extent: number): () => void {
  const prev = scene.background;
  const prevFog = scene.fog;
  if (haze !== '') {
    scene.fog = new THREE.Fog(new THREE.Color(haze), extent * 0.9, extent * 2.6);
  }
  return () => {
    scene.background = prev;
    scene.fog = prevFog;
  };
}

export function SceneLighting({ mapWidth, mapHeight }: { mapWidth: number; mapHeight: number }) {
  const theme = VISUAL;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const { lighting } = theme;
  // Debug-panel render-cost toggle: drops the sun's shadow pass.
  const shadows = useUiStore((s) => s.renderCost.shadows);

  useEffect(() => {
    return applyRendererSettings(gl);
  }, [gl]);

  // PMREM environment from the procedural sky: MeshStandardMaterials pick
  // up ambient/reflection light from scene.environment.
  useEffect(() => {
    return applyPmremEnvironment(gl, scene, theme);
  }, [gl, scene, theme]);

  const diag = Math.hypot(mapWidth, mapHeight);

  useEffect(() => {
    return applySceneBackground(scene, theme.background.haze, diag * 0.5);
  }, [scene, theme.background.haze, diag]);

  // The horizon haze is a 3D-spectate effect: at tactical height the whole
  // map sits inside the fog range and washes out to paper, so the fog is
  // pushed out of range while the camera is in the 2D info view.
  useFrame(() => {
    updateSceneFog(scene, useCameraStore.getState().mode, diag, theme.hazeNear, theme.hazeFar);
  });
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
    <group>
      <primitive object={target} position={[cx, 0, cz]} />
      <hemisphereLight args={[lighting.hemiSky, lighting.hemiGround, lighting.hemiIntensity]} />
      <directionalLight
        position={sunPos}
        intensity={lighting.sunIntensity}
        color={lighting.sunColor}
        castShadow={lighting.shadow && shadows}
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
