import { createEntityIndex, createWorld, registerComponent } from 'bitecs';
import type { World } from 'bitecs';
import type {
  CommandDef,
  CommandEnvelope,
  EntityHandle,
  EntityId,
  EventDef,
  FactionId,
  FactionRelation,
  IntentDef,
  RngState,
  Serializable,
  Snapshot,
} from '../core/index';
import { createRngState, handleGeneration, handleId } from '../core/index';
import type { ComponentRef, ComponentStorage, ComponentWriter, FieldArray } from './components';
import { createStorage } from './components';
import type { GridLayerRef, GridLayerWriter, LayerStorage } from './layers';
import { createLayerStorage } from './layers';
import { COMMAND_REJECTED } from '../core/index';
import { Faction, InWorld, UnderConstruction } from './contracts';
import type { CommandHandler, Controller, EffectHandler, SimConfig, SystemContext } from './types';

export const CONTROLLER_STREAM_ID = 'frontline_td:controller';

export interface LogEntry {
  seq: number;
  tick: number;
  phase: number; // -1 when emitted outside a running phase (e.g. submit-time rejections)
  payload: Serializable;
}

export interface ChannelState {
  kind: 'event' | 'intent';
  seq: number;
  entries: LogEntry[];
  cursors: Record<string, number>; // reader system id -> last consumed seq
  readers: string[];
}

export interface ScheduledEffect {
  dueTick: number;
  phase: number;
  seq: number;
  type: string;
  params: Serializable;
  handles: EntityHandle[];
}

export interface PendingCommand {
  envelope: CommandEnvelope;
  seq: number;
}

type StructuralOp =
  | {
      kind: 'spawn';
      id: number;
      init: readonly (readonly [ComponentRef, Partial<Record<string, number>>?])[];
    }
  | { kind: 'despawn'; handle: EntityHandle }
  | {
      kind: 'add';
      writer: ComponentWriter;
      handle: EntityHandle;
      values: Partial<Record<string, number>> | undefined;
    }
  | { kind: 'remove'; writer: ComponentWriter; handle: EntityHandle };

export interface SystemRecord {
  id: string;
  moduleId: string;
  phase: number;
  everyTicks: number;
  offset: number;
  reads: Set<string>;
  emits: Set<string>;
  run: (ctx: SystemContext) => void;
}

type EntityIndex = ReturnType<typeof createEntityIndex>;

export interface SimInternals {
  world: World;
  entityIndex: EntityIndex;
  generations: Uint32Array;
  tick: number;
  config: SimConfig;
  factionList: FactionId[];
  relations: Map<string, FactionRelation>;

  componentDefs: Map<string, ComponentRef>;
  storages: Map<ComponentRef, ComponentStorage>;
  writers: Map<ComponentRef, string>;
  // Owning module per component (ADR 0047): set by ownComponent, implied
  // by claimWriter, 'kernel' for contract components.
  componentOwners: Map<ComponentRef, string>;

  layers: Map<GridLayerRef, LayerStorage>;
  layerDefs: Map<string, GridLayerRef>;
  layerWriters: Map<GridLayerRef, string>;
  changedLayers: Set<string>; // accumulating during the current tick
  lastChangedLayers: Set<string>; // captured at tick end; what snapshots report

  // Installed module ids in install order (for Simulation.describe).
  moduleIds: string[];
  systems: SystemRecord[];
  effects: Map<
    string,
    { phase: number; handler: EffectHandler; moduleId: string; emits: Set<string> }
  >;
  commandDefs: Map<
    string,
    {
      def: CommandDef<unknown>;
      handler: CommandHandler<never>;
      moduleId: string;
      emits: Set<string>;
    }
  >;
  pendingCommands: PendingCommand[];
  commandLogEntries: CommandEnvelope[];
  commandSeq: number;

  commandIssuer: FactionId | undefined;
  commandType: string | undefined;

  channels: Map<string, ChannelState>;
  // Declared message defs by type (from spec.emits/spec.reads and the kernel's
  // own COMMAND_REJECTED); visibility comes from the def, never from data.
  emitDefs: Map<string, EventDef<never> | IntentDef<never>>;
  issuedWriters: Set<ComponentWriter>;
  issuedLayerWriters: Set<GridLayerWriter>;
  tickEvents: { type: string; tick: number; payload: Serializable }[];
  scheduled: ScheduledEffect[];
  scheduleSeq: number;

  rngStreams: Map<string, RngState>;
  controllerRng: Map<number, RngState>;
  controllers: Controller[];

  snapshotChannels: Map<
    string,
    { moduleId: string; build: (ctx: SystemContext, observer: FactionId) => unknown }
  >;
  snapshotCache: { tick: number; byObserver: Map<number, Snapshot> };

  probes: Map<string, { moduleId: string; fn: (ctx: SystemContext) => number }>;
  timings: Map<string, { count: number; total: number }>;
  moduleStates: Map<
    string,
    { moduleId: string; save(): Serializable; load(data: Serializable): void }
  >;

  queryCache: Map<string, Uint32Array>;
  structural: StructuralOp[];
  pendingSpawns: Set<number>;
  cancelledSpawns: Set<number>;

  runState: {
    systemId: string;
    phase: number;
    allowedReads: Set<string>;
    allowedEmits: Set<string>;
  } | null;

  // onStart hooks run once after install in createSimulation only (ADR 0026);
  // inOnStart gates the context methods forbidden inside them.
  onStartHooks: { moduleId: string; fn: (ctx: SystemContext) => void }[];
  inOnStart: boolean;

  // Read-only entity inspectors (Simulation.inspect); inInspector forbids
  // every mutating context method while a callback runs.
  inspectors: Map<
    string,
    {
      moduleId: string;
      fn: (ctx: SystemContext, entity: EntityId, observer: FactionId) => Serializable | null;
    }
  >;
  inInspector: boolean;
}

const DEFAULT_CAPACITY = 1024;

export function createInternals(config: SimConfig): SimInternals {
  const capacity = config.initialEntityCapacity ?? DEFAULT_CAPACITY;
  const entityIndex = createEntityIndex();
  const world = createWorld(entityIndex);

  const factionList = [...config.factions.map((f) => f.id)].sort((a, b) => a - b);
  if (new Set(factionList).size !== factionList.length) {
    throw new Error('SimConfig.factions contains duplicate faction ids');
  }

  const relations = new Map<string, FactionRelation>();
  for (const { a, b, relation } of config.relations) {
    const key = relationKey(a, b);
    relations.set(key, relation);
  }

  const rngStreams = new Map<string, RngState>();
  for (const stream of config.rngStreams) {
    if (rngStreams.has(stream.id)) {
      throw new Error(`duplicate rng stream '${stream.id}'`);
    }
    rngStreams.set(stream.id, createRngState(config.seed, stream.id));
  }

  const controllerRng = new Map<number, RngState>();
  for (const controller of config.controllers) {
    if (!rngStreams.has(CONTROLLER_STREAM_ID)) {
      throw new Error(
        `controllers require the '${CONTROLLER_STREAM_ID}' rng stream to be declared`,
      );
    }
    if (controllerRng.has(controller.faction)) {
      throw new Error(`duplicate controller for faction ${controller.faction}`);
    }
    controllerRng.set(
      controller.faction,
      createRngState(config.seed, `${CONTROLLER_STREAM_ID}#${controller.faction}`),
    );
  }

  const internals: SimInternals = {
    world,
    entityIndex,
    generations: new Uint32Array(capacity + 1),
    tick: 0,
    config,
    factionList,
    relations,
    componentDefs: new Map(),
    storages: new Map(),
    writers: new Map(),
    componentOwners: new Map(),
    layers: new Map(),
    layerDefs: new Map(),
    layerWriters: new Map(),
    changedLayers: new Set(),
    lastChangedLayers: new Set(),
    moduleIds: [],
    systems: [],
    effects: new Map(),
    commandDefs: new Map(),
    pendingCommands: [],
    commandLogEntries: [],
    commandSeq: 0,
    commandIssuer: undefined,
    commandType: undefined,
    channels: new Map(),
    emitDefs: new Map(),
    issuedWriters: new Set(),
    issuedLayerWriters: new Set(),
    tickEvents: [],
    scheduled: [],
    scheduleSeq: 0,
    rngStreams,
    controllerRng,
    controllers: [...config.controllers],
    snapshotChannels: new Map(),
    snapshotCache: { tick: -1, byObserver: new Map() },
    probes: new Map(),
    timings: new Map(),
    moduleStates: new Map(),
    queryCache: new Map(),
    structural: [],
    pendingSpawns: new Set(),
    cancelledSpawns: new Set(),
    runState: null,
    onStartHooks: [],
    inOnStart: false,
    inspectors: new Map(),
    inInspector: false,
  };

  // Kernel contract components always exist, and the kernel's own rejection
  // event is pre-registered so command validation can emit it before any
  // module declares emits.
  for (const ref of [Faction, InWorld, UnderConstruction]) {
    ensureComponent(internals, ref);
    internals.componentOwners.set(ref, 'kernel');
  }
  internals.emitDefs.set(COMMAND_REJECTED.type, COMMAND_REJECTED);
  return internals;
}

function relationKey(a: FactionId, b: FactionId): string {
  return a <= b ? `${a}:${b}` : `${b}:${a}`;
}

export function relationOf(i: SimInternals, a: FactionId, b: FactionId): FactionRelation {
  if (a === b) {
    return 'allied';
  }
  return i.relations.get(relationKey(a, b)) ?? 'neutral';
}

// Registers the ref with bitecs (membership mask + query terms) and lazily
// creates kernel-owned SoA storage. Deterministic: fresh storage is zeroed.
export function ensureComponent(i: SimInternals, ref: ComponentRef): ComponentStorage {
  let storage = i.storages.get(ref);
  if (storage === undefined) {
    registerComponent(i.world, ref);
    i.componentDefs.set(ref.id, ref);
    storage = createStorage(ref, i.generations.length);
    i.storages.set(ref, storage);
  }
  return storage;
}

export function ensureLayer(i: SimInternals, ref: GridLayerRef): LayerStorage {
  let storage = i.layers.get(ref);
  if (storage === undefined) {
    i.layerDefs.set(ref.id, ref);
    storage = createLayerStorage(ref, i.config.grid.width * i.config.grid.height, i.factionList);
    i.layers.set(ref, storage);
  }
  return storage;
}

export function layerArray(
  i: SimInternals,
  ref: GridLayerRef,
  faction: number | undefined,
): FieldArray {
  const storage = ensureLayer(i, ref);
  if ('data' in storage) {
    if (faction !== undefined) {
      throw new Error(`layer '${ref.id}' is not per-faction`);
    }
    return storage.data;
  }
  if (faction === undefined) {
    throw new Error(`layer '${ref.id}' is per-faction; a faction argument is required`);
  }
  const array = storage.perFaction.get(faction);
  if (array === undefined) {
    throw new Error(`layer '${ref.id}' has no storage for faction ${faction}`);
  }
  return array;
}

export function layerKey(ref: GridLayerRef, faction: number | undefined): string {
  return faction === undefined ? ref.id : `${ref.id}#${faction}`;
}

export function isAlive(i: SimInternals, id: number): boolean {
  const index = i.entityIndex;
  const denseIndex = index.sparse[id];
  return (
    denseIndex !== undefined &&
    denseIndex < index.aliveCount &&
    index.dense[denseIndex] === id &&
    !i.cancelledSpawns.has(id)
  );
}

export function resolve(i: SimInternals, handle: EntityHandle): EntityId | null {
  const id = handleId(handle);
  if (!isAlive(i, id)) {
    return null;
  }
  if ((i.generations[id] ?? 0) !== handleGeneration(handle)) {
    return null;
  }
  return id;
}

export function isValid(i: SimInternals, handle: EntityHandle): boolean {
  return resolve(i, handle) !== null;
}
