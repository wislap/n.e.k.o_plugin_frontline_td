// Assault victory module (mode-owned, symmetric): every 20 ticks a
// non-neutral faction with zero operational Core structures is
// eliminated; when at most one remains the match ends — `assault.ended`
// records the winner (−1 = draw) and tick in serialized state and on
// the `assault.state` channel so the runtime can stop stepping. A
// match time limit ends in a draw. The rule never names factions.
import type { EntityId } from '../../core/index';
import { TICKS_PER_SECOND } from '../../core/index';
import { Core, Structure } from '../../features/construction/sim/index';
import { Faction, InWorld } from '../../kernel/index';
import type { SimModule } from '../../kernel/index';
import { AssaultChannel, AssaultEliminated, AssaultEnded } from './protocol';

const CHECK_PERIOD = 20;
const DEFAULT_LIMIT_TICKS = 40 * 60 * TICKS_PER_SECOND;

export interface VictoryOptions {
  // Match time limit in ticks (tests pass a short one).
  timeLimitTicks?: number;
}

interface VictoryEnv {
  eliminated: Set<number>;
  ended: { winner: number; tick: number } | null;
}

export function createVictoryModule(options: VictoryOptions = {}): SimModule {
  const limit = options.timeLimitTicks ?? DEFAULT_LIMIT_TICKS;
  const env: VictoryEnv = { eliminated: new Set(), ended: null };
  return {
    id: 'frontline_td:assault.victory',
    install(builder) {
      builder.state('frontline_td:assault.victory', {
        save: () => ({
          eliminated: [...env.eliminated].sort((a, b) => a - b),
          ended: env.ended,
        }),
        load(data) {
          const raw = data as {
            eliminated: number[];
            ended: { winner: number; tick: number } | null;
          };
          env.eliminated = new Set(raw.eliminated);
          env.ended = raw.ended;
        },
      });

      builder.snapshotChannel(AssaultChannel, () => ({
        ended: env.ended === null ? 0 : 1,
        winner: env.ended?.winner ?? -1,
        tick: env.ended?.tick ?? 0,
        eliminated: [...env.eliminated].sort((a, b) => a - b),
      }));

      builder.system({
        id: 'frontline_td:assault.victory.check',
        phase: 'capture_fog',
        everyTicks: CHECK_PERIOD,
        emits: [AssaultEliminated, AssaultEnded],
        run(ctx) {
          if (env.ended !== null) {
            return;
          }
          // Participants: factions that have at least one hostile
          // relation — a faction neutral to everyone is not in the war.
          const factions = ctx.factions();
          const participants = factions.filter((f) =>
            factions.some((o) => o !== f && ctx.isHostile(f, o)),
          );
          const core = new Map<number, number>();
          for (const id of ctx.query([Structure, Core, Faction, InWorld])) {
            const f = ctx.read(Faction).id[id as EntityId] ?? 0;
            core.set(f, (core.get(f) ?? 0) + 1);
          }
          for (const f of participants) {
            if (!env.eliminated.has(f) && (core.get(f) ?? 0) === 0) {
              env.eliminated.add(f);
              ctx.emit(AssaultEliminated, { faction: f });
            }
          }
          const alive = participants.filter((f) => !env.eliminated.has(f));
          if (alive.length <= 1) {
            const winner = alive[0] ?? -1;
            env.ended = { winner, tick: ctx.tick };
            ctx.emit(AssaultEnded, { winner, tick: ctx.tick });
            return;
          }
          if (ctx.tick >= limit) {
            env.ended = { winner: -1, tick: ctx.tick };
            ctx.emit(AssaultEnded, { winner: -1, tick: ctx.tick });
          }
        },
      });
    },
  };
}
