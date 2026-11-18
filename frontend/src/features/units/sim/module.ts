// Units sim: start-state spawning (deterministic square spiral over passable
// cells) and the dense per-tick unit snapshot channel. Component ownership
// per ADR 0019/0020; fog arrives in M5, so all units are visible for now.
import type { EntityHandle, EntityId, FactionId } from '../../../core/index';
import type { ContentDb, ResolvedUnit } from '../../../content/index';
import { Faction, InWorld } from '../../../kernel/index';
import type { SimModule, SpawnInit, SystemContext, VisibilityQuery } from '../../../kernel/index';
import { MoveTarget, moverComponents, Position } from '../../movement/sim/index';
import { spiralOffsets } from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { DenseUnitsChannel, SpawnIntent, UnitsSpawned } from '../protocol';
import type { DenseUnits } from '../protocol';
import { UnitKind } from './components';

export interface StartUnit {
  // UnitKind content index.
  kind: number;
  x: number;
  y: number;
  count: number;
}

export interface StartStructure {
  // Structure content index; spawned complete at top-left x,y.
  kind: number;
  x: number;
  y: number;
}

export interface FactionStart {
  faction: FactionId;
  units?: readonly StartUnit[];
  // cargo index -> units; consumed by logistics' warehouse stock on start.
  stock?: ReadonlyMap<number, number>;
  // Consumed by construction: complete structures spawned on start.
  structures?: readonly StartStructure[];
}

// Injected snapshot readouts: hp bp (default full), energy bp
// (default 0xFFFF = no energy slot) and the observer visibility filter
// (vision wires it; default all-visible).
export interface UnitReadouts {
  hpBp?(ctx: SystemContext, id: number): number;
  energyBp?(ctx: SystemContext, id: number): number;
  visible?: VisibilityQuery;
}

export function createUnitsModule(
  db: ContentDb,
  terrain: TerrainApi,
  starts: readonly FactionStart[],
  // Extra spawn parts injected per unit kind (e.g. logistics' CargoStore
  // battery). Composed after the mover components.
  unitParts: readonly ((unit: ResolvedUnit) => SpawnInit)[] = [],
  // Channel readouts injected by the app (combat's healthFraction and
  // logistics' energy fill) so units stays feature-agnostic.
  readouts: UnitReadouts = {},
): SimModule {
  return {
    id: 'frontline_td:units',
    install(builder) {
      builder.onStart((ctx) => {
        const occupied = new Set<number>();
        for (const start of starts) {
          for (const group of start.units ?? []) {
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
                ...unitParts.flatMap((part) => part(unit)),
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

      // Resolve spawn intents in the last phase so intents emitted in
      // any phase land the same tick (entities exist from the next
      // tick). `spawned` is emitted as soon as the handle is known.
      builder.system({
        id: 'frontline_td:units.spawn',
        phase: 'capture_fog',
        reads: [SpawnIntent],
        emits: [UnitsSpawned],
        run(ctx) {
          const pos = ctx.read(Position);
          // Cells holding a live entity centre count as occupied (the
          // blocked overlay already covers structures).
          const occupied = new Set<number>();
          for (const id of ctx.query([Position, InWorld])) {
            occupied.add(Math.floor(pos.y[id] ?? 0) * terrain.width + Math.floor(pos.x[id] ?? 0));
          }
          for (const p of ctx.read(SpawnIntent)) {
            const kind = db.units.byId(p.kind);
            if (kind === undefined) {
              continue;
            }
            const cx = Math.floor(p.x);
            const cy = Math.floor(p.y);
            let handle: EntityHandle | null = null;
            for (const [dx, dy] of spiralOffsets(cx, cy, terrain.width, terrain.height)) {
              const x = cx + dx;
              const y = cy + dy;
              const key = y * terrain.width + x;
              if (occupied.has(key) || !terrain.passable(x, y, kind.movementClass)) {
                continue;
              }
              occupied.add(key);
              handle = ctx.spawn([
                [Faction, { id: p.faction }],
                [InWorld],
                [UnitKind, { kind: kind.index }],
                ...moverComponents(
                  x + 0.5,
                  y + 0.5,
                  kind.cellsPerTick,
                  kind.radius,
                  kind.movementClass,
                ),
                ...unitParts.flatMap((part) => part(kind)),
              ]);
              break;
            }
            if (handle !== null) {
              ctx.emit(UnitsSpawned, {
                handle: Number(handle),
                faction: p.faction,
                kind: p.kind,
                source: p.source,
              });
            }
          }
        },
      });

      builder.snapshotChannel(DenseUnitsChannel, (ctx: SystemContext, observer) => {
        const pos = ctx.read(Position);
        const faction = ctx.read(Faction);
        const ids = ctx
          .query([UnitKind, Position])
          .filter(
            (id) =>
              (faction.id[id] ?? -1) === observer ||
              (readouts.visible?.(ctx, observer, pos.x[id] ?? 0, pos.y[id] ?? 0) ?? true),
          );
        const kind = ctx.read(UnitKind);
        const target = ctx.read(MoveTarget);
        const n = ids.length;
        const out: DenseUnits = {
          handles: new Float64Array(n),
          x: new Float32Array(n),
          y: new Float32Array(n),
          kind: new Uint16Array(n),
          faction: new Uint16Array(n),
          moving: new Uint8Array(n),
          hpBp: new Uint16Array(n),
          energyBp: new Uint16Array(n),
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
          out.hpBp[i] = readouts.hpBp?.(ctx, id) ?? 10000;
          out.energyBp[i] = readouts.energyBp?.(ctx, id) ?? 0xffff;
        }
        return out;
      });
    },
  };
}
