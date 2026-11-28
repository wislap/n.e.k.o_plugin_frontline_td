// Centralized 2D minimap colour palette shared by paint-minimap and all
// feature minimap contributors (converges semantic reds/ambers via client/palette).
import {
  CANONICAL_DANGER_RED,
  CANONICAL_MOVE_MARKER,
  CANONICAL_OK_GREEN,
  CANONICAL_WARN_AMBER,
} from '../../client/palette';

export const MINIMAP_PALETTE = {
  own: '#5cc8ff',
  ownCore: '#9be2ff',
  ownCoreStroke: '#eef8ff',
  ownUnit: '#6ee7ff', // brighter cyan so 2.5px units pop over own structures
  selectedCore: '#ffffff',
  hostile: CANONICAL_DANGER_RED,
  ally: CANONICAL_OK_GREEN,
  ruin: '#c8a24a',
  warn: CANONICAL_WARN_AMBER,
  movePing: CANONICAL_MOVE_MARKER,
  memoryOwn: '#4d7ea8',
  memoryHostile: '#8a5058', // intentional dimmed fog-memory hue
  memoryAlly: '#468a73',
  memoryNeutral: '#5b7390',
  fogRgb: [6, 10, 18] as const, // matches tokens.css --surface-minimap #060a12
  roadRgb: [150, 166, 188] as const,
  defaultSurfaceRgb: [64, 72, 84] as const,
  gridStroke: 'rgba(140, 185, 235, 0.08)',
  frustumFill: 'rgba(232, 244, 255, 0.045)',
  frustumOutline: 'rgba(5, 8, 15, 0.82)',
  frustumStroke: '#e8f4ff',
} as const;
