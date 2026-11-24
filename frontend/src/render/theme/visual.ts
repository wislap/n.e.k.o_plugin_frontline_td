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
  roughness: number;
  metalness: number;
  envMapIntensity: number;
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
  // Horizon haze: scene-fog near/far in map-diagonal units.
  hazeNear: number;
  hazeFar: number;
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

// The approved field look (b8bd104) exactly: 'dim' fog film, strong
// distance haze, sunlit meadow, no grading.
export const VISUAL: RenderVisual = {
  accent: '#FFE600',
  exposure: 0.9,
  toneMapping: 'agx',
  fogColor: '#3d453a',
  fogSoft: true,
  // Distance haze starts inside the playfield at overview distance —
  // the far fog merges into the horizon (b8bd104 near/far).
  hazeNear: 0.45,
  hazeFar: 1.3,
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
    roughness: 0.55,
    metalness: 0.25,
    envMapIntensity: 1,
    margin: 0.35,
    height: 0.12,
    emissiveBoost: 1.6,
  },
};

