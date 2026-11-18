// Static message descriptors (pure data + types). Features reference these
// from their protocol.ts; client code may import them without pulling the
// kernel into its bundle.
import { parseContentId } from './content-id';
import type { FactionId } from './faction';
import type { EntityHandle } from './handle';
import type { Schema } from './schema';
import type { Tick } from './time';

type SerializableTypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

// JSON-like data plus TypedArrays. No functions, no undefined members, no
// class instances, no Maps. Events are further restricted to JSON-like
// payloads (no TypedArrays) by convention.
export type Serializable =
  | null
  | boolean
  | number
  | string
  | Serializable[]
  | { [key: string]: Serializable }
  | SerializableTypedArray;

export interface CommandDef<P> {
  readonly kind: 'command';
  readonly type: string;
  readonly payloadSchema: Schema<P>;
}

export type EventVisibility<P extends Serializable> =
  'all' | 'issuer' | ((payload: P, observer: FactionId) => boolean);

export interface EventDef<P extends Serializable> {
  readonly kind: 'event';
  readonly type: string;
  readonly visibility: EventVisibility<P>;
}

// Intents are like events but always invisible to snapshots and allow
// exactly one reader.
export interface IntentDef<P extends Serializable> {
  readonly kind: 'intent';
  readonly type: string;
  // Phantom marker keeps P in the structural type so IntentDef<A> and
  // IntentDef<B> stay distinct at call sites.
  readonly phantom?: (payload: P) => void;
}

export interface SnapshotChannelDef<T> {
  readonly kind: 'snapshotChannel';
  readonly id: string;
  readonly phantom?: (value: T) => void;
}

function requireValidId(id: string): void {
  if (parseContentId(id) === null) {
    throw new Error(`invalid message id '${id}'`);
  }
}

export function defineCommand<P>(type: string, payload: Schema<P>): CommandDef<P> {
  requireValidId(type);
  return { kind: 'command', type, payloadSchema: payload };
}

export function defineEvent<P extends Serializable>(
  type: string,
  visibility: EventVisibility<P>,
): EventDef<P> {
  requireValidId(type);
  return { kind: 'event', type, visibility };
}

export function defineIntent<P extends Serializable>(type: string): IntentDef<P> {
  requireValidId(type);
  return { kind: 'intent', type };
}

export function defineSnapshotChannel<T>(id: string): SnapshotChannelDef<T> {
  requireValidId(id);
  return { kind: 'snapshotChannel', id };
}

export interface CommandEnvelope {
  tick: Tick;
  issuer: FactionId;
  type: string;
  payload: unknown;
}

export interface SnapshotEventEntry {
  type: string;
  payload: Serializable;
}

export interface Snapshot {
  tick: Tick;
  observer: FactionId;
  channels: Record<string, unknown>;
  events: SnapshotEventEntry[];
  // Read-only views into live layer storage, keyed 'layer.id' for global
  // layers and 'layer.id#<faction>' for the observer's per-faction layers.
  // Never write through these arrays.
  layers: Record<string, SerializableTypedArray>;
  // Layer keys written during the snapshot's tick (subset of `layers` keys).
  changedLayers: string[];
}

export type CommandRejectedPayload = {
  type: string;
  issuer: FactionId;
  reason: string;
};

// Read-only per-entity explanation produced by Simulation.inspect: the
// entity's active modifiers plus every non-null module inspector section.
export interface Inspection {
  handle: EntityHandle;
  modifiers: {
    stat: string;
    source: string;
    op: 'add' | 'mul_bp';
    value: number;
  }[];
  sections: Record<string, Serializable>;
}

export const COMMAND_REJECTED: EventDef<CommandRejectedPayload> = defineEvent(
  'frontline_td:kernel.command_rejected',
  'issuer',
);
