// Squads module: serializable squad state, formation/order commands,
// the staggered orders-phase AI and the per-observer snapshot channel.
// Members are bound through the squads-owned SquadMember component.
import type { EntityHandle, EntityId, FactionId } from '../../../core/index';
import type { SimModule } from '../../../kernel/index';
import { Position } from '../../movement/sim/index';
import type { SquadsSnapshot, SquadView } from '../protocol';
import { SquadsChannel } from '../protocol';
import { installSquadCommands } from './commands';
import { SquadMember } from './components';
import { createSquadsEnv, loadSquads, saveSquads } from './state';
import type { SquadsDeps } from './deps';
import { installSquadsUpdate } from './update';
import { meanEnergyBp } from './energy';

export function createSquadsModule(deps: SquadsDeps): SimModule {
  const env = createSquadsEnv();
  return {
    id: 'frontline_td:squads',
    install(builder) {
      const memberW = builder.claimWriter(SquadMember);
      installSquadCommands(builder, env, memberW, deps);
      installSquadsUpdate(builder, env, memberW, deps);

      builder.state('frontline_td:squads', {
        save: () => saveSquads(env),
        load: (data) => {
          loadSquads(env, data);
        },
      });

      builder.snapshotChannel(SquadsChannel, (ctx, observer: FactionId) => {
        const pos = ctx.read(Position);
        const squads: SquadView[] = [];
        for (const squad of env.squads.values()) {
          const ids = squad.members
            .map((h) => ctx.resolve(h as EntityHandle))
            .filter((id): id is EntityId => id !== null);
          let cx = 0;
          let cy = 0;
          for (const id of ids) {
            cx += pos.x[id] ?? 0;
            cy += pos.y[id] ?? 0;
          }
          const n = Math.max(1, ids.length);
          if (squad.faction !== observer && deps.visible !== undefined) {
            // Hostile squads: visible centroid, or threat intel by
            // design — a gather (with countdown) or a routed advance.
            const broadcast =
              squad.order.kind === 'gather' ||
              (squad.order.kind === 'advance' && squad.route !== undefined);
            if (!broadcast && !deps.visible(ctx, observer, cx / n, cy / n)) {
              continue;
            }
          }
          const view: SquadView = {
            id: squad.id,
            faction: squad.faction,
            ...(squad.tag !== undefined ? { tag: squad.tag } : {}),
            strength: squad.strength,
            order: { ...squad.order },
            phase: squad.phase,
            memberCount: ids.length,
            centroid: { x: cx / n, y: cy / n },
            ...(squad.route !== undefined ? { route: [...squad.route] } : {}),
          };
          if (squad.faction === observer) {
            view.members = [...squad.members];
            const bp = meanEnergyBp(ctx, ids, deps.energyCargo);
            if (bp !== null) {
              view.meanEnergyBp = bp;
            }
          }
          squads.push(view);
        }
        return { squads } satisfies SquadsSnapshot;
      });
    },
  };
}
