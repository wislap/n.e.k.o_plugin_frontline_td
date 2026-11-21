// Production module: one construction-phase system converts inputs into
// outputs inside the structure's own CargoStore via logistics intents.
// Recipes come from the structure kind's resolved producer profile.
import type { ContentDb } from '../../../content/index';
import type { EntityId } from '../../../core/index';
import type { SimModule } from '../../../kernel/index';
import { Faction, InWorld, OPERATIONAL_EXCLUDE } from '../../../kernel/index';
import { ConsumeIntent, DepositIntent, SLOT_EXPORT } from '../../logistics/protocol';
import { CARGO_SLOTS, CargoStore, sget } from '../../logistics/sim/index';
import type { CargoRead } from '../../logistics/sim/index';
import { Position } from '../../movement/sim/index';
import { SpawnIntent } from '../../units/protocol';
import {
  PRODUCTION_INSPECTOR_ID,
  type ProductionInspection,
  type ProductionStateName,
} from '../protocol';
import { Producer } from './components';

// Total amount of a cargo across the store's slots.
function storeAmount(store: CargoRead, id: number, cargo: number): number {
  let total = 0;
  for (let i = 0; i < CARGO_SLOTS; i++) {
    if (sget(store, 'cargo', i, id) === cargo) {
      total += sget(store, 'amt', i, id);
    }
  }
  return total;
}

// True when some export slot can take the full output amount.
function hasExportRoom(store: CargoRead, id: number, cargo: number, milli: number): boolean {
  for (let i = 0; i < CARGO_SLOTS; i++) {
    if (
      sget(store, 'cargo', i, id) === cargo &&
      (sget(store, 'flags', i, id) & SLOT_EXPORT) !== 0 &&
      sget(store, 'amt', i, id) + milli <= sget(store, 'cap', i, id)
    ) {
      return true;
    }
  }
  return false;
}

export function createProductionModule(db: ContentDb): SimModule {
  return {
    id: 'frontline_td:production',
    install(builder) {
      const producerW = builder.claimWriter(Producer);

      // Per tick: idle producers check inputs and output room, emit
      // ConsumeIntent and start; running producers count up and emit
      // DepositIntent when done.
      builder.system({
        id: 'frontline_td:production.craft',
        phase: 'construction',
        emits: [ConsumeIntent, DepositIntent, SpawnIntent],
        run(ctx) {
          const prod = ctx.write(producerW);
          const prodR = ctx.read(Producer);
          const store = ctx.read(CargoStore);
          const pos = ctx.read(Position);
          const fac = ctx.read(Faction);
          for (const id of ctx.query([Producer, InWorld, CargoStore], OPERATIONAL_EXCLUDE)) {
            const kind = db.structures.byIndex(prodR.kind[id] ?? 0);
            const recipe = kind?.producer;
            const handle = ctx.handleOf(id as EntityId);
            if (recipe === undefined || handle === null || kind === undefined) {
              continue;
            }
            // Cycle length: ramp step function on match tick (latest
            // entry with atTicks <= now wins), else recipe.timeTicks.
            let timeTicks = recipe.timeTicks;
            if (recipe.ramp !== undefined) {
              for (const step of recipe.ramp) {
                if (step.atTicks <= ctx.tick) {
                  timeTicks = step.timeTicks;
                }
              }
            }
            const progress = prodR.progress[id] ?? 0;
            if (progress === 0) {
              const ready =
                recipe.inputs.every(
                  (input) => storeAmount(store, id, input.cargo) >= input.milli,
                ) &&
                recipe.outputs.every((output) =>
                  hasExportRoom(store, id, output.cargo, output.milli),
                );
              if (!ready) {
                continue;
              }
              for (const input of recipe.inputs) {
                ctx.emit(ConsumeIntent, {
                  handle: Number(handle),
                  cargo: input.cargo,
                  amount: input.milli,
                });
              }
              prod.progress[id] = 1;
            } else {
              const next = progress + 1;
              if (next >= timeTicks) {
                for (const output of recipe.outputs) {
                  ctx.emit(DepositIntent, {
                    handle: Number(handle),
                    cargo: output.cargo,
                    amount: output.milli,
                  });
                }
                // Unit recipes emit a spawn intent per cycle; the exit
                // point is the structure's bottom-edge centre and the
                // units module spirals out from there.
                const unitOutput = recipe.unitOutput;
                if (unitOutput !== undefined && unitOutput.length > 0) {
                  const nextIdx = ((prodR.cycle[id] ?? 0) + 1) % unitOutput.length;
                  ctx.emit(SpawnIntent, {
                    faction: fac.id[id] ?? 0,
                    kind: unitOutput[prodR.cycle[id] ?? 0] as string,
                    x: pos.x[id] ?? 0,
                    y: (pos.y[id] ?? 0) + kind.footprint.h / 2 + 0.5,
                    source: Number(handle),
                  });
                  prod.cycle[id] = nextIdx;
                }
                prod.progress[id] = 0;
              } else {
                prod.progress[id] = next;
              }
            }
          }
        },
      });

      // Inspector: producing / waiting for inputs (which) / output full.
      builder.inspector(PRODUCTION_INSPECTOR_ID, (ctx, id) => {
        if (!ctx.has(Producer, id)) {
          return null;
        }
        const prodR = ctx.read(Producer);
        const store = ctx.read(CargoStore);
        const kind = db.structures.byIndex(prodR.kind[id] ?? 0);
        const recipe = kind?.producer;
        if (recipe === undefined) {
          return null;
        }
        const progress = prodR.progress[id] ?? 0;
        const unitOutput = recipe.unitOutput;
        let timeTicks = recipe.timeTicks;
        if (recipe.ramp !== undefined) {
          for (const step of recipe.ramp) {
            if (step.atTicks <= ctx.tick) {
              timeTicks = step.timeTicks;
            }
          }
        }
        const missing = recipe.inputs
          .filter((input) => storeAmount(store, id, input.cargo) < input.milli)
          .map((input) => input.cargo);
        const full = recipe.outputs
          .filter((output) => !hasExportRoom(store, id, output.cargo, output.milli))
          .map((output) => output.cargo);
        const state: ProductionStateName =
          progress > 0
            ? 'producing'
            : missing.length > 0
              ? 'waiting_inputs'
              : full.length > 0
                ? 'output_full'
                : 'ready';
        const nextUnit =
          unitOutput !== undefined && unitOutput.length > 0
            ? unitOutput[(prodR.cycle[id] ?? 0) % unitOutput.length]
            : undefined;
        const base = {
          state,
          progress,
          total: timeTicks,
          missing,
          full,
        };
        if (nextUnit !== undefined) {
          return { ...base, nextUnit } satisfies ProductionInspection;
        }
        return base satisfies ProductionInspection;
      });
    },
  };
}
