// Combat module (ADR 0011): acquire+fire in combat_intent, damage
// resolution in resolve, despawns in cleanup. Registered after movement
// and construction so their cleanup-phase death readers run first.
import type { EntityHandle, EntityId, FactionId, Serializable } from '../../../core/index';
import { floorDiv } from '../../../core/index';
import type { ReadonlyNumberArray, SimModule, SystemContext } from '../../../kernel/index';
import { Faction, InWorld, OPERATIONAL_EXCLUDE } from '../../../kernel/index';
import { ConsumeIntent } from '../../logistics/protocol';
import { CARGO_SLOTS, CargoStore, sget } from '../../logistics/sim/index';
import { Position } from '../../movement/sim/index';
import { CombatDied, CombatShot, DamageIntent } from '../protocol';
import type { DamagePayload } from '../protocol';
import { FREE_COST_CARGO, Health, Targetable, Weapon } from './components';

// Uniform bucket-grid cell size for target lookups (cells).
const BUCKET = 4;

// The single ordered damage pipeline: base damage -> hp. Modifiers,
// armor and shields slot in here in later batches.
function applyDamage(hp: number, amount: number): number {
  return hp - amount;
}

// hp fraction in basis points; entities without Health read as full.
export function healthFraction(ctx: SystemContext, id: number): number {
  if (!ctx.has(Health, id as EntityId)) {
    return 10000;
  }
  const h = ctx.read(Health);
  const max = Math.max(1, h.max[id] ?? 1);
  return floorDiv(Math.max(0, h.hp[id] ?? 0) * 10000, max);
}

// Centre distance minus the target's hit radius.
function shotDistance(
  pos: { x: ReadonlyNumberArray; y: ReadonlyNumberArray },
  from: number,
  to: number,
  radius: number,
): number {
  const dx = (pos.x[from] ?? 0) - (pos.x[to] ?? 0);
  const dy = (pos.y[from] ?? 0) - (pos.y[to] ?? 0);
  return Math.sqrt(dx * dx + dy * dy) - radius;
}

export interface CombatModule extends SimModule {
  // Nearest hostile (relation table) Targetable + InWorld entity id
  // within `radius` of (x, y), ties by entity id. Reads the bucket grid
  // built by the last combat_intent run — called from `orders` that is
  // the previous tick's grid (one phase stale).
  nearestHostile(
    ctx: SystemContext,
    faction: FactionId,
    x: number,
    y: number,
    radius: number,
    filter?: (id: EntityId) => boolean,
  ): EntityId | null;
  // The weapon's effective range (0 without a Weapon component).
  weaponRange(ctx: SystemContext, id: EntityId): number;
  // True when a hostile targetable is in fire range of the entity's
  // weapon — the same test the fire system uses (weapon range minus
  // the target's hit radius). Same bucket-grid staleness as
  // nearestHostile when called from `orders`.
  inWeaponReach(ctx: SystemContext, id: EntityId): boolean;
}

export function createCombatModule(): CombatModule {
  // Target bucket grid, reused every tick (lists are emptied in place).
  const buckets = new Map<number, number[]>();

  return {
    id: 'frontline_td:combat',

    nearestHostile(ctx, faction, x, y, radius, filter) {
      const pos = ctx.read(Position);
      const fac = ctx.read(Faction);
      const tar = ctx.read(Targetable);
      const bx = Math.floor(x / BUCKET);
      const by = Math.floor(y / BUCKET);
      const reach = Math.ceil(radius / BUCKET) + 1;
      let best: EntityId | null = null;
      let bestD = Infinity;
      for (let gy = by - reach; gy <= by + reach; gy++) {
        for (let gx = bx - reach; gx <= bx + reach; gx++) {
          for (const t of buckets.get(gy * 65536 + gx) ?? []) {
            if (!ctx.isHostile(faction, (fac.id[t] ?? 0) as FactionId)) {
              continue;
            }
            if (filter !== undefined && !filter(t as EntityId)) {
              continue;
            }
            const dx = (pos.x[t] ?? 0) - x;
            const dy = (pos.y[t] ?? 0) - y;
            const d = Math.sqrt(dx * dx + dy * dy) - (tar.radius[t] ?? 0);
            if (d <= radius && (d < bestD || (d === bestD && (best === null || t < best)))) {
              bestD = d;
              best = t as EntityId;
            }
          }
        }
      }
      return best;
    },

    weaponRange(ctx, id) {
      return ctx.read(Weapon).range[id] ?? 0;
    },

    inWeaponReach(ctx, id) {
      const range = ctx.read(Weapon).range[id] ?? 0;
      if (range <= 0) {
        return false;
      }
      const pos = ctx.read(Position);
      const fac = ctx.read(Faction);
      return (
        this.nearestHostile(
          ctx,
          (fac.id[id] ?? 0) as FactionId,
          pos.x[id] ?? 0,
          pos.y[id] ?? 0,
          range,
        ) !== null
      );
    },

    install(builder) {
      const healthW = builder.claimWriter(Health);
      const weaponW = builder.claimWriter(Weapon);

      // Acquire + fire: uniform bucket grid over hostile targetables,
      // rebuilt every tick. Keeps the current target while it stays
      // valid and in range; otherwise picks the nearest (ties by id).
      builder.system({
        id: 'frontline_td:combat.fire',
        phase: 'combat_intent',
        emits: [DamageIntent, ConsumeIntent, CombatShot],
        run(ctx) {
          const pos = ctx.read(Position);
          const fac = ctx.read(Faction);
          const tar = ctx.read(Targetable);
          const store = ctx.read(CargoStore);
          // Bucket hostile candidates by cell. The map and its lists are
          // reused across ticks (emptied, never reallocated).
          for (const list of buckets.values()) {
            list.length = 0;
          }
          const targets = ctx.query([Health, Targetable, Position, InWorld, Faction]);
          for (const id of targets) {
            const key =
              Math.floor((pos.y[id] ?? 0) / BUCKET) * 65536 + Math.floor((pos.x[id] ?? 0) / BUCKET);
            const list = buckets.get(key);
            if (list === undefined) {
              buckets.set(key, [id]);
            } else {
              list.push(id);
            }
          }
          const weapons = ctx.write(weaponW);
          const wp = ctx.read(Weapon);
          for (const id of ctx.query([Weapon, Position, Faction, InWorld], OPERATIONAL_EXCLUDE)) {
            if ((wp.readyAt[id] ?? 0) > ctx.tick) {
              continue;
            }
            const shooterFaction = (fac.id[id] ?? 0) as FactionId;
            const range = wp.range[id] ?? 0;
            const inRange = (t: number): boolean =>
              shotDistance(pos, id, t, tar.radius[t] ?? 0) <= range;
            // Keep the current target while it stays valid.
            let target: EntityId | null = ctx.resolve((wp.target[id] ?? 0) as EntityHandle);
            if (
              target !== null &&
              (!ctx.has(Health, target) ||
                !ctx.has(Targetable, target) ||
                !ctx.has(InWorld, target) ||
                !ctx.isHostile(shooterFaction, (fac.id[target] ?? 0) as FactionId) ||
                !inRange(target))
            ) {
              target = null;
            }
            if (target === null) {
              // Nearest hostile in range; ties by entity id.
              const bx = Math.floor((pos.x[id] ?? 0) / BUCKET);
              const by = Math.floor((pos.y[id] ?? 0) / BUCKET);
              const reach = Math.ceil(range / BUCKET) + 1;
              let best: number | null = null;
              let bestD = Infinity;
              for (let gy = by - reach; gy <= by + reach; gy++) {
                for (let gx = bx - reach; gx <= bx + reach; gx++) {
                  for (const t of buckets.get(gy * 65536 + gx) ?? []) {
                    if (t === id || !ctx.isHostile(shooterFaction, (fac.id[t] ?? 0) as FactionId)) {
                      continue;
                    }
                    const d = shotDistance(pos, id, t, tar.radius[t] ?? 0);
                    if (d <= range && (d < bestD || (d === bestD && (best === null || t < best)))) {
                      bestD = d;
                      best = t;
                    }
                  }
                }
              }
              target = best as EntityId | null;
            }
            weapons.target[id] = target === null ? 0 : Number(ctx.handleOf(target));
            if (target === null) {
              continue;
            }
            // Cost gating: one slot must hold the full shot cost.
            const costCargo = wp.costCargo[id] ?? 0;
            const costAmount = wp.costAmount[id] ?? 0;
            if (costCargo !== FREE_COST_CARGO && costAmount > 0) {
              if (!ctx.has(CargoStore, id as EntityId)) {
                continue;
              }
              let affordable = false;
              for (let i = 0; i < CARGO_SLOTS; i++) {
                if (
                  sget(store, 'cargo', i, id) === costCargo &&
                  sget(store, 'amt', i, id) >= costAmount
                ) {
                  affordable = true;
                }
              }
              if (!affordable) {
                continue;
              }
            }
            const self = ctx.handleOf(id as EntityId);
            const to = ctx.handleOf(target);
            if (self === null || to === null) {
              continue;
            }
            ctx.emit(DamageIntent, { target: Number(to), amount: wp.damage[id] ?? 0 });
            if (costCargo !== FREE_COST_CARGO && costAmount > 0) {
              ctx.emit(ConsumeIntent, {
                handle: Number(self),
                cargo: costCargo,
                amount: costAmount,
              });
            }
            ctx.emit(CombatShot, {
              from: Number(self),
              to: Number(to),
              x0: pos.x[id] ?? 0,
              y0: pos.y[id] ?? 0,
              x1: pos.x[target] ?? 0,
              y1: pos.y[target] ?? 0,
            });
            weapons.readyAt[id] = ctx.tick + (wp.cooldown[id] ?? 1);
          }
        },
      });

      // Resolve: apply damage in (target id, intent order); hp <= 0 emits
      // combat.died once. Later pipeline stages (modifiers, armor,
      // shields) slot into applyDamage.
      builder.system({
        id: 'frontline_td:combat.resolve',
        phase: 'resolve',
        reads: [DamageIntent],
        emits: [CombatDied],
        run(ctx) {
          const intents = ctx.read(DamageIntent);
          if (intents.length === 0) {
            return;
          }
          const ordered = intents
            .map((p, order) => ({ id: ctx.resolve(p.target as EntityHandle), p, order }))
            .filter((e): e is { id: EntityId; p: DamagePayload; order: number } => e.id !== null)
            .sort((a, b) => a.id - b.id || a.order - b.order);
          const hp = ctx.write(healthW);
          const hpR = ctx.read(Health);
          const fac = ctx.read(Faction);
          const died = new Set<number>();
          for (const e of ordered) {
            if (!ctx.has(Health, e.id)) {
              continue;
            }
            const before = hpR.hp[e.id] ?? 0;
            if (before <= 0) {
              continue;
            }
            const after = applyDamage(before, e.p.amount);
            hp.hp[e.id] = after;
            if (after <= 0 && !died.has(e.id)) {
              died.add(e.id);
              ctx.emit(CombatDied, {
                handle: Number(ctx.handleOf(e.id) ?? 0),
                faction: fac.id[e.id] ?? 0,
              });
            }
          }
        },
      });

      // Despawn the dead — registered last so movement and construction
      // cleanup readers observe combat.died first.
      builder.system({
        id: 'frontline_td:combat.despawn',
        phase: 'cleanup',
        reads: [CombatDied],
        run(ctx) {
          for (const p of ctx.read(CombatDied)) {
            if (ctx.isValid(p.handle as EntityHandle)) {
              ctx.despawn(p.handle as EntityHandle);
            }
          }
        },
      });

      // Inspector: hp, weapon ready/target, cost cargo stock.
      builder.inspector('frontline_td:combat', (ctx, id) => {
        if (!ctx.has(Health, id) && !ctx.has(Weapon, id)) {
          return null;
        }
        const h = ctx.read(Health);
        const wp = ctx.read(Weapon);
        const store = ctx.read(CargoStore);
        const section: Record<string, unknown> = {
          hp: h.hp[id] ?? 0,
          max: h.max[id] ?? 0,
        };
        if (ctx.has(Weapon, id)) {
          const costCargo = wp.costCargo[id] ?? FREE_COST_CARGO;
          let costStock = 0;
          if (costCargo !== FREE_COST_CARGO && ctx.has(CargoStore, id)) {
            for (let i = 0; i < CARGO_SLOTS; i++) {
              if (sget(store, 'cargo', i, id) === costCargo) {
                costStock += sget(store, 'amt', i, id);
              }
            }
          }
          section['readyIn'] = Math.max(0, (wp.readyAt[id] ?? 0) - ctx.tick);
          section['target'] = wp.target[id] ?? 0;
          section['costCargo'] = costCargo === FREE_COST_CARGO ? -1 : costCargo;
          section['costStock'] = costStock;
        }
        return section as Serializable;
      });
    },
  };
}
