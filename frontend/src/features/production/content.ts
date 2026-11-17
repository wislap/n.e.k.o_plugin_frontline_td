// Production content schema: a recipe converts input cargos into output
// cargos over `time` seconds inside the structure's own CargoStore.
// Amounts are in units (converted to milli by the loader).
import { s } from '../../core/index';

export const producerSchema = s.object({
  inputs: s.record(s.number({ min: 0, max: 2_000_000 }), { maxLength: 4 }),
  outputs: s.record(s.number({ min: 0, max: 2_000_000 }), { maxLength: 4 }),
  time: s.number({ min: 0.05, max: 3600 }),
});
