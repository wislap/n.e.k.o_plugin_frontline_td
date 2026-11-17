// Dev-only raid controller (m3 batch C): every 45 s it orders the
// faction's idle units with energy >= 50% toward a target point via
// MoveCommand. Pure and deterministic — it needs no RNG stream. M4's
// director replaces it.
import { TICKS_PER_SECOND } from '../core/index';
import type { FactionId } from '../core/index';
import { MoveCommand } from '../features/movement/protocol';
import { DenseUnitsChannel } from '../features/units/protocol';
import type { DenseUnits } from '../features/units/protocol';
import type { Controller } from '../kernel/index';

const INTERVAL_TICKS = 45 * TICKS_PER_SECOND;
const MIN_ENERGY_BP = 5000;

export function createDevRaidController(
  faction: FactionId,
  target: { x: number; y: number },
): Controller {
  return {
    faction,
    decide(input) {
      if (input.tick % INTERVAL_TICKS !== 0) {
        return;
      }
      const dense = input.snapshot.channels[DenseUnitsChannel.id] as DenseUnits | undefined;
      if (dense === undefined) {
        return;
      }
      const units: number[] = [];
      for (let i = 0; i < dense.handles.length; i++) {
        if (
          dense.faction[i] === Number(faction) &&
          (dense.moving[i] ?? 0) === 0 &&
          (dense.energyBp[i] ?? 0) >= MIN_ENERGY_BP
        ) {
          units.push(dense.handles[i] ?? 0);
        }
      }
      if (units.length === 0) {
        return;
      }
      input.issue(MoveCommand.type, { units, x: target.x, y: target.y });
    },
  };
}
