// Read-only views: the per-entity inspector section and the per-faction
// logistics network snapshot channel.
import type { EntityId, Serializable } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { Faction } from '../../../kernel/index';
import { Position } from '../../movement/sim/index';
import type { LogisticsNetwork } from '../protocol';
import { CARGO_CLASSES, CARGO_RESERVE, SLOT_EXPORT, SLOT_SITE, UNMET_REASONS } from '../protocol';
import { CARGO_SLOTS, CargoStore, EMPTY_CARGO, LogisticsNode } from './components';
import type { LogisticsEnv } from './env';
import { sget } from './slots';

export function inspectLogistics(
  env: LogisticsEnv,
  ctx: SystemContext,
  id: EntityId,
): Serializable | null {
  const hasStore = ctx.has(CargoStore, id);
  const hasNode = ctx.has(LogisticsNode, id);
  if (!hasStore && !hasNode) {
    return null;
  }
  const store = ctx.read(CargoStore);
  const fac = ctx.read(Faction);
  const pos = ctx.read(Position);
  const faction = fac.id[id] ?? 0;
  const topo = env.topos.get(faction);
  let attached: number | null = null;
  if (topo !== undefined && hasStore && ctx.has(Position, id)) {
    const a = env.attachOf(ctx, topo, id, pos.x[id] ?? 0, pos.y[id] ?? 0);
    if (a !== null) {
      attached = Number(ctx.handleOf(topo.nodes[a.node]?.id as EntityId) ?? 0);
    }
  }
  const slots: Record<string, unknown>[] = [];
  if (hasStore) {
    for (let i = 0; i < CARGO_SLOTS; i++) {
      const cargo = sget(store, 'cargo', i, id);
      if (cargo === EMPTY_CARGO) {
        continue;
      }
      const flags = sget(store, 'flags', i, id);
      slots.push({
        cargo: env.db.cargos.byIndex(cargo)?.id ?? cargo,
        capacity: sget(store, 'cap', i, id),
        amount: sget(store, 'amt', i, id),
        class: CARGO_CLASSES[sget(store, 'cls', i, id)] ?? 'lifeline',
        export: (flags & SLOT_EXPORT) !== 0,
        site: (flags & SLOT_SITE) !== 0,
        unmet: UNMET_REASONS[sget(store, 'unmet', i, id)] ?? 'none',
      });
    }
  }
  const node = hasNode ? ctx.read(LogisticsNode) : null;
  return {
    slots,
    bottleneck: store.bottleneck[id] ?? 0,
    attachedNode: attached,
    node:
      node === null
        ? null
        : {
            connect: node.connect[id] ?? 0,
            service: node.service[id] ?? 0,
            vehicles: node.vehicles[id] ?? 0,
            warehouse: (node.warehouse[id] ?? 0) === 1,
          },
  } as unknown as Serializable;
}

export function networkSnapshot(
  env: LogisticsEnv,
  ctx: SystemContext,
  observer: number,
): LogisticsNetwork {
  const state = env.stateOf(observer);
  const topo = env.topos.get(observer);
  const priorities = [
    CARGO_CLASSES[0] as string,
    ...state.priorities.map((c) => CARGO_CLASSES[c] ?? 'reserve'),
    CARGO_CLASSES[CARGO_RESERVE] as string,
  ];
  const links = {
    a: new Uint16Array(0),
    b: new Uint16Array(0),
    outBp: new Uint16Array(0),
    inBp: new Uint16Array(0),
    outSat: new Uint8Array(0),
    inSat: new Uint8Array(0),
    pathOffsets: new Uint32Array(0),
    pathCells: new Uint32Array(0),
    m: new Uint32Array(0),
    quotaOut: new Int32Array(0),
    quotaIn: new Int32Array(0),
    volOut: new Int32Array(0),
    volIn: new Int32Array(0),
    intercept: new Uint16Array(0),
  };
  if (topo === undefined) {
    return {
      stock: [...state.stock],
      nodes: {
        handles: new Float64Array(0),
        x: new Float32Array(0),
        y: new Float32Array(0),
      },
      links,
      unmet: [...state.unmet],
      unmetExport: [...state.unmetExport],
      priorities,
    };
  }
  const nodes = {
    handles: new Float64Array(topo.nodes.length),
    x: new Float32Array(topo.nodes.length),
    y: new Float32Array(topo.nodes.length),
  };
  topo.nodes.forEach((n, i) => {
    nodes.handles[i] = Number(ctx.handleOf(n.id as EntityId) ?? 0);
    nodes.x[i] = n.x;
    nodes.y[i] = n.y;
  });
  const linkCount = topo.links.length;
  links.a = new Uint16Array(linkCount);
  links.b = new Uint16Array(linkCount);
  links.outBp = new Uint16Array(linkCount);
  links.inBp = new Uint16Array(linkCount);
  links.outSat = new Uint8Array(linkCount);
  links.inSat = new Uint8Array(linkCount);
  links.pathOffsets = new Uint32Array(linkCount + 1);
  links.pathCells = new Uint32Array(topo.links.reduce((n, l) => n + l.cells.length, 0));
  links.m = new Uint32Array(linkCount);
  links.quotaOut = new Int32Array(linkCount);
  links.quotaIn = new Int32Array(linkCount);
  links.volOut = new Int32Array(linkCount);
  links.volIn = new Int32Array(linkCount);
  links.intercept = new Uint16Array(linkCount);
  let off = 0;
  topo.links.forEach((l, i) => {
    links.a[i] = l.a;
    links.b[i] = l.b;
    links.outBp[i] = state.outBp[i] ?? 0;
    links.inBp[i] = state.inBp[i] ?? 0;
    links.outSat[i] = state.outSat[i] ?? 0;
    links.inSat[i] = state.inSat[i] ?? 0;
    links.m[i] = l.m;
    links.quotaOut[i] = state.quotaOut[i] ?? 0;
    links.quotaIn[i] = state.quotaIn[i] ?? 0;
    links.volOut[i] = state.volOut[i] ?? 0;
    links.volIn[i] = state.volIn[i] ?? 0;
    links.intercept[i] = state.intercept[i] ?? 0;
    links.pathOffsets[i] = off;
    for (const c of l.cells) {
      links.pathCells[off] = c;
      off += 1;
    }
  });
  links.pathOffsets[linkCount] = off;
  return {
    stock: [...state.stock],
    nodes,
    links,
    unmet: [...state.unmet],
    unmetExport: [...state.unmetExport],
    priorities,
  };
}
