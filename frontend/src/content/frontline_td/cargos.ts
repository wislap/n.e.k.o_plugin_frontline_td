// Base-pack cargos (ADR 0025).
import { contentId } from '../../core/index';
import type { CargoContent } from '../../features/logistics/content';

export const cargos: readonly CargoContent[] = [
  { id: contentId('frontline_td:ore'), color: '#8a7a5a' },
  { id: contentId('frontline_td:material'), color: '#b0b6c0' },
  { id: contentId('frontline_td:energy'), color: '#ffd24f' },
  { id: contentId('frontline_td:ammo'), color: '#ff8a5a' },
];
