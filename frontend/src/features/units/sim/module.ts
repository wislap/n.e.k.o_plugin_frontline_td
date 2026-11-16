// Units sim: start-state spawning (deterministic square spiral over passable
// cells) and the dense per-tick unit snapshot channel. Component ownership
// per ADR 0019/0020; fog arrives in M5, so all units are visible for now.
import type { EntityId, FactionId } from '../../../core/index';
import type { ContentDb } from '../../../content/index';
import { Faction, InWorld } from '../../../kernel/index';
import type { SimModule, SystemContext } from '../../../kernel/index';
import { MoveTarget, moverComponents, Position } from '../../movement/sim/index';
import { spiralOffsets } from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { DenseUnitsChannel } from '../protocol';
import type { DenseUnits } from '../protocol';
import { UnitKind } from './components';

export interface StartUnit {
  // UnitKind content index.
  kind: number;
  x: number;
  y: number;
  count: number;
}

export interface FactionStart {
  faction: FactionId;
  units: readonly StartUnit[];
}

export function createUnitsModule(
  db: ContentDb,
  terrain: TerrainApi,
  starts: readonly FactionStart[],
): SimModule {
  return {
    id: 'frontline_td:units',
    install(builder) {
      builder.onStart((ctx) => {
        const occupied = new Set<number>();
        for (const start of starts) {
          for (const group of start.units) {
            const unit = db.units.byIndex(group.kind);
            if (unit === undefined) {
              throw new Error(`units: unknown kind index ${group.kind}`);
            }
            const cls = unit.movementClass;
            let placed = 0;
            for (const [dx, dy] of spiralOffsets(group.x, group.y, terrain.width, terrain.height)) {
              if (placed >= group.count) {
                break;
              }
              const x = group.x + dx;
              const y = group.y + dy;
              const key = y * terrain.width + x;
              if (occupied.has(key) || !terrain.passable(x, y, cls)) {
                continue;
              }
              occupied.add(key);
              ctx.spawn([
                [Faction, { id: start.faction }],
                [InWorld],
                [UnitKind, { kind: group.kind }],
                ...moverComponents(x + 0.5, y + 0.5, unit.cellsPerTick, unit.radius, cls),
              ]);
              placed += 1;
            }
            if (placed < group.count) {
              throw new Error(
                `units: could not place ${group.count - placed} of ${group.count} ` +
                  `units for faction ${start.faction} at ${group.x},${group.y}`,
              );
            }
          }
        }
      });

      builder.snapshotChannel(DenseUnitsChannel, (ctx: SystemContext) => {
        const ids = ctx.query([UnitKind, Position]);
        const pos = ctx.read(Position);
        const kind = ctx.read(UnitKind);
        const faction = ctx.read(Faction);
        const target = ctx.read(MoveTarget);
        const n = ids.length;
        const out: DenseUnits = {
          handles: new Float64Array(n),
          x: new Float32Array(n),
          y: new Float32Array(n),
          kind: new Uint16Array(n),
          faction: new Uint16Array(n),
          moving: new Uint8Array(n),
        };
        for (let i = 0; i < n; i++) {
          const id = ids[i] ?? 0;
          const handle = ctx.handleOf(id as EntityId);
          out.handles[i] = Number(handle ?? 0);
          out.x[i] = pos.x[id] ?? 0;
          out.y[i] = pos.y[id] ?? 0;
          out.kind[i] = kind.kind[id] ?? 0;
          out.faction[i] = faction.id[id] ?? 0;
          out.moving[i] = (target.active[id] ?? 0) === 1 ? 1 : 0;
        }
        return out;
      });
    },
  };
}
