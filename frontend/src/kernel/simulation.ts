import type {
  CommandEnvelope,
  EventVisibility,
  FactionId,
  Serializable,
  Snapshot,
} from '../core/index';
import { COMMAND_REJECTED, hashCanonical, s, toTick, validate } from '../core/index';
import { createBuilder, finalizeBuilder } from './builder';
import { createContext, emitChannel, structuralDeps } from './context';
import type { ChannelState, SimInternals, SystemRecord } from './internals';
import { createInternals, layerArray, resolve } from './internals';
import { PHASES, phaseIndex } from './phases';
import { Faction, InWorld, UnderConstruction } from './contracts';
import { restoreState, serializeState } from './serialize';
import { applyStructural } from './structural';
import type { SimConfig, SimManifest, SimModule, Simulation, SystemContext } from './types';

const COMMAND_PHASE = phaseIndex('command');

function rejectCommand(i: SimInternals, envelope: CommandEnvelope, reason: string): void {
  emitChannel(i, COMMAND_REJECTED.type, 'event', {
    type: envelope.type,
    issuer: envelope.issuer,
    reason,
  });
}

function submitInternal(i: SimInternals, envelope: CommandEnvelope): void {
  const entry = i.commandDefs.get(envelope.type);
  if (entry === undefined) {
    rejectCommand(i, envelope, 'unknown_type');
    return;
  }
  const result = validate(entry.def.payloadSchema as s.AnySchema, envelope.payload);
  if (!result.ok) {
    rejectCommand(i, envelope, 'invalid_payload');
    return;
  }
  if (!(envelope.tick > i.tick)) {
    rejectCommand(i, envelope, 'late');
    return;
  }
  if (!i.factionList.includes(envelope.issuer)) {
    rejectCommand(i, envelope, 'unknown_issuer');
    return;
  }
  i.commandSeq += 1;
  const accepted: CommandEnvelope = {
    tick: envelope.tick,
    issuer: envelope.issuer,
    type: envelope.type,
    payload: result.value,
  };
  i.pendingCommands.push({ envelope: accepted, seq: i.commandSeq });
  i.commandLogEntries.push(accepted);
}

function runWithState(
  i: SimInternals,
  ctx: SystemContext,
  systemId: string,
  phase: number,
  allowedReads: Set<string>,
  allowedEmits: Set<string>,
  fn: () => void,
): void {
  i.runState = { systemId, phase, allowedReads, allowedEmits };
  try {
    fn();
  } finally {
    i.runState = null;
  }
}

function runSystem(i: SimInternals, ctx: SystemContext, system: SystemRecord): void {
  const timer = i.config.timer;
  const started = timer !== undefined ? timer() : 0;
  runWithState(i, ctx, system.id, system.phase, system.reads, system.emits, () => {
    system.run(ctx);
  });
  if (timer !== undefined) {
    const record = i.timings.get(system.id) ?? { count: 0, total: 0 };
    record.count += 1;
    record.total += timer() - started;
    i.timings.set(system.id, record);
  }
}

function applyDueCommands(i: SimInternals, ctx: SystemContext): void {
  const due = i.pendingCommands
    .filter((pending) => pending.envelope.tick === i.tick)
    .sort((a, b) => a.envelope.issuer - b.envelope.issuer || a.seq - b.seq);
  i.pendingCommands = i.pendingCommands.filter((pending) => pending.envelope.tick !== i.tick);
  for (const pending of due) {
    const { envelope } = pending;
    const entry = i.commandDefs.get(envelope.type);
    if (entry === undefined) {
      continue;
    }
    i.commandIssuer = envelope.issuer;
    i.commandType = envelope.type;
    try {
      runWithState(
        i,
        ctx,
        `command:${envelope.type}`,
        COMMAND_PHASE,
        new Set(),
        entry.emits,
        () => {
          entry.handler(ctx, envelope.payload as never, envelope.issuer);
        },
      );
    } finally {
      i.commandIssuer = undefined;
      i.commandType = undefined;
    }
  }
}

function runControllers(i: SimInternals, ctx: SystemContext): void {
  for (const controller of i.controllers) {
    const rng = i.controllerRng.get(controller.faction);
    if (rng === undefined) {
      continue;
    }
    // The snapshot is captured before this tick's pending commands run, so a
    // controller can only act on what was known at the end of the last tick.
    const snapshot = snapshotFor(i, ctx, controller.faction);
    controller.decide({
      tick: toTick(i.tick),
      snapshot,
      rng,
      issue: (type, payload) => {
        submitInternal(i, {
          tick: toTick(i.tick + 1),
          issuer: controller.faction,
          type,
          payload,
        });
      },
    });
  }
}

function runDueEffects(i: SimInternals, ctx: SystemContext, phase: number): void {
  while (
    i.scheduled.length > 0 &&
    (i.scheduled[0]?.dueTick ?? 0) === i.tick &&
    (i.scheduled[0]?.phase ?? 0) === phase
  ) {
    const effect = i.scheduled.shift();
    if (effect === undefined) {
      break;
    }
    const registration = i.effects.get(effect.type);
    if (registration === undefined) {
      continue;
    }
    runWithState(i, ctx, `effect:${effect.type}`, phase, new Set(), registration.emits, () => {
      registration.handler(ctx, effect.params, effect.handles);
    });
  }
}

function trimChannels(i: SimInternals): void {
  for (const channel of i.channels.values()) {
    trimChannel(channel);
  }
}

function trimChannel(channel: ChannelState): void {
  if (channel.readers.length === 0) {
    channel.entries = [];
    return;
  }
  const minCursor = Math.min(...channel.readers.map((reader) => channel.cursors[reader] ?? 0));
  channel.entries = channel.entries.filter((entry) => entry.seq > minCursor);
}

function visibilityAllows(
  i: SimInternals,
  type: string,
  payload: Serializable,
  observer: FactionId,
): boolean {
  const def = i.emitDefs.get(type);
  const visibility: EventVisibility<never> | null =
    def !== undefined && def.kind === 'event' ? def.visibility : null;
  if (visibility === 'all') {
    return true;
  }
  if (visibility === 'issuer') {
    const issuer = (payload as { issuer?: unknown }).issuer;
    return issuer === observer;
  }
  if (typeof visibility === 'function') {
    const predicate = visibility as (payload: Serializable, observer: FactionId) => boolean;
    return predicate(payload, observer);
  }
  return false;
}

function snapshotFor(i: SimInternals, ctx: SystemContext, observer: FactionId): Snapshot {
  const cached = i.snapshotCache.byObserver.get(observer);
  if (cached !== undefined) {
    return cached;
  }
  const channels: Record<string, unknown> = {};
  for (const [id, channel] of i.snapshotChannels) {
    channels[id] = channel.build(ctx, observer);
  }
  const events = i.tickEvents
    .filter(
      (event) =>
        event.tick === i.snapshotCache.tick &&
        visibilityAllows(i, event.type, event.payload, observer),
    )
    .map((event) => ({ type: event.type, payload: event.payload }));
  // Full observer view: every global layer plus the observer's per-faction
  // layers, exposed by reference (read-only by contract). Which keys changed
  // during the tick is reported separately for the runtime's delta transport.
  const layers: Snapshot['layers'] = {};
  for (const ref of i.layerDefs.values()) {
    if (!ref.perFaction) {
      layers[ref.id] = layerArray(i, ref, undefined);
    } else {
      layers[`${ref.id}#${observer}`] = layerArray(i, ref, observer);
    }
  }
  const snapshot: Snapshot = {
    tick: toTick(i.snapshotCache.tick),
    observer,
    channels,
    events,
    layers,
    changedLayers: [...i.lastChangedLayers].sort(),
  };
  i.snapshotCache.byObserver.set(observer, snapshot);
  return snapshot;
}

function stepOnce(i: SimInternals, ctx: SystemContext): void {
  // Keep only events that still feed the cached (last completed) tick's
  // snapshots or the tick about to run.
  i.tickEvents = i.tickEvents.filter((event) => event.tick >= i.snapshotCache.tick);

  for (let phase = 0; phase < PHASES.length; phase++) {
    runDueEffects(i, ctx, phase);
    if (phase === COMMAND_PHASE) {
      applyDueCommands(i, ctx);
      runControllers(i, ctx);
    }
    for (const system of i.systems) {
      if (system.phase !== phase) {
        continue;
      }
      if ((i.tick - system.offset) % system.everyTicks !== 0) {
        continue;
      }
      runSystem(i, ctx, system);
    }
  }

  applyStructural(i, structuralDeps(i));
  trimChannels(i);
  i.lastChangedLayers = i.changedLayers;
  i.changedLayers = new Set();
  i.snapshotCache = { tick: i.tick, byObserver: new Map() };
  i.tick += 1;
}

// Kernel-owned contract components report writer 'kernel' when no
// module claimed them (UnderConstruction is claimed by construction).
const KERNEL_COMPONENTS = new Set([Faction, InWorld, UnderConstruction]);

function describeManifest(i: SimInternals): SimManifest {
  // 'kernel' is appended as a synthetic module so kernel-owned probes
  // (kernel.tick, kernel.entities) appear in the manifest.
  const modules: SimManifest['modules'] = [...i.moduleIds, 'kernel'].map((moduleId) => {
    const systems = i.systems
      .map((system, index) => ({ system, index }))
      .filter(({ system }) => system.moduleId === moduleId)
      .sort((a, b) => a.system.phase - b.system.phase || a.index - b.index)
      .map(({ system }) => ({
        id: system.id,
        phase: PHASES[system.phase] ?? String(system.phase),
        everyTicks: system.everyTicks,
        offset: system.offset,
        reads: [...system.reads].sort(),
        emits: [...system.emits].sort(),
      }));
    const pick = <V>(map: Map<string, V>, owner: (v: V) => string): string[] =>
      [...map]
        .filter(([, v]) => owner(v) === moduleId)
        .map(([k]) => k)
        .sort();
    const pickEmitting = <V extends { moduleId: string; emits: Set<string> }>(
      map: Map<string, V>,
    ): { id: string; emits: string[] }[] =>
      [...map]
        .filter(([, v]) => v.moduleId === moduleId)
        .map(([k, v]) => ({ id: k, emits: [...v.emits].sort() }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      id: moduleId,
      systems,
      commands: pickEmitting(i.commandDefs),
      effects: pickEmitting(i.effects),
      channels: pick(i.snapshotChannels, (v) => v.moduleId),
      states: pick(i.moduleStates, (v) => v.moduleId),
      inspectors: pick(i.inspectors, (v) => v.moduleId),
      probes: pick(i.probes, (v) => v.moduleId),
    };
  });
  const components: SimManifest['components'] = [...i.componentDefs.values()]
    .map((ref) => ({
      id: ref.id,
      fields: { ...ref.fields },
      owner: i.componentOwners.get(ref) ?? null,
      writer: i.writers.get(ref) ?? (KERNEL_COMPONENTS.has(ref) ? 'kernel' : null),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const layers: SimManifest['layers'] = [...i.layerDefs.values()]
    .map((ref) => ({
      id: ref.id,
      type: ref.type,
      perFaction: ref.perFaction,
      writer: i.layerWriters.get(ref) ?? null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const messages: SimManifest['messages'] = [
    ...[...i.emitDefs.values()].map((def) => ({
      type: def.type,
      kind: def.kind,
      ...(def.kind === 'event'
        ? {
            visibility: typeof def.visibility === 'function' ? 'predicate' : def.visibility,
          }
        : {}),
    })),
    ...[...i.commandDefs.keys()].map((type) => ({
      type,
      kind: 'command' as const,
    })),
  ].sort((a, b) =>
    a.type < b.type ? -1 : a.type > b.type ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0,
  );
  return { phases: PHASES, modules, components, layers, messages };
}

function createSimulationFrom(i: SimInternals): Simulation {
  const ctx = createContext(i);
  return {
    get tick() {
      return toTick(i.tick);
    },
    step() {
      stepOnce(i, ctx);
    },
    submit(envelope: CommandEnvelope) {
      submitInternal(i, envelope);
    },
    snapshot(observer: FactionId) {
      return snapshotFor(i, ctx, observer);
    },
    tickEvents(observer: FactionId) {
      return i.tickEvents
        .filter(
          (event) =>
            event.tick === i.snapshotCache.tick &&
            visibilityAllows(i, event.type, event.payload, observer),
        )
        .map((event) => ({ type: event.type, payload: event.payload }));
    },
    describe() {
      return describeManifest(i);
    },
    changedLayers() {
      return [...i.lastChangedLayers].sort();
    },
    commandLog() {
      return i.commandLogEntries.map((entry) => ({ ...entry }));
    },
    timings() {
      return Object.fromEntries([...i.timings].map(([id, record]) => [id, { ...record }]));
    },
    probes() {
      return Object.fromEntries([...i.probes].map(([id, entry]) => [id, entry.fn(ctx)]));
    },
    serialize() {
      return serializeState(i);
    },
    hash() {
      return hashCanonical(serializeState(i));
    },
    inspect(observer, handle) {
      const id = resolve(i, handle);
      if (id === null || !ctx.ownedBy(handle, observer)) {
        return null;
      }
      const sections: Record<string, Serializable> = {};
      i.inInspector = true;
      try {
        for (const [inspectorId, inspector] of i.inspectors) {
          const section = inspector.fn(ctx, id, observer);
          if (section !== null) {
            sections[inspectorId] = section;
          }
        }
      } finally {
        i.inInspector = false;
      }
      return {
        handle,
        modifiers: ctx.modifiersOf(id).map((source) => ({ ...source })),
        sections,
      };
    },
  };
}

function installModules(i: SimInternals, modules: readonly SimModule[]): void {
  for (const module of modules) {
    module.install(createBuilder(i, module.id));
    i.moduleIds.push(module.id);
  }
  finalizeBuilder(i);
  i.probes.set('frontline_td:kernel.tick', { moduleId: 'kernel', fn: (ctx) => ctx.tick });
  i.probes.set('frontline_td:kernel.entities', {
    moduleId: 'kernel',
    fn: () => i.entityIndex.aliveCount,
  });
}

export function createSimulation(config: SimConfig, modules: readonly SimModule[]): Simulation {
  const i = createInternals(config);
  installModules(i, modules);
  // onStart hooks run once here (never on restore), in registration order;
  // their queued structural ops are applied immediately afterwards so the
  // entities exist when tick 0 runs.
  i.inOnStart = true;
  const startCtx = createContext(i);
  for (const hook of i.onStartHooks) {
    hook.fn(startCtx);
  }
  i.inOnStart = false;
  applyStructural(i, structuralDeps(i));
  const sim = createSimulationFrom(i);
  // The initial (pre-tick-0) snapshot represents state before any step.
  i.snapshotCache = { tick: 0, byObserver: new Map() };
  return sim;
}

export function restoreSimulation(
  config: SimConfig,
  modules: readonly SimModule[],
  state: Serializable,
): Simulation {
  const i = createInternals(config);
  installModules(i, modules);
  restoreState(i, state);
  const sim = createSimulationFrom(i);
  // The snapshot must describe the last COMPLETED tick (i.tick - 1) so the
  // first controller decision after restore sees exactly what the
  // uninterrupted run's controllers saw, including that tick's events.
  i.snapshotCache = { tick: i.tick - 1, byObserver: new Map() };
  return sim;
}
