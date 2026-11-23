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
  // Diorama: the map sits on a floating island block with visible
  // soil/rock strata sides over a void, instead of a terrain skirt.
  island?:
    | {
        depth: number;
        strata: readonly string[];
        shadowGap: number;
      }
    | undefined;
  // Tactical-info slate tint multiplier (grey luminance × tint);
  // undefined = the field slate (0.2, 0.26, 0.22).
  info2dTint?: readonly [number, number, number] | undefined;
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
  // Tilt-shift DOF (diorama tabletop look); undefined = off.
  dof?: { offset: number; focusArea: number; feather: number } | undefined;
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
  // Scene-fog near/far in map-diagonal units (default 0.45 / 1.3); tighter
  // ranges give dense cinematic mist.
  fogNear?: number | undefined;
  fogFar?: number | undefined;
  // Cel: paint stylized cloud bands into the sky dome gradient.
  clouds?: boolean | undefined;
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
  // Scales scene.environmentIntensity for pmrem-sky themes; defaults to 1.
  // Pale skies otherwise flood materials with near-white ambient light.
  envIntensity?: number | undefined;
  // Ink color for the inverted-hull outline pass (debug toggle).
  outline: string;
  fogColor: string;
  fogSoft: boolean;
  fogStyle: FogStyle;
  // Cel-only: unexplored keeps a pale translucent wash so dimmed terrain
  // reads as a cool desaturated tint instead of dark mud.
  fogWash?: boolean | undefined;
  // Tactical 2D info treatment availability (弱化显示); the debug toggle
  // gates it further, legacy keeps it off.
  info2d: boolean;
  // Cel shading: lit color is quantized into hard luminance bands on the
  // terrain / structure / unit / scatter materials.
  toon?: boolean | undefined;
  // Geometry outlines always on regardless of the debug toggle (cel).
  outlineAlways?: boolean | undefined;
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
