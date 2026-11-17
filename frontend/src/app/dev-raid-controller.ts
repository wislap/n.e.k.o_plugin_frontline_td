// Dev-only raid controller (m3 batch C): every 45 s it orders the
// faction's idle units with energy >= 50% toward a target point via
// MoveCommand. Raiders (E2) instead target the nearest hostile
// non-warehouse node seen in the structures channel (fallback: the usual
// target). Pure and deterministic — it needs no RNG stream. M4's
// director replaces it.
import { TICKS_PER_SECOND } from '../core/index';
import type { ContentDb } from '../content/index';
import type { FactionId } from '../core/index';
import { StructuresChannel } from '../features/construction/protocol';
import type { ConstructionStructures } from '../features/construction/protocol';
import { STATE_OPERATIONAL } from '../features/construction/protocol';
import { MoveCommand } from '../features/movement/protocol';
import { DenseUnitsChannel } from '../features/units/protocol';
import type { DenseUnits } from '../features/units/protocol';
import type { Controller } from '../kernel/index';

const INTERVAL_TICKS = 45 * TICKS_PER_SECOND;
const MIN_ENERGY_BP = 5000;

export function createDevRaidController(
  faction: FactionId,
  target: { x: number; y: number },
  db: ContentDb,
  hostile: ReadonlySet<number>,
): Controller {
  // Unit kinds that intercept logistics (the raider), and structure
  // kinds that are non-warehouse network nodes (raid targets).
  const raiderKinds = new Set(
    db.units.list.filter((u) => u.interceptor !== undefined).map((u) => u.index),
  );
  const nodeKinds = new Set(
    db.structures.list.filter((s) => s.node !== undefined && !s.node.warehouse).map((s) => s.index),
  );
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
      const raiders: { handle: number; x: number; y: number }[] = [];
      for (let i = 0; i < dense.handles.length; i++) {
        if (
          dense.faction[i] !== Number(faction) ||
          (dense.moving[i] ?? 0) !== 0 ||
          (dense.energyBp[i] ?? 0) < MIN_ENERGY_BP
        ) {
          continue;
        }
        if (raiderKinds.has(dense.kind[i] ?? -1)) {
          raiders.push({
            handle: dense.handles[i] ?? 0,
            x: dense.x[i] ?? 0,
            y: dense.y[i] ?? 0,
          });
        } else {
          units.push(dense.handles[i] ?? 0);
        }
      }
      // Hostile non-warehouse operational nodes visible to this faction.
      const structures = input.snapshot.channels[StructuresChannel.id] as
        ConstructionStructures | undefined;
      const nodes: { x: number; y: number }[] = [];
      if (structures !== undefined) {
        for (let i = 0; i < structures.handles.length; i++) {
          if (
            hostile.has(structures.faction[i] ?? -1) &&
            (structures.state[i] ?? -1) === STATE_OPERATIONAL &&
            nodeKinds.has(structures.kind[i] ?? -1)
          ) {
            nodes.push({
              x: (structures.x[i] ?? 0) + 0.5,
              y: (structures.y[i] ?? 0) + 0.5,
            });
          }
        }
      }
      for (const r of raiders) {
        let best: { x: number; y: number } | null = null;
        let bestD = Infinity;
        for (const n of nodes) {
          const dx = n.x - r.x;
          const dy = n.y - r.y;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
        input.issue(MoveCommand.type, {
          units: [r.handle],
          x: (best ?? target).x,
          y: (best ?? target).y,
        });
      }
      if (units.length > 0) {
        input.issue(MoveCommand.type, { units, x: target.x, y: target.y });
      }
    },
  };
}
