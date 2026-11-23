// Shared theme parameter types (visual-languages): pure data consumed by
// the render layer (lighting, terrain shader, background, fog, post,
// materials, geometry). 'legacy' reproduces the pre-slice look and is the
// control variant.
import type { ThemeId } from '../../../client/theme';

type ToneMappingId = 'none' | 'aces' | 'agx';
// 'none' = default hemisphere+sun; 'pmrem-sky' = build a PMREM environment
// from the theme's procedural sky so ambient/reflections come from it.
type EnvironmentKind = 'none' | 'pmrem-sky';
// Fog of war treatment: 'plain' = soft dark film, 'survey' = pale
// cartography paper with height contours + dot grid, 'dim' = the natural
// terrain reads through a translucent dark film, hazed toward the sky at
// distance (field).
type FogStyle = 'plain' | 'survey' | 'dim';
// Which prop sets to spawn: 'clutter' (rocks/debris/tufts), 'meadow'
// (grass blades/clumps + flower specks + rare stones, field).
type ScatterKind = 'none' | 'clutter' | 'meadow';

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
  // Solid slate pedestal walls under the map edge (default true); set
  // false when the out-of-bounds skirt should meet the map edge directly
  // with no slab side visible.
  pedestal?: boolean | undefined;
}

interface ThemePost {
  enabled: boolean;
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

interface ThemeMaterials {
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
  // accent trim, printed-code decal on top faces (field).
  detail: number;
}

interface ThemeMarkers {
  accent: string;
  secondary: string;
  invalid: string;
  link: string;
}

interface ThemeScatter {
  kind: ScatterKind;
  density: number;
}

interface ThemeBackground {
  kind: 'none' | 'sky';
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

// Geometry language: uniform chamfer/bevel radius applied to structure
// MeshBuilder boxes, in unit-box space (0 = sharp edges).
interface ThemeGeometry {
  bevel: number;
}

// Foundation pad under each structure (field): a graphite slab slightly
// larger than the footprint with an emissive edge trim — what separates
// industry from nature. Undefined = no pad layer.
interface ThemePad {
  color: string;
  edge: string;
  // Extra footprint margin on each side, in cells.
  margin: number;
  height: number;
  emissiveBoost: number;
}

export interface RenderTheme {
  id: ThemeId;
  accent: string;
  exposure: number;
  toneMapping: ToneMappingId;
  environment: EnvironmentKind;
  // Ink color for the inverted-hull outline pass (debug toggle).
  outline: string;
  fogColor: string;
  fogSoft: boolean;
  fogStyle: FogStyle;
  // Tactical 2D info treatment availability (弱化显示); the debug toggle
  // gates it further, legacy keeps it off.
  info2d: boolean;
  lighting: ThemeLighting;
  terrain: ThemeTerrain;
  post: ThemePost;
  background: ThemeBackground;
  materials: ThemeMaterials;
  markers: ThemeMarkers;
  scatter: ThemeScatter;
  geometry: ThemeGeometry;
  pad: ThemePad | null;
}
