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
  SnapshotChannelDef,
  Tick,
} from '../core/index';
import type {
  ComponentRef,
  ComponentWriter,
  FieldArray,
  FieldMap,
  ReadonlyNumberArray,
} from './components';
import type { GridLayerRef, GridLayerWriter } from './layers';
import type { Phase } from './phases';

export type ReadView<F extends FieldMap> = {
  readonly [K in keyof F]: ReadonlyNumberArray;
};
export type WriteView<F extends FieldMap> = { [K in keyof F]: FieldArray };
export type FieldValues<F extends FieldMap> = { [K in keyof F]: number };
export type SpawnInit = readonly (readonly [ComponentRef, Partial<FieldValues<FieldMap>>?])[];

export type AnyChannelDef = EventDef<never> | IntentDef<never>;
export type ReadonlyUint32Array = Readonly<Uint32Array>;

// The context a system / effect / command handler / snapshot builder sees.
export interface SystemContext {
  readonly tick: Tick;
  read<F extends FieldMap>(ref: ComponentRef<F>): ReadView<F>;
  read<P extends Serializable>(def: EventDef<P> | IntentDef<P>): P[];
  write<F extends FieldMap>(writer: ComponentWriter<F>): WriteView<F>;
  has<F extends FieldMap>(ref: ComponentRef<F>, id: EntityId): boolean;
  resolve(handle: EntityHandle): EntityId | null;
  // Inverse of resolve: current handle for a live id, null for a dead one.
  handleOf(id: EntityId): EntityHandle | null;
  isValid(handle: EntityHandle): boolean;
  spawn(init: SpawnInit): EntityHandle;
  despawn(handle: EntityHandle): void;
  addComponent<F extends FieldMap>(
    writer: ComponentWriter<F>,
    handle: EntityHandle,
    values?: Partial<FieldValues<F>>,
  ): void;
  removeComponent<F extends FieldMap>(writer: ComponentWriter<F>, handle: EntityHandle): void;
  query(include: readonly ComponentRef[], exclude?: readonly ComponentRef[]): ReadonlyUint32Array;
  emit<P extends Serializable>(def: EventDef<P> | IntentDef<P>, payload: P): void;
  schedule(
    type: string,
    delayTicks: number,
    params: Serializable,
    handles: readonly EntityHandle[],
  ): void;
  rng(id: string): RngState;
  factions(): readonly FactionId[];
  relation(a: FactionId, b: FactionId): FactionRelation;
  isHostile(a: FactionId, b: FactionId): boolean;
  layer(ref: GridLayerRef, faction?: FactionId): ReadonlyNumberArray;
  writeLayer(writer: GridLayerWriter, faction?: FactionId): FieldArray;
  reject(reason: string): void;
  ownedBy(handle: EntityHandle, faction: FactionId): boolean;
}

export interface SystemSpec {
  id: string;
  phase: Phase;
  everyTicks?: number;
  offset?: number;
  reads?: readonly AnyChannelDef[];
  emits?: readonly AnyChannelDef[];
  run: (ctx: SystemContext) => void;
}

export type EffectHandler = (
  ctx: SystemContext,
  params: Serializable,
  handles: readonly EntityHandle[],
) => void;

export type CommandHandler<P> = (ctx: SystemContext, payload: P, issuer: FactionId) => void;

export interface Controller {
  readonly faction: FactionId;
  decide(input: {
    tick: Tick;
    snapshot: Snapshot;
    rng: RngState;
    issue(type: string, payload: unknown): void;
  }): void;
}

export interface SimBuilder {
  claimWriter<F extends FieldMap>(ref: ComponentRef<F>): ComponentWriter<F>;
  claimLayerWriter(ref: GridLayerRef): GridLayerWriter;
  system(spec: SystemSpec): void;
  effect(
    type: string,
    phase: Phase,
    handler: EffectHandler,
    opts?: { emits?: readonly AnyChannelDef[] },
  ): void;
  command<P>(
    def: CommandDef<P>,
    handler: CommandHandler<P>,
    opts?: { emits?: readonly AnyChannelDef[] },
  ): void;
  snapshotChannel<T>(
    def: SnapshotChannelDef<T>,
    build: (ctx: SystemContext, observer: FactionId) => T,
  ): void;
  state(id: string, hooks: { save(): Serializable; load(data: Serializable): void }): void;
  probe(id: string, fn: (ctx: SystemContext) => number): void;
  // Runs once after all modules are installed, in createSimulation only (not
  // on restore). Queued structural ops are applied after the last hook, so
  // onStart entities exist before tick 0. emit/read/schedule/reject throw
  // inside a hook. Hooks run in registration order.
  onStart(fn: (ctx: SystemContext) => void): void;
}

export interface SimModule {
  id: string;
  install(builder: SimBuilder): void;
}

export interface SimConfig {
  seed: number;
  factions: readonly { id: FactionId }[];
  relations: readonly { a: FactionId; b: FactionId; relation: FactionRelation }[];
  grid: { width: number; height: number };
  rngStreams: readonly { id: string; purpose: string }[];
  controllers: readonly Controller[];
  timer?: () => number;
  initialEntityCapacity?: number;
}

export interface Simulation {
  readonly tick: Tick;
  step(): void;
  submit(envelope: CommandEnvelope): void;
  snapshot(observer: FactionId): Snapshot;
  // Layer keys written during the last completed tick, without building a
  // snapshot (used by the runtime's delta transport).
  changedLayers(): readonly string[];
  commandLog(): CommandEnvelope[];
  timings(): Record<string, { count: number; total: number }>;
  probes(): Record<string, number>;
  serialize(): Serializable;
  hash(): string;
}
