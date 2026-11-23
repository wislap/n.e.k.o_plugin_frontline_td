// Language 3 「雾境」— overcast cinematic: soft grey key light, strong
// cool sky fill, very soft shadows, dense height fog swallowing the
// horizon, desaturated deep greens and wet dark stone. Machines are
// graphite with lime emissive accents over hard-surface shapes; the
// info2d map is dark and glassy.
import type { RenderTheme } from './types';

export const MIST_THEME: RenderTheme = {
  id: 'mist',
  accent: '#b8f53c',
  exposure: 0.88,
  toneMapping: 'agx',
  environment: 'pmrem-sky',
  outline: '#10141a',
  // Unexplored cells sink into wet slate — slightly blue-green, dim.
  fogColor: '#242e2c',
  fogSoft: true,
  fogStyle: 'dim',
  info2d: true,
  lighting: {
    // Overcast dome: the sky is the light; sun barely breaks through.
    hemiSky: '#b8c4cc',
    hemiGround: '#46524a',
    hemiIntensity: 1.05,
    sunColor: '#d8dcd2',
    sunIntensity: 0.9,
    sunDir: [-0.4, 0.7, -0.35],
    rimColor: '#dfe8e6',
    rimIntensity: 0.5,
    rimDir: [0.5, 0.4, 0.55],
    shadow: true,
  },
  terrain: {
    // Desaturated deep greens, wet dark stone on cliffs.
    rampLow: '#37473a',
    rampHigh: '#5f7355',
    rampStrength: 1,
    cliffColor: '#4a4f4b',
    cliffStart: 0.5,
    cliffEnd: 0.8,
    gridStrength: 0.08,
    grid3d: 0,
    noiseAmp: 0,
    dirt: '#4e4a3c',
    slopeDarken: 0.3,
    edgeOcc: 0.2,
    edgeFadeDist: 12,
    skirtCells: 30,
    pedestal: false,
    info2dTint: [0.16, 0.21, 0.21],
  },
  post: {
    enabled: true,
    aoIntensity: 1.6,
    aoRadius: 0.6,
    bloomIntensity: 0.35,
    bloomThreshold: 0.85,
    vignette: 0.35,
    noiseOpacity: 0.04,
    contrast: 1.04,
    saturation: 0.8,
  },
  materials: {
    // Graphite machines; lime only in emissive strips.
    unitBody: '#4a5052',
    unitTrim: '#23282a',
    structureBody: '#434a4d',
    structureTrim: '#22272a',
    unitEmissive: 'faction',
    structureEmissive: '#b8f53c',
    emissiveBoost: 1.8,
    roughness: 0.5,
    metalness: 0.35,
    detail: 0.6,
  },
  markers: {
    accent: '#b8f53c',
    secondary: '#1a1f22',
    invalid: '#e05a4a',
    link: '#b8f53c',
  },
  scatter: { kind: 'clutter', density: 0.5 },
  background: {
    kind: 'sky',
    top: '#7d8a94',
    horizon: '#b6c2c0',
    bottom: '#5f6a66',
    platform: '#4c584f',
    platformFadeStart: 0.4,
    platformFadeEnd: 0.9,
    haze: '#aeb9b4',
    // Dense mist: fog starts close and saturates mid-distance.
    fogNear: 0.18,
    fogFar: 0.9,
  },
  geometry: { bevel: 0.025 },
  pad: {
    color: '#1c2123',
    edge: '#b8f53c',
    margin: 0.35,
    height: 0.12,
    emissiveBoost: 1.8,
  },
};
