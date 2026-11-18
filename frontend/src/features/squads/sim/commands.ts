// Squad commands: every handler validates fully before mutating so a
// rejected command never half-applies (ADR 0027). Reject codes are part
// of the protocol surface (i18n keys in the client batch).
import type { EntityHandle, EntityId, FactionId } from '../../../core/index';
import type { ComponentWriter, SimBuilder, SystemContext } from '../../../kernel/index';
import { Faction } from '../../../kernel/index';
import { Mover } from '../../movement/sim/index';
import {
  SquadsAssign,
  SquadsCreate,
  SquadsDisband,
  SquadsGather,
  SquadsOrder,
  SquadsSetStrength,
} from '../protocol';
import { SquadMember } from './components';
import type { Squad, SquadsEnv } from './state';
import type { SquadsDeps } from './deps';
import { traceRoute } from './routing';

type MemberWriter = ComponentWriter<{ squad: 'u16' }>;

// Resolve handles → live mover entity ids of the issuer's faction,
// sorted (full validation step of every mutating command).
function validUnits(
  ctx: SystemContext,
  handles: readonly number[],
  issuer: FactionId,
): number[] | null {
  const fac = ctx.read(Faction);
  const mover = ctx.read(Mover);
  const ids: number[] = [];
  for (const h of handles) {
    const id = ctx.resolve(h as EntityHandle);
    // Ids recycle: check component ownership before reading the dense
    // arrays so a stale Mover/Faction slot can't admit a non-mover.
    if (
      id === null ||
      !ctx.has(Faction, id) ||
      !ctx.has(Mover, id) ||
      (fac.id[id] ?? 0) !== issuer ||
      (mover.speed[id] ?? 0) <= 0
    ) {
      return null;
    }
    ids.push(id);
  }
  return ids.sort((a, b) => a - b);
}

function memberIds(ctx: SystemContext, squad: Squad): number[] {
  const out: number[] = [];
  for (const h of squad.members) {
    const id = ctx.resolve(h as EntityHandle);
    if (id !== null) {
      out.push(id);
    }
  }
  return out;
}

function writeMember(ctx: SystemContext, memberW: MemberWriter, id: number, squad: number): void {
  const handle = ctx.handleOf(id as EntityId);
  if (handle === null) {
    return;
  }
  if (ctx.has(SquadMember, id as EntityId)) {
    ctx.write(memberW).squad[id] = squad;
  } else {
    ctx.addComponent(memberW, handle, { squad });
  }
}

function removeFromSquad(
  ctx: SystemContext,
  memberW: MemberWriter,
  env: SquadsEnv,
  squadId: number,
  ids: readonly number[],
): void {
  const squad = env.squads.get(squadId);
  if (squad === undefined) {
    return;
  }
  const drop = new Set(ids);
  squad.members = squad.members.filter((h) => !drop.has(h));
  for (const id of ids) {
    writeMember(ctx, memberW, id, 0);
  }
}

function addToSquad(
  memberW: MemberWriter,
  env: SquadsEnv,
  ctx: SystemContext,
  squad: Squad,
  ids: readonly number[],
): void {
  // Units leave their previous squads first.
  const prev = new Map<number, number[]>();
  const member = ctx.read(SquadMember);
  for (const id of ids) {
    const old = member.squad[id] ?? 0;
    if (old !== 0 && old !== squad.id) {
      const list = prev.get(old) ?? [];
      list.push(id);
      prev.set(old, list);
    }
  }
  for (const [oldId, list] of prev) {
    removeFromSquad(ctx, memberW, env, oldId, list);
  }
  const existing = new Set(squad.members);
  for (const id of ids) {
    const h = Number(ctx.handleOf(id as EntityId));
    if (!existing.has(h)) {
      squad.members.push(h);
      existing.add(h);
    }
    writeMember(ctx, memberW, id, squad.id);
  }
  squad.members.sort((a, b) => a - b);
}

export function installSquadCommands(
  builder: SimBuilder,
  env: SquadsEnv,
  memberW: MemberWriter,
  deps: SquadsDeps,
): void {
  builder.command(SquadsCreate, (ctx, payload, issuer) => {
    const ids = validUnits(ctx, payload.units, issuer);
    if (ids === null || ids.length === 0) {
      ctx.reject(ids === null ? 'invalid_units' : 'no_units');
      return;
    }
    const id = env.next++;
    const squad: Squad = {
      id,
      faction: issuer,
      ...(payload.tag !== undefined ? { tag: payload.tag } : {}),
      members: [],
      strength: payload.strength ?? ids.length,
      order: { kind: 'idle', x: 0, y: 0, radius: 6 },
      phase: 'holding',
      lastGoal: { x: 0, y: 0 },
    };
    env.squads.set(id, squad);
    addToSquad(memberW, env, ctx, squad, ids);
  });

  builder.command(SquadsAssign, (ctx, payload, issuer) => {
    const squad = env.squads.get(payload.squad);
    if (squad === undefined || squad.faction !== issuer) {
      ctx.reject('no_squad');
      return;
    }
    const ids = validUnits(ctx, payload.units, issuer);
    if (ids === null) {
      ctx.reject('invalid_units');
      return;
    }
    addToSquad(memberW, env, ctx, squad, ids);
  });

  builder.command(SquadsDisband, (ctx, payload, issuer) => {
    const squad = env.squads.get(payload.squad);
    if (squad === undefined || squad.faction !== issuer) {
      ctx.reject('no_squad');
      return;
    }
    for (const id of memberIds(ctx, squad)) {
      writeMember(ctx, memberW, id, 0);
    }
    env.squads.delete(payload.squad);
  });

  builder.command(SquadsSetStrength, (ctx, payload, issuer) => {
    const squad = env.squads.get(payload.squad);
    if (squad === undefined || squad.faction !== issuer) {
      ctx.reject('no_squad');
      return;
    }
    squad.strength = payload.strength;
  });

  builder.command(SquadsOrder, (ctx, payload, issuer) => {
    const squad = env.squads.get(payload.squad);
    if (squad === undefined || squad.faction !== issuer) {
      ctx.reject('no_squad');
      return;
    }
    const radius = payload.kind === 'guard' ? (payload.radius ?? 6) : 0;
    squad.order = { kind: payload.kind, x: payload.x, y: payload.y, radius };
    squad.phase = 'moving';
    delete squad.route;
  });

  builder.command(SquadsGather, (ctx, payload, issuer) => {
    const squad = env.squads.get(payload.squad);
    if (squad === undefined || squad.faction !== issuer) {
      ctx.reject('no_squad');
      return;
    }
    squad.order = {
      kind: 'gather',
      x: payload.x,
      y: payload.y,
      radius: 0,
      launchTick: payload.launchTick,
      targetX: payload.targetX,
      targetY: payload.targetY,
    };
    squad.phase = 'moving';
    // Store the predicted gather→target route (pathing descent
    // polyline, capped at 512 cells); the snapshot shows it and the
    // advance order follows it at launchTick.
    const first = memberIds(ctx, squad)[0];
    const cls = first === undefined ? 0 : (ctx.read(Mover).cls[first] ?? 0);
    const route = traceRoute(
      deps.pathing,
      cls,
      payload.x,
      payload.y,
      payload.targetX,
      payload.targetY,
    );
    if (route !== null) {
      squad.route = route;
    } else {
      delete squad.route;
    }
  });
}
