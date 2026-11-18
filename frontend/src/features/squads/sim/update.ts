// Squad AI: one orders-phase system, staggered per squad
// ((tick + id) % PERIOD === 0). Squads never write MoveTarget — they
// emit movement intents only. Per tick it also handles member removal
// on player move overrides and reinforcements on units.spawned.
import type { EntityHandle } from '../../../core/index';
import type { ComponentWriter, SimBuilder } from '../../../kernel/index';
import { MoveIntent, MoveOrdered, StopIntent } from '../../movement/protocol';
import { UnitsSpawned } from '../../units/protocol';
import { SquadsLaunched } from '../protocol';
import { SquadMember } from './components';
import type { SquadsDeps } from './deps';
import { updateSquad } from './orders';
import type { Squad, SquadsEnv } from './state';

const SQUAD_PERIOD = 10;

type MemberFields = { squad: 'u16' };

export function installSquadsUpdate(
  builder: SimBuilder,
  env: SquadsEnv,
  memberW: ComponentWriter<MemberFields>,
  deps: SquadsDeps,
): void {
  builder.system({
    id: 'frontline_td:squads.update',
    phase: 'orders',
    reads: [MoveOrdered, UnitsSpawned],
    emits: [MoveIntent, StopIntent, SquadsLaunched],
    run(ctx) {
      const member = ctx.read(SquadMember);

      // Player override: a plain move command drops the member from its
      // squad. Runs every tick, independent of the squad's stagger slot.
      for (const h of ctx.read(MoveOrdered).flatMap((p) => p.units)) {
        const id = ctx.resolve(h as EntityHandle);
        if (id === null) {
          continue;
        }
        const sid = member.squad[id] ?? 0;
        const squad = env.squads.get(sid);
        if (squad !== undefined) {
          squad.members = squad.members.filter((m) => m !== h);
        }
        ctx.write(memberW).squad[id] = 0;
      }

      // Reinforcement: fresh units fill the issuer faction's squad with
      // the largest deficit (ties by lowest squad id).
      for (const p of ctx.read(UnitsSpawned)) {
        let best: Squad | null = null;
        let bestDeficit = 0;
        for (const squad of env.squads.values()) {
          if (squad.faction !== p.faction) {
            continue;
          }
          const deficit = squad.strength - squad.members.length;
          if (
            deficit > bestDeficit ||
            (deficit === bestDeficit && best !== null && squad.id < best.id)
          ) {
            best = squad;
            bestDeficit = deficit;
          }
        }
        const id = ctx.resolve(p.handle as EntityHandle);
        if (best === null || id === null) {
          continue;
        }
        best.members.push(p.handle);
        best.members.sort((a, b) => a - b);
        ctx.addComponent(memberW, p.handle as EntityHandle, { squad: best.id });
      }

      for (const squad of env.squads.values()) {
        if ((ctx.tick + squad.id) % SQUAD_PERIOD !== 0) {
          continue;
        }
        updateSquad(ctx, env, deps, squad);
      }
    },
  });
}
