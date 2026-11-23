// Language 4 「沙盘」— tilt-shift tabletop diorama: the map is a floating
// island block with soil/rock strata sides over a soft neutral void, with
// a contact shadow below and depth-of-field blur. Pastel low-saturation
// palette, soft fill, chunky toy-like rounded shapes. The info2d map is
// pale paper with ink survey lines.
import type { RenderTheme } from './types';

export const DIORAMA_THEME: RenderTheme = {
  id: 'diorama',
  accent: '#e2764a',
  exposure: 0.82,
  toneMapping: 'agx',
  environment: 'pmrem-sky',
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
    sunIntensity: 1.2,
    sunDir: [-0.45, 0.65, -0.4],
    rimColor: '#ffffff',
    rimIntensity: 0.35,
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
      depth: 10,
      strata: ['#8a715a', '#7a6350', '#64513f', '#52433a', '#43362c'],
      shadowGap: 5,
    },
    // Pale paper slate for the info view — ink lines carry the read.
    info2dTint: [0.52, 0.5, 0.44],
  },
  post: {
    enabled: true,
    aoIntensity: 1.3,
    aoRadius: 0.5,
    bloomIntensity: 0.15,
    bloomThreshold: 0.92,
    vignette: 0.15,
    noiseOpacity: 0.02,
    contrast: 1.03,
    saturation: 0.92,
    dof: { offset: 0.38, focusArea: 0.45, feather: 0.35 },
  },
  materials: {
    // Toy paint: pastel shells, warm grey chassis, coral accent strips.
    unitBody: '#d9d2c0',
    unitTrim: '#4d463c',
    structureBody: '#dbd4c2',
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
    // Soft neutral studio void — no platform, the island floats.
    kind: 'sky',
    top: '#f4f1ea',
    horizon: '#eae5da',
    bottom: '#d5cec0',
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
