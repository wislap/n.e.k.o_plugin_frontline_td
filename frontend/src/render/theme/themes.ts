// Visual-slice theme parameters: pure data, keyed by ThemeId. Consumed by
// the render layer (lighting, terrain shader, background, fog, post).
// 'legacy' reproduces the pre-slice look and is the control variant.
import type { ThemeId } from '../../client/theme';

interface ThemeLighting {
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  // Sun direction is expressed as an offset in map-diagonal units from the
  // map centre (x east, y up, z south).
  sunColor: string;
  sunIntensity: number;
  sunDir: readonly [number, number, number];
  rimColor: string;
  rimIntensity: number;
  rimDir: readonly [number, number, number];
  shadow: boolean;
}

interface ThemeTerrain {
  // Height ramp: vertex surface colors are mixed toward rampLow/rampHigh by
  // normalized terrain height, then scaled by rampStrength.
  rampLow: string;
  rampHigh: string;
  rampStrength: number;
  cliffColor: string;
  // normal.y smoothstep range over which the cliff color blends in.
  cliffStart: number;
  cliffEnd: number;
  gridStrength: number;
  noiseAmp: number;
  // 'cell' = one hash per map cell; 'pixel' = quantize to 1/8 cell pixels
  // (mindustry-style pixel noise).
  noiseStyle: 'cell' | 'pixel';
  slopeDarken: number;
  // Edge occlusion: fraction of darkening at the map border, fading inward
  // over edgeFadeDist cells.
  edgeOcc: number;
  edgeFadeDist: number;
}

interface ThemePost {
  enabled: boolean;
  aoIntensity: number;
  aoRadius: number;
  bloomIntensity: number;
  bloomThreshold: number;
  vignette: number;
  noiseOpacity: number;
  // Grade (stage 2): contrast multiplier around mid-grey, saturation scale.
  contrast: number;
  saturation: number;
}

interface ThemeMaterials {
  // Faction-accent scheme (stage 2 item 1): neutral bodies, faction color
  // reserved for accents, plus emissive light details that feed bloom.
  unitBody: string;
  structureBody: string;
  structureTrim: string;
  // 'faction' = per-instance faction color; otherwise a fixed hex.
  unitEmissive: 'faction' | (string & {});
  structureEmissive: 'faction' | (string & {});
  // Emissive intensity multiplier so the detail clears the bloom threshold.
  emissiveBoost: number;
  roughness: number;
  metalness: number;
}

interface ThemeMarkers {
  accent: string;
  secondary: string;
  invalid: string;
  link: string;
}

// Fog of war treatment (stage 2 item 4): 'plain' = soft dark film,
// 'hatch' = faint diagonal lines on unexplored, 'grid' = faint cell grid.
type FogStyle = 'plain' | 'hatch' | 'grid';

interface ThemeScatter {
  // Which prop sets to spawn: 'clutter' (rocks/debris/tufts), 'studs'
  // (emissive seam studs + floor panels), 'boulders' (boulders/pebbles/
  // ore crystals).
  kind: 'none' | 'clutter' | 'studs' | 'boulders';
  density: number;
}

interface ThemeBackground {
  kind: 'none' | 'sky' | 'nebula' | 'rock';
  // Dome gradient: zenith → horizon → below-horizon.
  top: string;
  horizon: string;
  bottom: string;
  // Far ground platform under/around the map, fading out radially.
  platform: string;
  platformFadeStart: number;
  platformFadeEnd: number;
  // Optional far grid lines on the platform (shapez) and nebula tints —
  // nebula/nebula2 are the two fbm hues (e.g. purple and teal).
  platformGrid: string;
  platformGridAlpha: number;
  nebula: string;
  nebula2: string;
}

export interface RenderTheme {
  id: ThemeId;
  accent: string;
  exposure: number;
  fogColor: string;
  fogSoft: boolean;
  fogStyle: FogStyle;
  lighting: ThemeLighting;
  terrain: ThemeTerrain;
  post: ThemePost;
  background: ThemeBackground;
  materials: ThemeMaterials;
  markers: ThemeMarkers;
  scatter: ThemeScatter;
}

const LEGACY_TERRAIN: ThemeTerrain = {
  rampLow: '#ffffff',
  rampHigh: '#ffffff',
  rampStrength: 0,
  cliffColor: '#ffffff',
  cliffStart: 1,
  cliffEnd: 1,
  gridStrength: 0,
  noiseAmp: 0,
  noiseStyle: 'cell',
  slopeDarken: 0,
  edgeOcc: 0,
  edgeFadeDist: 1,
};

export const RENDER_THEMES: Record<ThemeId, RenderTheme> = {
  legacy: {
    id: 'legacy',
    accent: '#ffe08a',
    exposure: 1,
    fogColor: '#05070d',
    fogSoft: false,
    fogStyle: 'plain',
    lighting: {
      hemiSky: '#bcd4ff',
      hemiGround: '#3a2f22',
      hemiIntensity: 0.9,
      sunColor: '#ffffff',
      sunIntensity: 1.2,
      sunDir: [0.4, 0.6, 0.2],
      rimColor: '#9ec5ff',
      rimIntensity: 0.35,
      rimDir: [-0.32, 0.38, -0.28],
      shadow: false,
    },
    terrain: LEGACY_TERRAIN,
    post: {
      enabled: false,
      aoIntensity: 0,
      aoRadius: 0,
      bloomIntensity: 0,
      bloomThreshold: 1,
      vignette: 0,
      noiseOpacity: 0,
      contrast: 1,
      saturation: 1,
    },
    materials: {
      unitBody: '#ffffff',
      structureBody: '#ffffff',
      structureTrim: '#ffffff',
      unitEmissive: 'faction',
      structureEmissive: 'faction',
      emissiveBoost: 1,
      roughness: 1,
      metalness: 0,
    },
    markers: {
      accent: '#ffe08a',
      secondary: '#ffe08a',
      invalid: '#ff5a4f',
      link: '#7fd4ff',
    },
    scatter: { kind: 'none', density: 0 },
    background: {
      kind: 'none',
      top: '#000000',
      horizon: '#000000',
      bottom: '#000000',
      platform: '#000000',
      platformFadeStart: 0,
      platformFadeEnd: 1,
      platformGrid: '#000000',
      platformGridAlpha: 0,
      nebula: '#000000',
      nebula2: '#000000',
    },
  },
  endfield: {
    id: 'endfield',
    accent: '#FFE600',
    exposure: 1.0,
    fogColor: '#0a0e10',
    fogSoft: true,
    fogStyle: 'hatch',
    lighting: {
      hemiSky: '#7d878d',
      hemiGround: '#24282a',
      hemiIntensity: 0.5,
      sunColor: '#fff0d8',
      sunIntensity: 1.7,
      sunDir: [-0.62, 0.55, -0.62],
      rimColor: '#8fa6b4',
      rimIntensity: 0.3,
      rimDir: [0.5, 0.35, 0.6],
      shadow: true,
    },
    terrain: {
      rampLow: '#43493e',
      rampHigh: '#767c6a',
      rampStrength: 0.62,
      cliffColor: '#5c615f',
      cliffStart: 0.55,
      cliffEnd: 0.8,
      gridStrength: 0.08,
      noiseAmp: 0.07,
      noiseStyle: 'cell',
      slopeDarken: 0.3,
      edgeOcc: 0.4,
      edgeFadeDist: 16,
    },
    post: {
      enabled: true,
      aoIntensity: 1.6,
      aoRadius: 0.8,
      bloomIntensity: 0.5,
      bloomThreshold: 0.8,
      vignette: 0.28,
      noiseOpacity: 0.045,
      contrast: 1.08,
      saturation: 0.92,
    },
    materials: {
      unitBody: '#c8cbc6',
      structureBody: '#b4b8b0',
      structureTrim: '#2a2d2b',
      unitEmissive: 'faction',
      structureEmissive: 'faction',
      emissiveBoost: 1.5,
      roughness: 0.72,
      metalness: 0.08,
    },
    markers: {
      accent: '#FFE600',
      secondary: '#FFE600',
      invalid: '#ff5a4f',
      link: '#FFE600',
    },
    scatter: { kind: 'clutter', density: 0.07 },
    background: {
      kind: 'sky',
      top: '#2b3034',
      horizon: '#566063',
      bottom: '#0f1417',
      platform: '#171b1d',
      platformFadeStart: 0.5,
      platformFadeEnd: 1.05,
      platformGrid: '#000000',
      platformGridAlpha: 0,
      nebula: '#000000',
      nebula2: '#000000',
    },
  },
  shapez: {
    id: 'shapez',
    accent: '#3FD8FF',
    exposure: 1.05,
    fogColor: '#171240',
    fogSoft: true,
    fogStyle: 'grid',
    lighting: {
      hemiSky: '#7a6fd0',
      hemiGround: '#2a2350',
      hemiIntensity: 0.5,
      sunColor: '#fff1dc',
      sunIntensity: 1.8,
      sunDir: [0.62, 0.55, 0.38],
      rimColor: '#8a6fff',
      rimIntensity: 0.45,
      rimDir: [-0.5, 0.4, -0.5],
      shadow: true,
    },
    terrain: {
      rampLow: '#a7a9ba',
      rampHigh: '#e4e6f0',
      rampStrength: 0.8,
      cliffColor: '#443e5e',
      cliffStart: 0.5,
      cliffEnd: 0.75,
      gridStrength: 0.3,
      noiseAmp: 0.035,
      noiseStyle: 'cell',
      slopeDarken: 0.18,
      edgeOcc: 0.25,
      edgeFadeDist: 10,
    },
    post: {
      enabled: true,
      aoIntensity: 2.0,
      aoRadius: 1.0,
      bloomIntensity: 0.9,
      bloomThreshold: 0.68,
      vignette: 0.3,
      noiseOpacity: 0,
      contrast: 1.1,
      saturation: 1.05,
    },
    materials: {
      unitBody: '#f4f5fa',
      structureBody: '#dcdfe8',
      structureTrim: '#3a3d4d',
      unitEmissive: '#3FD8FF',
      structureEmissive: '#3FD8FF',
      emissiveBoost: 1.6,
      roughness: 0.38,
      metalness: 0.12,
    },
    markers: {
      accent: '#3FD8FF',
      secondary: '#FF8A1F',
      invalid: '#ff5a4f',
      link: '#3FD8FF',
    },
    scatter: { kind: 'studs', density: 0.05 },
    background: {
      kind: 'nebula',
      top: '#0c0620',
      horizon: '#160f38',
      bottom: '#3a2a7a',
      platform: '#141030',
      platformFadeStart: 0.55,
      platformFadeEnd: 1.15,
      platformGrid: '#4a3d8f',
      platformGridAlpha: 0.08,
      nebula: '#7a55d8',
      nebula2: '#2f8f9f',
    },
  },
  mindustry: {
    id: 'mindustry',
    accent: '#FFD37F',
    exposure: 1.1,
    fogColor: '#171110',
    fogSoft: true,
    fogStyle: 'plain',
    lighting: {
      hemiSky: '#e8d0a0',
      hemiGround: '#3a2818',
      hemiIntensity: 0.65,
      sunColor: '#ffe4b8',
      sunIntensity: 2.1,
      sunDir: [-0.5, 0.5, -0.3],
      rimColor: '#ffb070',
      rimIntensity: 0.2,
      rimDir: [0.5, 0.3, 0.55],
      shadow: true,
    },
    terrain: {
      rampLow: '#5e4028',
      rampHigh: '#c4a068',
      rampStrength: 0.85,
      cliffColor: '#43301f',
      cliffStart: 0.55,
      cliffEnd: 0.8,
      gridStrength: 0.2,
      noiseAmp: 0.28,
      noiseStyle: 'pixel',
      slopeDarken: 0.35,
      edgeOcc: 0.55,
      edgeFadeDist: 12,
    },
    post: {
      enabled: true,
      aoIntensity: 1.3,
      aoRadius: 0.9,
      bloomIntensity: 1.05,
      bloomThreshold: 0.78,
      vignette: 0.35,
      noiseOpacity: 0,
      contrast: 1.12,
      saturation: 1.06,
    },
    materials: {
      unitBody: '#43464c',
      structureBody: '#4a4d52',
      structureTrim: '#232120',
      unitEmissive: '#ffb060',
      structureEmissive: '#ffb060',
      emissiveBoost: 1.5,
      roughness: 0.85,
      metalness: 0.15,
    },
    markers: {
      accent: '#FFD37F',
      secondary: '#FFD37F',
      invalid: '#ff5a4f',
      link: '#FFD37F',
    },
    scatter: { kind: 'boulders', density: 0.06 },
    background: {
      kind: 'rock',
      top: '#1a1412',
      horizon: '#1a1412',
      bottom: '#0e0a08',
      platform: '#1a1412',
      platformFadeStart: 0.55,
      platformFadeEnd: 1.1,
      platformGrid: '#000000',
      platformGridAlpha: 0,
      nebula: '#000000',
      nebula2: '#000000',
    },
  },
};
