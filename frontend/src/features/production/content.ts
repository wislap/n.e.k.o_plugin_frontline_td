// Production content schema: a recipe converts input cargos into output
// cargos over `time` seconds inside the structure's own CargoStore, or —
// as an alternative — spawns units from `unitOutput` (cycled in order,
// the cycle index is producer state). Amounts are in units (converted
// to milli by the loader). `ramp` overrides the cycle time by match
// time: latest entry with atSeconds ≤ now applies.
import { s } from '../../core/index';

export const producerSchema = s.object({
  inputs: s.record(s.number({ min: 0, max: 2_000_000 }), { maxLength: 4 }),
  outputs: s.optional(s.record(s.number({ min: 0, max: 2_000_000 }), { maxLength: 4 })),
  // Units produced per cycle, cycled in order; alternative to outputs.
  unitOutput: s.optional(s.array(s.contentId(), { maxLength: 16 })),
  time: s.number({ min: 0.05, max: 3600 }),
  // Optional time-by-match-time ramp: [[atSeconds, seconds], ...] sorted;
  // the latest entry with atSeconds ≤ elapsed seconds applies.
  ramp: s.optional(
    s.array(s.object({ atSeconds: s.int({ min: 0 }), seconds: s.number({ min: 0.05 }) }), {
      maxLength: 16,
    }),
  ),
});
