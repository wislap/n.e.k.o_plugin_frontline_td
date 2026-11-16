import type {
  CommandDef,
  EventDef,
  FactionId,
  IntentDef,
  Serializable,
  SnapshotChannelDef,
} from '../core/index';
import { parseContentId } from '../core/index';
import { ensureLayer } from './internals';
import type { ChannelState, SimInternals } from './internals';
import type { GridLayerRef, GridLayerWriter } from './layers';
import { phaseIndex } from './phases';
import type { ComponentRef, ComponentWriter, FieldMap } from './components';
import type { CommandHandler, EffectHandler, SimBuilder, SystemContext, SystemSpec } from './types';

function requireRegistryKey(id: string, what: string): void {
  if (parseContentId(id) === null) {
    throw new Error(`invalid ${what} id '${id}' (expected 'pack:name')`);
  }
}

function ensureChannel(i: SimInternals, type: string, kind: 'event' | 'intent'): ChannelState {
  let channel = i.channels.get(type);
  if (channel === undefined) {
    channel = { kind, seq: 0, entries: [], cursors: {}, readers: [] };
    i.channels.set(type, channel);
  }
  return channel;
}

// Every message type a module reads or emits is registered once; two
// different def objects claiming the same type are an install-time error so
// visibility can never depend on emission order (ADR 0006/0017).
function registerDef(i: SimInternals, def: EventDef<never> | IntentDef<never>): void {
  const existing = i.emitDefs.get(def.type);
  if (existing !== undefined && existing !== def) {
    throw new Error(`conflicting definitions for message type '${def.type}'`);
  }
  i.emitDefs.set(def.type, def);
}

function registerChannelUse(
  i: SimInternals,
  defs: readonly (EventDef<never> | IntentDef<never>)[] | undefined,
): Set<string> {
  const types = new Set<string>();
  for (const def of defs ?? []) {
    registerDef(i, def);
    types.add(def.type);
  }
  return types;
}

export function createBuilder(i: SimInternals, moduleId: string): SimBuilder {
  return {
    claimWriter<F extends FieldMap>(ref: ComponentRef<F>): ComponentWriter<F> {
      const existing = i.writers.get(ref);
      if (existing !== undefined) {
        throw new Error(
          `component '${ref.id}' already has writer '${existing}'; '${moduleId}' cannot also claim it`,
        );
      }
      i.writers.set(ref, moduleId);
      const writer: ComponentWriter<F> = { ref, ownerId: moduleId };
      i.issuedWriters.add(writer);
      return writer;
    },

    claimLayerWriter(ref: GridLayerRef): GridLayerWriter {
      const existing = i.layerWriters.get(ref);
      if (existing !== undefined) {
        throw new Error(
          `layer '${ref.id}' already has writer '${existing}'; '${moduleId}' cannot also claim it`,
        );
      }
      i.layerWriters.set(ref, moduleId);
      // Register + allocate at claim time so snapshots expose every claimed
      // layer even before its first write (the delta transport's first post
      // must carry all visible layers).
      ensureLayer(i, ref);
      const writer: GridLayerWriter = { layer: ref, ownerId: moduleId };
      i.issuedLayerWriters.add(writer);
      return writer;
    },

    system(spec: SystemSpec): void {
      requireRegistryKey(spec.id, 'system');
      if (i.systems.some((system) => system.id === spec.id)) {
        throw new Error(`duplicate system id '${spec.id}'`);
      }
      const everyTicks = spec.everyTicks ?? 1;
      const offset = spec.offset ?? 0;
      if (!Number.isSafeInteger(everyTicks) || everyTicks < 1) {
        throw new RangeError(
          `system '${spec.id}': everyTicks must be an integer >= 1, got ${everyTicks}`,
        );
      }
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= everyTicks) {
        throw new RangeError(
          `system '${spec.id}': offset must be an integer in [0, everyTicks), got ${offset}`,
        );
      }
      const reads = new Set<string>();
      for (const def of spec.reads ?? []) {
        registerDef(i, def);
        reads.add(def.type);
        const channel = ensureChannel(i, def.type, def.kind);
        if (!channel.readers.includes(spec.id)) {
          channel.readers.push(spec.id);
        }
      }
      const emits = registerChannelUse(i, spec.emits);
      i.systems.push({
        id: spec.id,
        moduleId,
        phase: phaseIndex(spec.phase),
        everyTicks,
        offset,
        reads,
        emits,
        run: spec.run,
      });
    },

    effect(
      type: string,
      phase: SystemSpec['phase'],
      handler: EffectHandler,
      opts?: { emits?: readonly (EventDef<never> | IntentDef<never>)[] },
    ): void {
      requireRegistryKey(type, 'effect');
      if (i.effects.has(type)) {
        throw new Error(`duplicate effect type '${type}'`);
      }
      i.effects.set(type, {
        phase: phaseIndex(phase),
        handler,
        moduleId,
        emits: registerChannelUse(i, opts?.emits),
      });
    },

    command<P>(
      def: CommandDef<P>,
      handler: CommandHandler<P>,
      opts?: { emits?: readonly (EventDef<never> | IntentDef<never>)[] },
    ): void {
      if (i.commandDefs.has(def.type)) {
        throw new Error(`duplicate command handler for '${def.type}'`);
      }
      i.commandDefs.set(def.type, {
        def: def,
        handler: handler,
        emits: registerChannelUse(i, opts?.emits),
      });
    },

    snapshotChannel<T>(
      def: SnapshotChannelDef<T>,
      build: (ctx: SystemContext, observer: FactionId) => T,
    ): void {
      requireRegistryKey(def.id, 'snapshot channel');
      if (i.snapshotChannels.has(def.id)) {
        throw new Error(`duplicate snapshot channel '${def.id}'`);
      }
      i.snapshotChannels.set(def.id, { build });
    },

    state(id: string, hooks: { save(): Serializable; load(data: Serializable): void }): void {
      requireRegistryKey(id, 'module state');
      if (i.moduleStates.has(id)) {
        throw new Error(`duplicate module state '${id}'`);
      }
      i.moduleStates.set(id, hooks);
    },

    onStart(fn: (ctx: SystemContext) => void): void {
      i.onStartHooks.push({ moduleId, fn });
    },

    probe(id: string, fn: (ctx: SystemContext) => number): void {
      requireRegistryKey(id, 'probe');
      if (i.probes.has(id)) {
        throw new Error(`duplicate probe '${id}'`);
      }
      i.probes.set(id, fn);
    },
  };
}

// Called once after every module has been installed.
export function finalizeBuilder(i: SimInternals): void {
  for (const channel of i.channels.values()) {
    if (channel.kind === 'intent' && channel.readers.length > 1) {
      throw new Error(
        `intent channel allows exactly one reader; got ${channel.readers.join(', ')}`,
      );
    }
  }
}
