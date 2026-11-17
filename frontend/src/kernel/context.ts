import {
  addComponent as bitecsAddComponent,
  addEntity,
  hasComponent,
  Not,
  query as bitecsQuery,
  removeComponent as bitecsRemoveComponent,
  removeEntity,
} from 'bitecs';
import type {
  CommandRejectedPayload,
  EntityHandle,
  EntityId,
  EventDef,
  FactionId,
  FactionRelation,
  IntentDef,
  RngState,
  Serializable,
} from '../core/index';
import { COMMAND_REJECTED, packHandle } from '../core/index';
import type {
  ComponentRef,
  ComponentWriter,
  FieldArray,
  FieldMap,
  ReadonlyNumberArray,
} from './components';
import { Faction } from './contracts';
import type { SimInternals } from './internals';
import {
  ensureComponent,
  ensureLayer,
  isAlive,
  isValid,
  layerArray,
  layerKey,
  relationOf,
  resolve,
} from './internals';
import type { GridLayerRef, GridLayerWriter } from './layers';
import { allModifierSources, combineStat, statSources } from './stats';
import type { ModifierSource, StatRef } from './stats';
import { queueDespawn, queueSpawn } from './structural';
import type { FieldValues, ReadView, SpawnInit, SystemContext, WriteView } from './types';

function assertRunning(i: SimInternals): {
  systemId: string;
  phase: number;
  allowedReads: Set<string>;
  allowedEmits: Set<string>;
} {
  const state = i.runState;
  if (state === null) {
    throw new Error('this operation is only available while a system is running');
  }
  return state;
}

export function emitChannel(
  i: SimInternals,
  type: string,
  kind: 'event' | 'intent',
  payload: Serializable,
): void {
  let channel = i.channels.get(type);
  if (channel === undefined) {
    channel = { kind, seq: 0, entries: [], cursors: {}, readers: [] };
    i.channels.set(type, channel);
  }
  const phase = i.runState?.phase ?? -1;
  channel.seq += 1;
  channel.entries.push({ seq: channel.seq, tick: i.tick, phase, payload });
  if (kind === 'event') {
    i.tickEvents.push({ type, tick: i.tick, payload });
  }
}

function readChannel(i: SimInternals, type: string): Serializable[] {
  const state = assertRunning(i);
  if (!state.allowedReads.has(type)) {
    throw new Error(
      `system '${state.systemId}' reads channel '${type}' without declaring it in 'reads'`,
    );
  }
  const channel = i.channels.get(type);
  if (channel === undefined) {
    return [];
  }
  const cursor = channel.cursors[state.systemId] ?? 0;
  const visible = channel.entries.filter(
    (entry) => entry.seq > cursor && (entry.tick < i.tick || entry.phase < state.phase),
  );
  const last = visible[visible.length - 1];
  if (last !== undefined) {
    channel.cursors[state.systemId] = last.seq;
  }
  return visible.map((entry) => entry.payload);
}

function requireIssuedWriter(i: SimInternals, writer: ComponentWriter): void {
  if (!i.issuedWriters.has(writer)) {
    throw new Error(`writer for '${writer.ref.id}' was not issued by claimWriter`);
  }
}

function requireIssuedLayerWriter(i: SimInternals, writer: GridLayerWriter): void {
  if (!i.issuedLayerWriters.has(writer)) {
    throw new Error(`layer writer for '${writer.layer.id}' was not issued by claimLayerWriter`);
  }
}

function requireNotOnStart(i: SimInternals, op: string): void {
  if (i.inOnStart) {
    throw new Error(`ctx.${op} is not available inside an onStart hook`);
  }
}

// Inspector callbacks are read-only: every mutating context method throws.
function requireNotInspector(i: SimInternals, op: string): void {
  if (i.inInspector) {
    throw new Error(`ctx.${op} is not available inside an inspector callback`);
  }
}

export function createContext(i: SimInternals): SystemContext {
  function read<F extends FieldMap>(ref: ComponentRef<F>): ReadView<F>;
  function read<P extends Serializable>(def: EventDef<P> | IntentDef<P>): P[];
  function read(arg: ComponentRef | EventDef<never> | IntentDef<never>): unknown {
    requireNotOnStart(i, 'read');
    const candidate = arg as { kind?: string; type?: string };
    if (candidate.kind === 'event' || candidate.kind === 'intent') {
      requireNotInspector(i, 'read');
      return readChannel(i, candidate.type ?? '');
    }
    const ref = arg as ComponentRef;
    const storage = ensureComponent(i, ref);
    return storage.fields;
  }

  const ctx: SystemContext = {
    get tick() {
      return i.tick as SystemContext['tick'];
    },

    read,

    write<F extends FieldMap>(writer: ComponentWriter<F>): WriteView<F> {
      requireNotInspector(i, 'write');
      requireIssuedWriter(i, writer);
      const storage = ensureComponent(i, writer.ref);
      return storage.fields as unknown as WriteView<F>;
    },

    has<F extends FieldMap>(ref: ComponentRef<F>, id: EntityId): boolean {
      ensureComponent(i, ref);
      return hasComponent(i.world, id, ref);
    },

    resolve(handle: EntityHandle): EntityId | null {
      return resolve(i, handle);
    },

    handleOf(id: EntityId): EntityHandle | null {
      if (!isAlive(i, id)) {
        return null;
      }
      return packHandle(id, i.generations[id] ?? 0);
    },

    isValid(handle: EntityHandle): boolean {
      return isValid(i, handle);
    },

    spawn(init: SpawnInit): EntityHandle {
      requireNotInspector(i, 'spawn');
      return queueSpawn(i, init, () => addEntity(i.world));
    },

    despawn(handle: EntityHandle): void {
      requireNotInspector(i, 'despawn');
      queueDespawn(i, handle);
    },

    addComponent<F extends FieldMap>(
      writer: ComponentWriter<F>,
      handle: EntityHandle,
      values?: Partial<FieldValues<F>>,
    ): void {
      requireNotInspector(i, 'addComponent');
      requireIssuedWriter(i, writer);
      i.structural.push({ kind: 'add', writer, handle, values });
    },

    removeComponent<F extends FieldMap>(writer: ComponentWriter<F>, handle: EntityHandle): void {
      requireNotInspector(i, 'removeComponent');
      requireIssuedWriter(i, writer);
      i.structural.push({ kind: 'remove', writer, handle });
    },

    query(
      include: readonly ComponentRef[],
      exclude: readonly ComponentRef[] = [],
    ): Readonly<Uint32Array> {
      if (include.length === 0) {
        throw new Error('kernel queries require at least one positive component');
      }
      const key =
        include
          .map((ref) => ref.id)
          .sort()
          .join(',') +
        '!' +
        exclude
          .map((ref) => ref.id)
          .sort()
          .join(',');
      const cached = i.queryCache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      for (const ref of [...include, ...exclude]) {
        ensureComponent(i, ref);
      }
      const terms = [...include, ...exclude.map((ref) => Not(ref))];
      const result = bitecsQuery(i.world, terms);
      const ids = new Uint32Array(result.length);
      for (let index = 0; index < result.length; index++) {
        ids[index] = result[index] ?? 0;
      }
      ids.sort();
      i.queryCache.set(key, ids);
      return ids;
    },

    emit<P extends Serializable>(def: EventDef<P> | IntentDef<P>, payload: P): void {
      requireNotOnStart(i, 'emit');
      requireNotInspector(i, 'emit');
      const state = assertRunning(i);
      if (!state.allowedEmits.has(def.type) || i.emitDefs.get(def.type) !== def) {
        throw new Error(
          `system '${state.systemId}' emits channel '${def.type}' without declaring it in 'emits'`,
        );
      }
      emitChannel(i, def.type, def.kind, payload);
    },

    schedule(
      type: string,
      delayTicks: number,
      params: Serializable,
      handles: readonly EntityHandle[],
    ): void {
      requireNotOnStart(i, 'schedule');
      requireNotInspector(i, 'schedule');
      if (!i.effects.has(type)) {
        throw new Error(`no effect handler registered for '${type}'`);
      }
      if (!Number.isSafeInteger(delayTicks) || delayTicks < 1) {
        throw new RangeError(`schedule delayTicks must be an integer >= 1, got ${delayTicks}`);
      }
      const effect = i.effects.get(type);
      if (effect === undefined) {
        return;
      }
      i.scheduleSeq += 1;
      i.scheduled.push({
        dueTick: i.tick + delayTicks,
        phase: effect.phase,
        seq: i.scheduleSeq,
        type,
        params,
        handles: [...handles],
      });
      i.scheduled.sort((a, b) => a.dueTick - b.dueTick || a.phase - b.phase || a.seq - b.seq);
    },

    rng(id: string): RngState {
      const state = i.rngStreams.get(id);
      if (state === undefined) {
        throw new Error(`undeclared rng stream '${id}'`);
      }
      return state;
    },

    factions(): readonly FactionId[] {
      return i.factionList;
    },

    relation(a: FactionId, b: FactionId): FactionRelation {
      return relationOf(i, a, b);
    },

    isHostile(a: FactionId, b: FactionId): boolean {
      return relationOf(i, a, b) === 'hostile';
    },

    layer(ref: GridLayerRef, faction?: FactionId): ReadonlyNumberArray {
      return layerArray(i, ref, faction);
    },

    writeLayer(writer: GridLayerWriter, faction?: FactionId): FieldArray {
      requireIssuedLayerWriter(i, writer);
      const array = layerArray(i, writer.layer, faction);
      ensureLayer(i, writer.layer);
      i.changedLayers.add(layerKey(writer.layer, faction));
      return array;
    },

    reject(reason: string): void {
      requireNotOnStart(i, 'reject');
      requireNotInspector(i, 'reject');
      const issuer = i.commandIssuer;
      if (issuer === undefined) {
        throw new Error('ctx.reject is only available inside a command handler');
      }
      const payload: CommandRejectedPayload = {
        type: i.commandType ?? '',
        issuer,
        reason,
      };
      emitChannel(i, COMMAND_REJECTED.type, 'event', payload);
    },

    ownedBy(handle: EntityHandle, faction: FactionId): boolean {
      const id = resolve(i, handle);
      if (id === null) {
        return false;
      }
      if (!hasComponent(i.world, id, Faction)) {
        return false;
      }
      const storage = i.storages.get(Faction);
      if (storage === undefined) {
        return false;
      }
      return storage.fields['id']?.[id] === faction;
    },

    stat(stat: StatRef, id: EntityId, base: number): number {
      requireNotOnStart(i, 'stat');
      let add = 0;
      let mul = 0;
      for (const source of statSources(stat)) {
        const storage = i.storages.get(source);
        if (storage === undefined || !hasComponent(i.world, id, source)) {
          continue;
        }
        const value = storage.fields['value']?.[id] ?? 0;
        if (source.op === 'add') {
          add += value;
        } else {
          mul += value;
        }
      }
      return combineStat(stat.kind, base, add, mul);
    },

    modifiersOf(id: EntityId): readonly ModifierSource[] {
      requireNotOnStart(i, 'modifiersOf');
      const out: ModifierSource[] = [];
      for (const source of allModifierSources()) {
        const storage = i.storages.get(source);
        if (storage === undefined || !hasComponent(i.world, id, source)) {
          continue;
        }
        out.push({
          stat: source.stat.id,
          source: source.id,
          op: source.op,
          value: storage.fields['value']?.[id] ?? 0,
        });
      }
      return out;
    },
  };
  return ctx;
}

export function structuralDeps(i: SimInternals): {
  removeEntityFromIndex: (id: number) => void;
  addMembership: (id: number, ref: ComponentRef) => void;
  removeMembership: (id: number, ref: ComponentRef) => void;
} {
  return {
    removeEntityFromIndex: (id) => {
      removeEntity(i.world, id);
    },
    addMembership: (id, ref) => {
      bitecsAddComponent(i.world, id, ref);
    },
    removeMembership: (id, ref) => {
      bitecsRemoveComponent(i.world, id, ref);
    },
  };
}
