// Base-pack cargos (ADR 0025).
import { contentId } from '../../core/index';
import type { CargoContent } from '../../features/logistics/content';

export const cargos: readonly CargoContent[] = [
  { id: contentId('frontline_td:ore') },
  { id: contentId('frontline_td:material') },
  { id: contentId('frontline_td:energy') },
  { id: contentId('frontline_td:ammo') },
];
