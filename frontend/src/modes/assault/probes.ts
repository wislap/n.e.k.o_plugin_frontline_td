// Assault probes for the end screen and bots (M4): stock per cargo per
// faction, units/structures alive per faction, squad launches per
// faction, and the lowest core hp bp per faction. All probes read
// serialized sim state or component queries — controllers never write.
import type { EntityId, FactionId } from '../../core/index';
import type { ContentDb } from '../../content/index';
import { healthFraction } from '../../features/combat/sim/index';
import { Core, Structure } from '../../features/construction/sim/index';
import type { LogisticsModule } from '../../features/logistics/sim/index';
import { SquadsLaunched } from '../../features/squads/protocol';
import { UnitKind } from '../../features/units/sim/index';
import { Faction, InWorld } from '../../kernel/index';
import type { SimModule } from '../../kernel/index';

export function createAssaultProbesModule(
  db: ContentDb,
  logistics: LogisticsModule,
  factions: readonly FactionId[],
): SimModule {
  // Waves launched per faction, counted from SquadsLaunched so the
  // probe reflects serialized sim state (controllers are not in world).
  const waves = new Map<number, number>();
  for (const f of factions) {
    waves.set(f, 0);
  }
  return {
    id: 'frontline_td:assault.probes',
    install(builder) {
      builder.state('frontline_td:assault.probes', {
        save: () => Object.fromEntries([...waves.entries()].sort((a, b) => a[0] - b[0])),
        load(data) {
          const raw = data as Record<string, number>;
          for (const [k, v] of Object.entries(raw)) {
            waves.set(Number(k), v);
          }
        },
      });

      builder.system({
        id: 'frontline_td:assault.probes.waves',
        phase: 'cleanup',
        reads: [SquadsLaunched],
        run(ctx) {
          for (const e of ctx.read(SquadsLaunched)) {
            waves.set(e.faction, (waves.get(e.faction) ?? 0) + 1);
          }
        },
      });

      for (const f of factions) {
        for (const cargo of db.cargos.list) {
          builder.probe(`frontline_td:assault.stock.f${f}.${cargo.id.split(':')[1]}`, () => {
            const stock = logistics.stockOf(f);
            return Math.floor((stock[cargo.index] ?? 0) / 1000);
          });
        }
        builder.probe(`frontline_td:assault.units.f${f}`, (ctx) => {
          let n = 0;
          for (const id of ctx.query([UnitKind, Faction, InWorld])) {
            if ((ctx.read(Faction).id[id as EntityId] ?? 0) === f) {
              n += 1;
            }
          }
          return n;
        });
        builder.probe(`frontline_td:assault.structures.f${f}`, (ctx) => {
          let n = 0;
          for (const id of ctx.query([Structure, Faction, InWorld])) {
            if ((ctx.read(Faction).id[id as EntityId] ?? 0) === f) {
              n += 1;
            }
          }
          return n;
        });
        builder.probe(`frontline_td:assault.waves.f${f}`, () => waves.get(f) ?? 0);
        // Lowest core health bp (10000 = intact, −1 = no core).
        builder.probe(`frontline_td:assault.hivehp.f${f}`, (ctx) => {
          let best = -1;
          for (const id of ctx.query([Structure, Core, Faction, InWorld])) {
            if ((ctx.read(Faction).id[id as EntityId] ?? 0) !== f) {
              continue;
            }
            const bp = healthFraction(ctx, id);
            if (best < 0 || bp < best) {
              best = bp;
            }
          }
          return best;
        });
      }
    },
  };
}
