// Language 1 「晴野」— stylized PBR daylight, the closest language to
// Endfield in-game: PMREM environment from the procedural sky, AgX tone
// mapping, soft shadows, lush grass + flowers, graphite foundation pads
// with emissive trim, procedural seams/stripes/printed codes, glowing
// road tracks.
import type { RenderTheme } from './types';

export const FIELD_THEME: RenderTheme = {
  id: 'field',
  accent: '#FFE600',
  exposure: 0.9,
  toneMapping: 'agx',
  environment: 'pmrem-sky',
  outline: '#22251f',
  // 'dim' fog: terrain reads through this dark slate film on unexplored
  // cells — darkened and desaturated, hazed toward the sky, never paper.
  fogColor: '#3d453a',
  fogSoft: true,
  fogStyle: 'dim',
  info2d: true,
  lighting: {
    // Hemisphere is dimmed — most ambient comes from the PMREM sky.
    hemiSky: '#bcd8ee',
    hemiGround: '#5f7f4d',
    hemiIntensity: 0.4,
    sunColor: '#fff0d0',
    sunIntensity: 2.1,
    sunDir: [-0.55, 0.6, -0.42],
    rimColor: '#cfe4f0',
    rimIntensity: 0.25,
    rimDir: [0.55, 0.32, 0.6],
    shadow: true,
  },
  terrain: {
    // Meadow ramp: valley green → sunlit grass, warm dirt on cliffs.
    rampLow: '#4f7c3e',
    rampHigh: '#9cbf74',
    rampStrength: 1,
    cliffColor: '#a99e88',
    cliffStart: 0.55,
    cliffEnd: 0.82,
    // Grid is an information layer — drawn only in the info2d view.
    gridStrength: 0.07,
    grid3d: 0,
    // Continuous macro noise only — no per-cell hash colour in 3D.
    noiseAmp: 0,
    dirt: '#8d8368',
    slopeDarken: 0.2,
    edgeOcc: 0.1,
    edgeFadeDist: 14,
    // Wide hill ring so max zoom-out always sees land fading into haze.
    skirtCells: 30,
    pedestal: false,
  },
  post: {
    enabled: true,
    aoIntensity: 1.4,
    aoRadius: 0.55,
    bloomIntensity: 0.25,
    bloomThreshold: 0.9,
    vignette: 0,
    noiseOpacity: 0,
    contrast: 1.06,
    saturation: 1.08,
  },
  materials: {
    // Painted plates read as ~0.8 albedo off-white under AgX — below the
    // clip point so sun highlights keep tonal variation.
    unitBody: '#d8d9d1',
    unitTrim: '#25282a',
    structureBody: '#d9dad2',
    structureTrim: '#26292c',
    unitEmissive: 'faction',
    structureEmissive: '#ff9a2a',
    emissiveBoost: 1.2,
    roughness: 0.55,
    metalness: 0.08,
    detail: 1,
  },
  markers: {
    accent: '#FFE600',
    secondary: '#1f2123',
    invalid: '#d43a2e',
    link: '#ff9a2a',
  },
  scatter: { kind: 'meadow', density: 0.55 },
  background: {
    kind: 'sky',
    top: '#a9ccec',
    horizon: '#eef3ec',
    bottom: '#a8b49a',
    platform: '#92ad72',
    platformFadeStart: 0.5,
    platformFadeEnd: 1.05,
    haze: '#e4ecdf',
  },
  geometry: { bevel: 0.04 },
  pad: {
    color: '#26292c',
    edge: '#ff9a2a',
    margin: 0.35,
    height: 0.12,
    emissiveBoost: 1.6,
  },
};
