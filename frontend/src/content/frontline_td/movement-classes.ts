// Base-pack movement classes (ADR 0022). M2 ships exactly `ground`.
import { contentId } from '../../core/index';
import type { MovementClassContent } from '../../features/terrain/content';

export const movementClasses: readonly MovementClassContent[] = [
  { id: contentId('frontline_td:ground') },
];
