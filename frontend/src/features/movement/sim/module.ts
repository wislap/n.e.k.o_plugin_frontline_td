// Movement module assembly (design §7.3): steer along the pathing flow
// field, uniform-grid separation, then integrate with passability checks.
// The spatial hash is movement-internal until combat needs it (M3).
import type { EntityHandle, Serializable } from '../../../core/index';
import { CombatDied } from '../../combat/protocol';
import type { ComponentWriter, SimModule, SpawnInit } from '../../../kernel/index';
import type { PathingApi } from '../../pathing/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { FormationGuide, MoveTarget, Mover, Position, RouteFollow, Velocity } from './components';
import { clearFormationGuide, installMovementIntents, releaseHeldGoal } from './intents';
import { makeIntegrate } from './integrate';
import { createRouteChainStore, releaseRouteFollow, type RouteFollowView } from './route-chain';
import { makeSeparate } from './separate';
import { makeSteer } from './steer';

export { MoveSpeed } from './steer';

// Spawn tuples for a movable entity: callers add Faction/InWorld/UnitKind.
export function moverComponents(
  x: number,
  y: number,
  speed: number,
  radius: number,
  cls: number,
): SpawnInit {
  return [
    [Position, { x, y }],
    [Velocity, { x: 0, y: 0 }],
    [Mover, { speed, radius, cls }],
    [MoveTarget, { goal: 0, x: 0, y: 0, active: 0, stall: 0 }],
    [FormationGuide, { maxSpeed: 0, active: 0 }],
    [RouteFollow, { chain: 0, gate: 0, lane: 0, active: 0 }],
  ];
}

export function createMovementModule(terrain: TerrainApi, pathing: PathingApi): SimModule {
  let velW: ComponentWriter<{ x: 'f64'; y: 'f64' }>;
  let posW: ComponentWriter<{ x: 'f64'; y: 'f64' }>;
  let tgtW: ComponentWriter<{ goal: 'u32'; x: 'f64'; y: 'f64'; active: 'u8'; stall: 'u8' }>;
  let guideW: ComponentWriter<{ maxSpeed: 'f64'; active: 'u8' }>;
  let routeW: ComponentWriter<{ chain: 'u32'; gate: 'u16'; lane: 'f64'; active: 'u8' }>;
  const routes = createRouteChainStore();
  terrain.onBlockedChange(() => {
    routes.rejoinMemo.reset();
  });
  const separate = makeSeparate(terrain, () => velW);
  const steer = makeSteer(terrain, pathing, routes, separate, {
    vel: () => velW,
    tgt: () => tgtW,
    guide: () => guideW,
    route: () => routeW,
  });
  const integrate = makeIntegrate(terrain, { pos: () => posW, vel: () => velW });

  return {
    id: 'frontline_td:movement',
    install(builder) {
      velW = builder.claimWriter(Velocity);
      posW = builder.claimWriter(Position);
      tgtW = builder.claimWriter(MoveTarget);
      guideW = builder.claimWriter(FormationGuide);
      routeW = builder.claimWriter(RouteFollow);
      // Mover is read-only after spawn (stats come from content).
      builder.ownComponent(Mover);

      builder.state('frontline_td:movement.routes', {
        save: () => ({ routes: routes.save(), blocked: separate.saveBlocked() }),
        load: (data) => {
          const d = data as unknown as { routes?: Serializable; blocked?: number[] };
          routes.load(d.routes ?? data);
          separate.loadBlocked(d.blocked ?? []);
        },
      });

      installMovementIntents(builder, terrain, pathing, routes, tgtW, guideW, routeW);

      builder.system({ id: 'frontline_td:movement.steer', phase: 'movement', run: steer });
      builder.system({
        id: 'frontline_td:movement.separate',
        phase: 'movement',
        run: separate.run,
      });
      builder.system({ id: 'frontline_td:movement.integrate', phase: 'movement', run: integrate });

      // Dead movers release their shared goal in the same cleanup phase,
      // before combat's despawn runs — module order fixes the structural
      // queue (despawn order is observable through entity-id reuse).
      // Only active===1 still owns a goal: hold/stop already released.
      builder.system({
        id: 'frontline_td:movement.release_dead',
        phase: 'cleanup',
        reads: [CombatDied],
        run(ctx) {
          const target = ctx.read(MoveTarget);
          const out = ctx.write(tgtW);
          const guideOut = ctx.write(guideW);
          const routeOut = ctx.write(routeW) as RouteFollowView;
          for (const p of ctx.read(CombatDied)) {
            const id = ctx.resolve(p.handle as EntityHandle);
            if (id === null || !ctx.has(Mover, id)) {
              continue;
            }
            releaseHeldGoal(pathing, target, id);
            clearFormationGuide(guideOut, id);
            releaseRouteFollow(routes, routeOut, id);
            out.goal[id] = 0;
            out.active[id] = 0;
            out.stall[id] = 0;
          }
        },
      });
    },
  };
}
