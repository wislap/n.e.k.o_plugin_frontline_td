// Language 4 「沙盘」— tilt-shift tabletop diorama: the map is a floating
// island block with soil/rock strata sides over a soft neutral void, with
// a contact shadow below and depth-of-field blur. Pastel low-saturation
// palette, soft fill, chunky toy-like rounded shapes. The info2d map is
// pale paper with ink survey lines.
import type { RenderTheme } from './types';

export const DIORAMA_THEME: RenderTheme = {
  id: 'diorama',
  accent: '#e2764a',
  exposure: 0.52,
  toneMapping: 'agx',
  environment: 'pmrem-sky',
  // The near-white studio sky would otherwise drown materials in ambient
  // light — keep the pale void but cut its IBL contribution hard.
  envIntensity: 0.35,
  outline: '#4a4038',
  // Survey paper fog: pale cartography sheet with height contours + dot
  // grid — reads as the "unexplored" page of the model's map.
  fogColor: '#efe9dc',
  fogSoft: true,
  fogStyle: 'survey',
  info2d: true,
  lighting: {
    hemiSky: '#f0ede4',
    hemiGround: '#a89a80',
    hemiIntensity: 0.6,
    sunColor: '#fff2dc',
    sunIntensity: 1.0,
    sunDir: [-0.45, 0.65, -0.4],
    rimColor: '#ffffff',
    rimIntensity: 0.22,
    rimDir: [0.55, 0.35, 0.6],
    shadow: true,
  },
  terrain: {
    // Pastel meadow: muted sage → pale straw; sandy cliffs.
    rampLow: '#7d9a5c',
    rampHigh: '#b3bd85',
    rampStrength: 1,
    cliffColor: '#b9a98c',
    cliffStart: 0.55,
    cliffEnd: 0.82,
    gridStrength: 0.06,
    grid3d: 0,
    noiseAmp: 0,
    dirt: '#ab9a78',
    slopeDarken: 0.12,
    edgeOcc: 0.06,
    edgeFadeDist: 10,
    // No skirt — the floating island block carries the edge.
    skirtCells: 0,
    pedestal: false,
    island: {
      depth: 22,
      strata: ['#a5825f', '#7d6247', '#5c4a37', '#463a2c', '#332a20'],
      shadowGap: 5,
    },
    // Pale paper slate for the info view — ink lines carry the read.
    info2dTint: [0.52, 0.5, 0.44],
  },
  post: {
    enabled: true,
    aoIntensity: 1.3,
    aoRadius: 0.5,
    bloomIntensity: 0.1,
    bloomThreshold: 0.97,
    vignette: 0.15,
    noiseOpacity: 0.02,
    contrast: 1.06,
    saturation: 0.98,
    dof: { offset: 0.4, focusArea: 0.3, feather: 0.55 },
  },
  materials: {
    // Toy paint: pastel shells, warm grey chassis, coral accent strips.
    unitBody: '#b5ac94',
    unitTrim: '#4d463c',
    structureBody: '#b8af97',
    structureTrim: '#514a40',
    unitEmissive: 'faction',
    structureEmissive: '#f0a860',
    emissiveBoost: 1.4,
    roughness: 0.65,
    metalness: 0.05,
    detail: 0.7,
  },
  markers: {
    accent: '#e2764a',
    secondary: '#4a4038',
    invalid: '#c94f3d',
    link: '#e89a52',
  },
  scatter: { kind: 'meadow', density: 0.5 },
  background: {
    // Soft neutral studio void — no platform, the island floats. All
    // three stops stay within ~4% so no band/ring can form at any pitch.
    kind: 'sky',
    top: '#ece7db',
    horizon: '#e7e2d4',
    bottom: '#e2dcc9',
    platform: '#dcd6c8',
    platformFadeStart: 0,
    platformFadeEnd: 0.5,
    haze: '#ece7dc',
  },
  geometry: { bevel: 0.08 },
  pad: {
    color: '#5c5346',
    edge: '#f0a860',
    margin: 0.35,
    height: 0.12,
    emissiveBoost: 1.4,
  },
};
