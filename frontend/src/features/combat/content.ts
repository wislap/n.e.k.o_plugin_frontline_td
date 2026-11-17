// Combat content schema (ADR 0011): only 'instant' delivery exists in M3.
// range in cells, damage in units (converted to milli by the loader),
// cooldown in seconds (converted to ticks), cost amount in units.
import { s } from '../../core/index';

export const weaponSchema = s.object({
  range: s.number({ min: 0.5, max: 64 }),
  damage: s.int({ min: 1, max: 2_000_000 }),
  cooldown: s.number({ min: 0.05, max: 60 }),
  delivery: s.literal('instant'),
  cost: s.optional(
    s.object({
      cargo: s.contentId(),
      amount: s.number({ min: 0, max: 2_000_000 }),
    }),
  ),
});
