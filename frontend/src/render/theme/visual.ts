// The game's single visual look (merged language): stylized PBR daylight —
// PMREM environment from the procedural sky, AgX tone mapping, soft shadows,
// lush grass + flowers, graphite foundation pads with emissive trim,
// procedural seams/stripes/printed codes, glowing road tracks, dark 'dim'
// fog film hazed toward the sky.
// Pure data consumed by the render layer (lighting, terrain shader,
// background, fog, post, materials, geometry). No registry, no ids.

type ToneMappingId = 'none' | 'aces' | 'agx';

interface VisualLighting {
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

interface VisualTerrain {
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
  // Fraction of gridStrength drawn in the 3D view; the info2d view always
  // draws the full grid (1 = grid everywhere, 0 = grid only in info2d).
  grid3d?: number | undefined;
  noiseAmp: number;
  slopeDarken: number;
  // Dirt/gravel macro patches blended over the ramp (undefined = off).
  dirt?: string | undefined;
  // Edge occlusion: fraction of darkening at the map border, fading inward
  // over edgeFadeDist cells.
  edgeOcc: number;
  edgeFadeDist: number;
  // Out-of-bounds terrain skirt: distance in cells the noise-hill skirt
  // extends past the map rect, fading into the horizon haze (0 = off).
  skirtCells: number;
}

interface VisualPost {
  aoIntensity: number;
  aoRadius: number;
  bloomIntensity: number;
  bloomThreshold: number;
  vignette: number;
  noiseOpacity: number;
  // Grade: contrast multiplier around mid-grey, saturation scale.
  contrast: number;
  saturation: number;
}

interface VisualMaterials {
  // Faction-accent scheme: neutral bodies, faction color reserved for
  // accents, plus emissive light details that feed bloom.
  unitBody: string;
  // Dark undercarriage / treads on robot silhouettes.
  unitTrim: string;
  structureBody: string;
  structureTrim: string;
  // 'faction' = per-instance faction color; otherwise a fixed hex.
  unitEmissive: 'faction' | (string & {});
  structureEmissive: 'faction' | (string & {});
  // Emissive intensity multiplier so the detail clears the bloom threshold.
  emissiveBoost: number;
  roughness: number;
  metalness: number;
  // Procedural surface detail (0 = off): panel seams, hazard stripes on
  // accent trim, printed-code decal on top faces.
  detail: number;
}

interface VisualMarkers {
  accent: string;
  secondary: string;
  invalid: string;
  link: string;
}

interface VisualBackground {
  // Dome gradient: zenith → horizon → below-horizon.
  top: string;
  horizon: string;
  bottom: string;
  // Far ground platform under/around the map, fading out radially.
  platform: string;
  platformFadeStart: number;
  platformFadeEnd: number;
  // Scene fog color for distance haze toward the horizon ('' = none).
  haze: string;
}

interface VisualGeometry {
  // Uniform chamfer/bevel radius applied to structure MeshBuilder boxes, in
  // unit-box space (0 = sharp edges).
  bevel: number;
}

// Foundation pad under each structure: a graphite slab slightly larger
// than the footprint with an emissive edge trim — what separates industry
// from nature.
interface VisualPad {
  color: string;
  edge: string;
  // Extra footprint margin on each side, in cells.
  margin: number;
  height: number;
  emissiveBoost: number;
}

export interface RenderVisual {
  accent: string;
  exposure: number;
  toneMapping: ToneMappingId;
  // Scales scene.environmentIntensity for the PMREM sky.
  envIntensity?: number | undefined;
  fogColor: string;
  fogSoft: boolean;
  // Horizon haze: scene-fog near/far in map-diagonal units and the warm/
  // cool split-tone strength (0 = off, 1 = full atmosphere).
  hazeNear: number;
  hazeFar: number;
  splitTone: number;
  // Tactical 2D info treatment (弱化显示); the debug toggle gates it further.
  info2d: boolean;
  lighting: VisualLighting;
  terrain: VisualTerrain;
  post: VisualPost;
  background: VisualBackground;
  materials: VisualMaterials;
  markers: VisualMarkers;
  scatter: { density: number };
  geometry: VisualGeometry;
  pad: VisualPad;
}

const VISUAL: RenderVisual = {
  accent: '#FFE600',
  exposure: 0.9,
  toneMapping: 'agx',
  fogColor: '#3d453a',
  fogSoft: true,
  // Fog sits past the map: at overview distance it only catches the
  // skirt rim and the horizon, never the playfield itself.
  hazeNear: 0.95,
  hazeFar: 2.2,
  splitTone: 0.5,
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
  },
  post: {
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
  scatter: { density: 0.55 },
  background: {
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

// --- Temporary debug axes (owner A/B; delete after palette selection) ---

export const PALETTE_IDS = ['field', 'warm', 'mid'] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

// `warm` borrows diorama's golden-hour palette: yellow-green grass, cream
// paint, warm earth, warm void — while keeping field's value range.
const WARM: RenderVisual = {
  ...VISUAL,
  fogColor: '#4a4438',
  lighting: {
    ...VISUAL.lighting,
    hemiSky: '#c8d8e8',
    hemiGround: '#7a6f4d',
    sunColor: '#ffe3b0',
    rimColor: '#e8d8b8',
  },
  terrain: {
    ...VISUAL.terrain,
    rampLow: '#7d9a5c',
    rampHigh: '#c4cc8a',
    cliffColor: '#b9a98c',
    dirt: '#ab9a78',
  },
  materials: {
    ...VISUAL.materials,
    unitBody: '#ddd6c4',
    structureBody: '#ded7c5',
    structureEmissive: '#f0a860',
  },
  background: {
    ...VISUAL.background,
    top: '#b8cfe8',
    horizon: '#f0e6cf',
    bottom: '#b0a888',
    platform: '#a8ab72',
    haze: '#ece0c8',
  },
  pad: { ...VISUAL.pad, color: '#33302a', edge: '#f0a860' },
};

function hexLerp(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

// Resolves the effective visual for the two temporary debug axes:
// palette picks the colour world (mid lerps field→warm 50/50) and
// atmosphere (0..1) scales sun warmth/elevation, cool sky fill, horizon
// haze and the split-tone grade — without veiling the scene.
export function resolveVisual(palette: PaletteId, atmosphere: number): RenderVisual {
  const a = Math.min(1, Math.max(0, atmosphere));
  let v = VISUAL;
  if (palette !== 'field') {
    const t = palette === 'warm' ? 1 : 0.5;
    const f = VISUAL;
    const w = WARM;
    const L = (x: string, y: string) => hexLerp(x, y, t);
    v = {
      ...f,
      fogColor: L(f.fogColor, w.fogColor),
      lighting: {
        ...f.lighting,
        hemiSky: L(f.lighting.hemiSky, w.lighting.hemiSky),
        hemiGround: L(f.lighting.hemiGround, w.lighting.hemiGround),
        sunColor: L(f.lighting.sunColor, w.lighting.sunColor),
        rimColor: L(f.lighting.rimColor, w.lighting.rimColor),
      },
      terrain: {
        ...f.terrain,
        rampLow: L(f.terrain.rampLow, w.terrain.rampLow),
        rampHigh: L(f.terrain.rampHigh, w.terrain.rampHigh),
        cliffColor: L(f.terrain.cliffColor, w.terrain.cliffColor),
        dirt: L(f.terrain.dirt ?? '#8d8368', w.terrain.dirt ?? '#8d8368'),
      },
      materials: {
        ...f.materials,
        unitBody: L(f.materials.unitBody, w.materials.unitBody),
        structureBody: L(f.materials.structureBody, w.materials.structureBody),
        structureEmissive: L(f.materials.structureEmissive, w.materials.structureEmissive),
      },
      background: {
        ...f.background,
        top: L(f.background.top, w.background.top),
        horizon: L(f.background.horizon, w.background.horizon),
        bottom: L(f.background.bottom, w.background.bottom),
        platform: L(f.background.platform, w.background.platform),
        haze: L(f.background.haze, w.background.haze),
      },
      pad: { ...f.pad, color: L(f.pad.color, w.pad.color), edge: L(f.pad.edge, w.pad.edge) },
    };
  }
  return {
    ...v,
    lighting: {
      ...v.lighting,
      // Warmer, lower sun (longer soft shadows) with a cooler sky fill.
      sunColor: hexLerp(v.lighting.sunColor, '#ffc078', a * 0.6),
      sunDir: [v.lighting.sunDir[0], 0.6 - a * 0.18, v.lighting.sunDir[2]],
      hemiSky: hexLerp(v.lighting.hemiSky, '#8fb8e8', a * 0.5),
    },
    // Haze lives only near the horizon: fog pulls in as atmosphere rises,
    // but even at a=1 its near plane stays beyond the map edge.
    hazeNear: v.hazeNear * (1 - a * 0.15),
    hazeFar: v.hazeFar * (1 - a * 0.3),
    splitTone: a,
  };
}
