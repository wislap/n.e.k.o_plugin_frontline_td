import { addComponent, addEntity, getEntityComponents, removeEntity } from 'bitecs';
import type { CommandEnvelope, EntityHandle, Serializable } from '../core/index';
import type { ComponentRef } from './components';
import { COMPONENT_REGISTRY, ensureCapacity } from './components';
import { LAYER_REGISTRY } from './layers';
import type {
  ChannelState,
  LogEntry,
  PendingCommand,
  ScheduledEffect,
  SimInternals,
} from './internals';
import { ensureComponent, ensureLayer } from './internals';

type Dict = Record<string, Serializable>;

// The index is serialized canonically: the live part of bitecs' dense array
// has no effect on future allocation (a removal always lands at the new
// aliveCount and recycling reads dense[aliveCount]), so only the alive SET
// and the ordered free list are state. This keeps the save decoupled from
// bitecs' live-order internals.
type EntitySave = {
  maxId: number;
  alive: number[]; // sorted ascending
  free: number[]; // dense[aliveCount..] in order
  generations: number[];
  data: Record<string, Record<string, Record<string, number>>>;
};

// serialize() must be called at a tick boundary: the structural queue is
// empty there by construction; anything else is a bug.
export function serializeState(i: SimInternals): Serializable {
  if (i.structural.length > 0 || i.pendingSpawns.size > 0 || i.cancelledSpawns.size > 0) {
    throw new Error('serialize() is only valid at a tick boundary');
  }
  const index = i.entityIndex;
  const entityData: EntitySave['data'] = {};
  for (let slot = 0; slot < index.aliveCount; slot++) {
    const id = index.dense[slot] ?? 0;
    const components: Record<string, Record<string, number>> = {};
    for (const ref of getEntityComponents(i.world, id) as ComponentRef[]) {
      const storage = i.storages.get(ref);
      const values: Record<string, number> = {};
      for (const field of Object.keys(ref.fields)) {
        values[field] = storage?.fields[field]?.[id] ?? 0;
      }
      components[ref.id] = values;
    }
    entityData[String(id)] = components;
  }
  const entities: EntitySave = {
    maxId: index.maxId,
    alive: index.dense.slice(0, index.aliveCount).sort((a, b) => a - b),
    free: index.dense.slice(index.aliveCount),
    generations: Array.from(i.generations.slice(0, index.maxId + 1)),
    data: entityData,
  };

  const channels: Dict = {};
  for (const [type, channel] of i.channels) {
    channels[type] = {
      kind: channel.kind,
      seq: channel.seq,
      readers: [...channel.readers],
      cursors: { ...channel.cursors },
      entries: channel.entries.map((entry) => ({
        seq: entry.seq,
        tick: entry.tick,
        phase: entry.phase,
        payload: copySerializable(entry.payload),
      })),
    };
  }

  const rng: Dict = { streams: {}, controllers: {} };
  const streams = rng['streams'] as Dict;
  for (const [id, state] of i.rngStreams) {
    streams[id] = Uint32Array.from(state);
  }
  const controllers = rng['controllers'] as Dict;
  for (const [faction, state] of i.controllerRng) {
    controllers[String(faction)] = Uint32Array.from(state);
  }

  const layers: Dict = {};
  for (const [id, ref] of i.layerDefs) {
    const storage = i.layers.get(ref);
    if (storage === undefined) {
      continue;
    }
    if ('data' in storage) {
      layers[id] = { per: {}, data: storage.data.slice() };
    } else {
      const per: Dict = {};
      for (const [faction, array] of storage.perFaction) {
        per[String(faction)] = array.slice();
      }
      layers[id] = { per, data: null };
    }
  }

  return {
    format: 1,
    tick: i.tick,
    entities,
    channels,
    tickEvents: i.tickEvents.map((event) => ({
      type: event.type,
      tick: event.tick,
      payload: copySerializable(event.payload),
    })),
    scheduled: {
      seq: i.scheduleSeq,
      queue: i.scheduled.map((effect) => ({
        dueTick: effect.dueTick,
        phase: effect.phase,
        seq: effect.seq,
        type: effect.type,
        params: copySerializable(effect.params),
        handles: [...effect.handles],
      })),
    },
    rng,
    layers,
    changedLayers: [...i.lastChangedLayers],
    // Controller private states, keyed by faction ascending. Present as
    // an (often empty) object so the shape is stable for hashing.
    controllerStates: Object.fromEntries(
      [...i.controllers]
        .sort((a, b) => Number(a.faction) - Number(b.faction))
        .flatMap((controller) =>
          controller.save === undefined
            ? []
            : [[String(controller.faction), copySerializable(controller.save())]],
        ),
    ),
    commands: {
      seq: i.commandSeq,
      log: i.commandLogEntries.map(copyEnvelope),
      pending: i.pendingCommands.map((pending) => ({
        seq: pending.seq,
        envelope: copyEnvelope(pending.envelope),
      })),
    },
    moduleStates: Object.fromEntries(
      [...i.moduleStates].map(([id, hooks]) => [id, copySerializable(hooks.save())]),
    ),
  };
}

// The serialized state must be a detached copy: module save hooks and
// payloads may return live arrays/objects, and the source sim keeps
// mutating them after serialize() returns.
function copySerializable<T extends Serializable>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => copySerializable(v)) as T;
  }
  if (ArrayBuffer.isView(value)) {
    return value.slice() as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, Serializable> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = copySerializable(v);
    }
    return out as T;
  }
  return value;
}

function copyEnvelope(envelope: CommandEnvelope): {
  tick: number;
  issuer: number;
  type: string;
  payload: Serializable;
} {
  return {
    tick: envelope.tick,
    issuer: envelope.issuer,
    type: envelope.type,
    payload: copySerializable(envelope.payload as Serializable),
  };
}

export function restoreState(i: SimInternals, raw: Serializable): void {
  const state = raw as unknown as {
    format: number;
    tick: number;
    entities: EntitySave;
    channels: Record<
      string,
      {
        kind: 'event' | 'intent';
        seq: number;
        readers: string[];
        cursors: Record<string, number>;
        entries: LogEntry[];
      }
    >;
    tickEvents: { type: string; tick: number; payload: Serializable }[];
    scheduled: { seq: number; queue: ScheduledEffect[] };
    rng: {
      streams: Record<string, Uint32Array>;
      controllers: Record<string, Uint32Array>;
    };
    layers: Record<string, { per: Record<string, Serializable>; data: Serializable }>;
    changedLayers: string[];
    commands: { seq: number; log: CommandEnvelope[]; pending: PendingCommand[] };
    moduleStates: Record<string, Serializable>;
    controllerStates?: Record<string, Serializable>;
  };
  if (state.format !== 1) {
    throw new Error(`unsupported save format ${state.format}`);
  }
  i.tick = state.tick;

  // Reproduce bitecs entity-index recycling: allocate ids 1..maxId, then
  // remove the dead ids in REVERSE saved free-list order so each lands back
  // at the new aliveCount (dense[aliveCount + k] === free[k]).
  const saved = state.entities;
  for (let n = 0; n < saved.maxId; n++) {
    addEntity(i.world);
  }
  for (let k = saved.free.length - 1; k >= 0; k--) {
    removeEntity(i.world, saved.free[k] ?? 0);
  }
  const restoredFree = i.entityIndex.dense.slice(i.entityIndex.aliveCount);
  const restoredAlive = i.entityIndex.dense
    .slice(0, i.entityIndex.aliveCount)
    .sort((a, b) => a - b);
  if (
    restoredFree.length !== saved.free.length ||
    restoredFree.some((id, k) => id !== saved.free[k]) ||
    restoredAlive.length !== saved.alive.length ||
    restoredAlive.some((id, k) => id !== saved.alive[k])
  ) {
    throw new Error('entity index reconstruction failed: free/alive sets do not match the save');
  }
  for (let id = 0; id < saved.generations.length; id++) {
    i.generations[id] = saved.generations[id] ?? 0;
  }
  const aliveIds = Object.keys(saved.data)
    .map(Number)
    .sort((a, b) => a - b);
  for (const id of aliveIds) {
    const components = saved.data[String(id)] ?? {};
    for (const [refId, values] of Object.entries(components)) {
      const ref = i.componentDefs.get(refId) ?? COMPONENT_REGISTRY.get(refId);
      if (ref === undefined) {
        throw new Error(`save references unknown component '${refId}'`);
      }
      const storage = ensureComponent(i, ref);
      ensureCapacity(ref, storage, id + 1);
      addComponent(i.world, id, ref);
      for (const [field, value] of Object.entries(values)) {
        const array = storage.fields[field];
        if (array === undefined) {
          throw new Error(`save references unknown field '${refId}.${field}'`);
        }
        array[id] = value;
      }
    }
  }

  for (const [type, saved_channel] of Object.entries(state.channels)) {
    const channel: ChannelState = {
      kind: saved_channel.kind,
      seq: saved_channel.seq,
      readers: [...saved_channel.readers],
      cursors: { ...saved_channel.cursors },
      entries: saved_channel.entries.map((entry) => ({ ...entry })),
    };
    i.channels.set(type, channel);
  }
  i.tickEvents = state.tickEvents.map((event) => ({
    type: event.type,
    tick: event.tick,
    payload: event.payload,
  }));
  i.scheduleSeq = state.scheduled.seq;
  i.scheduled = state.scheduled.queue.map((effect) => ({
    ...effect,
    handles: [...effect.handles] as EntityHandle[],
  }));

  for (const [id, saved_state] of Object.entries(state.rng.streams)) {
    const existing = i.rngStreams.get(id);
    if (existing === undefined) {
      i.rngStreams.set(id, Uint32Array.from(saved_state));
    } else {
      existing.set(saved_state);
    }
  }
  for (const [faction, saved_state] of Object.entries(state.rng.controllers)) {
    const key = Number(faction);
    const existing = i.controllerRng.get(key);
    if (existing === undefined) {
      i.controllerRng.set(key, Uint32Array.from(saved_state));
    } else {
      existing.set(saved_state);
    }
  }

  for (const [id, saved_layer] of Object.entries(state.layers)) {
    const ref = i.layerDefs.get(id) ?? LAYER_REGISTRY.get(id);
    if (ref === undefined) {
      throw new Error(`save references unknown grid layer '${id}'`);
    }
    const storage = ensureLayer(i, ref);
    if ('data' in storage) {
      if (saved_layer.data !== null) {
        storage.data.set(saved_layer.data as ArrayLike<number>);
      }
    } else {
      for (const [faction, array] of Object.entries(saved_layer.per)) {
        storage.perFaction.get(Number(faction))?.set(array as ArrayLike<number>);
      }
    }
  }
  i.changedLayers = new Set();
  i.lastChangedLayers = new Set(state.changedLayers);

  i.commandSeq = state.commands.seq;
  i.commandLogEntries = state.commands.log.map((entry) => entry);
  i.pendingCommands = state.commands.pending.map((pending) => ({
    seq: pending.seq,
    envelope: pending.envelope,
  }));

  for (const [id, data] of Object.entries(state.moduleStates)) {
    i.moduleStates.get(id)?.load(data);
  }

  // Controller private states load before the first post-restore step so
  // the restored controller decides from the same position the
  // uninterrupted run's controller had.
  const savedControllers = state.controllerStates ?? {};
  for (const controller of i.controllers) {
    const data = savedControllers[String(controller.faction)];
    if (data !== undefined) {
      controller.load?.(data);
    }
  }
}
