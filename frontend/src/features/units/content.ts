// Units feature content schema (ADR 0022). The sim module arrives with the
// movement batch; the content registry already exists so maps and movement
// classes can validate against it. `stores` reuses the logistics store
// profile (e.g. the robot's energy battery).
import { s } from '../../core/index';
import type { Infer } from '../../core/index';
import { weaponSchema } from '../combat/content';
import { storeProfileSchema } from '../logistics/content';

export const unitSchema = s.object({
  id: s.contentId(),
  // Cells per second; converted to cells/tick by the loader (ADR 0020).
  speed: s.number({ min: 0.1, max: 20 }),
  radius: s.number({ min: 0.1, max: 2 }),
  movementClass: s.contentId(),
  hp: s.int({ min: 1, max: 2_000_000_000 }),
  stores: s.optional(s.array(storeProfileSchema, { maxLength: 4 })),
  weapon: s.optional(weaponSchema),
  // Logistics interception strength in basis points applied to hostile
  // link quotas inside the corridor (E2).
  interceptor: s.optional(s.object({ strength: s.int({ min: 0, max: 10000 }) })),
});
export type UnitContent = Infer<typeof unitSchema>;
