// Base-pack surfaces. A class missing from `costs` is impassable.
import { contentId } from '../../core/index';
import type { SurfaceContent } from '../../features/terrain/content';

export const surfaces: readonly SurfaceContent[] = [
  {
    id: contentId('frontline_td:ground'),
    costs: { 'frontline_td:ground': 10 },
    speedBp: 10000,
    color: '#5a8f3c',
  },
  {
    id: contentId('frontline_td:forest'),
    costs: { 'frontline_td:ground': 20 },
    speedBp: 6000,
    color: '#2d5a27',
  },
  {
    id: contentId('frontline_td:shallow_water'),
    costs: { 'frontline_td:ground': 30 },
    speedBp: 5000,
    color: '#3f7fbf',
  },
  { id: contentId('frontline_td:deep_water'), costs: {}, speedBp: 5000, color: '#1f3f7f' },
  { id: contentId('frontline_td:rock'), costs: {}, speedBp: 10000, color: '#7a7a7a' },
];
