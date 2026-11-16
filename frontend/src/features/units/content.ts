// Units feature content schema (ADR 0022). The sim module arrives with the
// movement batch; the content registry already exists so maps and movement
// classes can validate against it.
import { s } from '../../core/index';
import type { Infer } from '../../core/index';

export const unitSchema = s.object({
  id: s.contentId(),
  // Cells per second; converted to cells/tick by the loader (ADR 0020).
  speed: s.number({ min: 0.1, max: 20 }),
  radius: s.number({ min: 0.1, max: 2 }),
  movementClass: s.contentId(),
});
export type UnitContent = Infer<typeof unitSchema>;
