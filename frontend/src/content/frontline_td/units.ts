// Base-pack units.
import { contentId } from '../../core/index';
import type { UnitContent } from '../../features/units/content';

export const units: readonly UnitContent[] = [
  {
    id: contentId('frontline_td:robot'),
    speed: 2.5,
    radius: 0.35,
    movementClass: contentId('frontline_td:ground'),
  },
];
