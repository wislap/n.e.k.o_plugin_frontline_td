// Scene lighting + renderer setup: hemisphere fill, shadow-casting sun
// fitted to the map bounds, rim light, PMREM sky
// environment. GPU/state changes are applied in effects.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useUiStore } from '../../client/ui-store';
import { cameraTransitionState } from '../camera-transition';
import type { SceneLayerProps } from '../scene';
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
    shadowAutoUpdate: gl.shadowMap.autoUpdate,
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
    gl.shadowMap.autoUpdate = prev.shadowAutoUpdate;
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
  scene.environmentIntensity = 1;
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
// to paper, so near/far are pushed out of range and fog color dims toward
// dark tactical slate as blend approaches 1. During Dolly-Zoom, +extraDist
// cancels the telephoto pullback so fog never washes out mid-transition.
// Module-scope so the react-compiler immutability rule does not track the
// hook-derived scene/renderer.
const TACTICAL_SCENE_FOG_HEX = '#141a18';
let tacticalSceneFogColor: THREE.Color | null = null;
let baseSceneFogColor: THREE.Color | null = null;

function updateSceneFog(
  scene: THREE.Scene,
  blend: number,
  extraDist: number,
  diag: number,
  nearF: number,
  farF: number,
  hazeColor: string,
  info2dActive: boolean,
): void {
  const fog = scene.fog;
  if (fog === null || !(fog instanceof THREE.Fog)) {
    return;
  }
  const inv = 1 / Math.max(0.02, 1 - blend);
  const near = diag * nearF * inv + extraDist;
  const far = diag * farF * inv + extraDist;
  if (Math.abs(fog.near - near) > 1e-3 || Math.abs(fog.far - far) > 1e-3) {
    fog.near = near;
    fog.far = far;
  }
  if (hazeColor !== '') {
    const colorBlend = info2dActive ? Math.min(1, blend * 1.6) : 0;
    const base = (baseSceneFogColor ??= new THREE.Color());
    const tactical = (tacticalSceneFogColor ??= new THREE.Color(TACTICAL_SCENE_FOG_HEX));
    base.set(hazeColor);
    fog.color.copy(base).lerp(tactical, colorBlend);
  }
}

function syncShadowTransition(
  gl: THREE.WebGLRenderer,
  light: THREE.DirectionalLight | null,
  shadowsOn: boolean,
  blend: number,
): void {
  if (light !== null) {
    const targetInt = shadowsOn ? 1 - blend : 0;
    if (Math.abs(light.shadow.intensity - targetInt) > 1e-4) {
      light.shadow.intensity = targetInt;
    }
  }
  const auto = shadowsOn && (blend < 1 || light?.shadow.map === null);
  if (gl.shadowMap.autoUpdate !== auto) {
    gl.shadowMap.autoUpdate = auto;
    if (auto) {
      gl.shadowMap.needsUpdate = true;
    }
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

export function SceneLighting({ ctx }: SceneLayerProps) {
  const { width: mapWidth, height: mapHeight } = ctx.map.grid;
  const theme = VISUAL;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const { lighting } = theme;
  // Debug-panel render-cost toggle: drops the sun's shadow pass.
  const shadows = useUiStore((s) => s.renderCost.shadows);
  const sunRef = useRef<THREE.DirectionalLight>(null);

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

  // Sync fog range, fog tint, and directional shadow intensity/autoUpdate with
  // the per-frame camera transition state without toggling castShadow.
  useFrame(() => {
    updateSceneFog(
      scene,
      cameraTransitionState.blend,
      cameraTransitionState.extraDist,
      diag,
      theme.hazeNear,
      theme.hazeFar,
      theme.background.haze,
      theme.info2d && useUiStore.getState().info2d,
    );
    syncShadowTransition(
      gl,
      sunRef.current,
      lighting.shadow && shadows,
      cameraTransitionState.blend,
    );
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
        ref={sunRef}
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
