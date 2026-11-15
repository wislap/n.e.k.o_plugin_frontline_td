// Exercise module used only by tests (and later eval): it touches every
// kernel mechanism — spawn/despawn with recycled ids, RNG-driven movement,
// events, scheduled effects, a grid layer, module state, and a controller —
// so determinism coverage proves the whole pipeline, not a toy path.
import type { CommandEnvelope, EntityHandle, FactionId, Serializable } from '../../core/index';
import {
  defineCommand,
  defineEvent,
  defineSnapshotChannel,
  rngNextIntBelow,
  s,
  toTick,
} from '../../core/index';
import { defineComponent } from '../components';
import { Faction, InWorld } from '../contracts';
import { defineGridLayer } from '../layers';
import type { Controller, SimModule, SystemContext } from '../types';

export const EXERCISE_RNG = 'frontline_td:test.exercise';

const Position = defineComponent('frontline_td:test.position', {
  x: 'f64',
  y: 'f64',
});
// 'armor' is intentionally left out of spawn init: recycled ids must get a
// zeroed field, not whatever the previous occupant left behind.
const Health = defineComponent('frontline_td:test.health', { hp: 'i32', armor: 'i32' });
const Heat = defineGridLayer('frontline_td:test.heat', 'u8', {
  perFaction: false,
});

type SpawnedPayload = { id: number };
const Spawned = defineEvent<SpawnedPayload>('frontline_td:test.spawned', 'all');
const Despawned = defineEvent<SpawnedPayload>('frontline_td:test.despawned', 'all');
const AliveChannel = defineSnapshotChannel<{ count: number }>('frontline_td:test.alive');

export const SpawnCommand = defineCommand(
  'frontline_td:test.spawn',
  s.object({ count: s.int({ min: 1, max: 8 }) }),
);
export const DespawnCommand = defineCommand(
  'frontline_td:test.despawn',
  s.object({ handle: s.handle() }),
);
const ExplodeEffect = 'frontline_td:test.explode';

export interface ExerciseSink {
  spawnedIds: number[];
  despawnedIds: number[];
}

// The controller decides strictly from its snapshot and its own rng stream:
// it spawns every `period` ticks, and — when last tick reported any spawns —
// picks one of those handles at random and despawns it next tick.
export function createExerciseController(faction: FactionId, period = 7): Controller {
  return {
    faction,
    decide(input) {
      if (input.tick % period === 0) {
        input.issue(SpawnCommand.type, { count: 2 });
      }
      const spawned = input.snapshot.events
        .filter((event) => event.type === Spawned.type)
        .map((event) => (event.payload as SpawnedPayload).id);
      if (spawned.length > 0) {
        const pick = spawned[rngNextIntBelow(input.rng, spawned.length)];
        input.issue(DespawnCommand.type, { handle: pick });
      }
    },
  };
}

export function createExerciseModule(sink?: ExerciseSink): SimModule {
  const alive: EntityHandle[] = [];
  let spawnedCount = 0;

  function spawnUnits(ctx: SystemContext, count: number, owner: FactionId): void {
    const rng = ctx.rng(EXERCISE_RNG);
    for (let k = 0; k < count; k++) {
      const x = rngNextIntBelow(rng, 64);
      const y = rngNextIntBelow(rng, 64);
      const handle = ctx.spawn([
        [Faction, { id: owner }],
        [InWorld],
        [Position, { x, y }],
        [Health, { hp: 100 }],
      ]);
      alive.push(handle);
      spawnedCount += 1;
      sink?.spawnedIds.push(Number(handle));
      ctx.emit(Spawned, { id: Number(handle) });
      ctx.schedule(ExplodeEffect, 5, { amount: 10 }, [handle]);
    }
  }

  return {
    id: 'frontline_td:test.exercise',
    install(builder) {
      const pos = builder.claimWriter(Position);
      const hp = builder.claimWriter(Health);
      const heat = builder.claimLayerWriter(Heat);

      builder.command(
        SpawnCommand,
        (ctx, payload, issuer) => {
          spawnUnits(ctx, payload.count, issuer);
        },
        { emits: [Spawned] },
      );

      builder.command(DespawnCommand, (ctx, payload) => {
        const handle = payload.handle;
        if (!ctx.isValid(handle)) {
          ctx.reject('stale_handle');
          return;
        }
        ctx.despawn(handle);
      });

      builder.effect(ExplodeEffect, 'resolve', (ctx, params, handles) => {
        const amount = (params as { amount: number }).amount;
        const hpView = ctx.write(hp);
        for (const handle of handles) {
          const id = ctx.resolve(handle);
          if (id === null) {
            continue;
          }
          hpView.hp[id] = (hpView.hp[id] ?? 0) - amount;
        }
      });

      builder.system({
        id: 'frontline_td:test.exercise.move',
        phase: 'movement',
        run(ctx) {
          const rng = ctx.rng(EXERCISE_RNG);
          const posView = ctx.write(pos);
          for (const id of ctx.query([Position])) {
            posView.x[id] = (posView.x[id] ?? 0) + rngNextIntBelow(rng, 3) - 1;
            posView.y[id] = (posView.y[id] ?? 0) + rngNextIntBelow(rng, 3) - 1;
          }
        },
      });

      builder.system({
        id: 'frontline_td:test.exercise.decay',
        phase: 'cleanup',
        emits: [Despawned],
        run(ctx) {
          const rng = ctx.rng(EXERCISE_RNG);
          const hpView = ctx.read(Health);
          for (const id of ctx.query([Health])) {
            if ((hpView.hp[id] ?? 0) <= 0) {
              const index = alive.findIndex((h) => ctx.resolve(h) === id);
              if (index >= 0) {
                const handle = alive[index];
                if (handle !== undefined) {
                  ctx.despawn(handle);
                  sink?.despawnedIds.push(id);
                  ctx.emit(Despawned, { id });
                }
                alive.splice(index, 1);
              }
            }
          }
          // Occasionally despawn the oldest tracked unit to churn id reuse.
          if (alive.length > 4 && rngNextIntBelow(rng, 3) === 0) {
            const handle = alive.shift();
            if (handle !== undefined) {
              ctx.despawn(handle);
            }
          }
        },
      });

      builder.system({
        id: 'frontline_td:test.exercise.heat',
        phase: 'capture_fog',
        run(ctx) {
          const layer = ctx.writeLayer(heat);
          const cursor = ctx.tick % layer.length;
          layer[cursor] = (layer[cursor] ?? 0) + 1;
        },
      });

      builder.snapshotChannel(AliveChannel, () => ({ count: alive.length }));

      builder.state('frontline_td:test.exercise', {
        save: (): Serializable => ({ alive: [...alive], spawnedCount }),
        load: (data) => {
          const saved = data as { alive: EntityHandle[]; spawnedCount: number };
          alive.splice(0, alive.length, ...saved.alive);
          spawnedCount = saved.spawnedCount;
        },
      });
    },
  };
}

export function exerciseCommand(
  tick: number,
  issuer: FactionId,
  def: { type: string },
  payload: unknown,
): CommandEnvelope {
  return { tick: toTick(tick), issuer, type: def.type, payload };
}
