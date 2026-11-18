import type { EntityHandle } from '../core/index';
import { handleGeneration, handleId, packHandle } from '../core/index';
import type { ComponentRef, ComponentStorage } from './components';
import { ensureCapacity } from './components';
import type { SimInternals } from './internals';
import { ensureComponent, resolve } from './internals';

// Deferred structural changes (key kernel rule): spawn/despawn/add/remove are
// queued and applied at the end of the tick, after the last phase and before
// snapshot output, in queue order. Storage growth happens only here, so a
// view taken inside a tick can never go stale mid-tick (ADR 0020).

function ensureGenerations(i: SimInternals, id: number): void {
  if (id < i.generations.length) {
    return;
  }
  let capacity = i.generations.length;
  while (capacity <= id) {
    capacity *= 2;
  }
  const next = new Uint32Array(capacity);
  next.set(i.generations);
  i.generations = next;
}

// Zeroing on component attach is required for determinism: a recycled id can
// carry values from its previous life, and a save only records live data, so
// unspecified fields must always start at zero (never 'whatever was there').
function clearFields(storage: ComponentStorage, id: number): void {
  for (const array of Object.values(storage.fields)) {
    array[id] = 0;
  }
}

// DEV-only stale-data poisoning (backs ADR 0040): when a component is
// detached or its entity despawns, overwrite that id's fields — integer
// arrays to the type's max, float arrays to NaN. Attach-time zeroing
// stays, so live data, determinism and save/hash are unaffected; only
// a reader that skips ctx.has sees the poison. Off in production.
function poisonFields(ref: ComponentRef, storage: ComponentStorage, id: number): void {
  for (const [name, type] of Object.entries(ref.fields)) {
    const array = storage.fields[name];
    if (array === undefined) {
      continue;
    }
    switch (type) {
      case 'f64':
      case 'f32':
      case 'handle':
        array[id] = Number.NaN;
        break;
      case 'i32':
        array[id] = 2147483647;
        break;
      case 'u32':
        array[id] = 4294967295;
        break;
      case 'u16':
        array[id] = 65535;
        break;
      case 'u8':
        array[id] = 255;
        break;
    }
  }
}

function writeFieldValues(
  storage: ComponentStorage,
  id: number,
  values: Partial<Record<string, number>>,
): void {
  for (const [field, value] of Object.entries(values)) {
    if (value === undefined) {
      continue;
    }
    const array = storage.fields[field];
    if (array === undefined) {
      throw new Error(`unknown component field '${field}'`);
    }
    array[id] = value;
  }
}

// Spawn allocates the bitecs id immediately so the returned handle is stable;
// components are added only when the queue applies. Bare entities can never
// appear in queries because kernel queries require a positive component.
export function queueSpawn(
  i: SimInternals,
  init: readonly (readonly [ComponentRef, Partial<Record<string, number>>?])[],
  allocateId: () => number,
): EntityHandle {
  const id = allocateId();
  ensureGenerations(i, id);
  i.pendingSpawns.add(id);
  i.structural.push({ kind: 'spawn', id, init });
  return packHandle(id, i.generations[id] ?? 0);
}

export function queueDespawn(i: SimInternals, handle: EntityHandle): void {
  const id = handleId(handle);
  if (i.pendingSpawns.has(id) && (i.generations[id] ?? 0) === handleGeneration(handle)) {
    // Despawning an entity spawned this same tick cancels the spawn; the id
    // is released when the queue applies.
    i.pendingSpawns.delete(id);
    i.cancelledSpawns.add(id);
    i.structural = i.structural.filter((op) => !(op.kind === 'spawn' && op.id === id));
  }
  i.structural.push({ kind: 'despawn', handle });
}

export function applyStructural(
  i: SimInternals,
  deps: {
    removeEntityFromIndex: (id: number) => void;
    addMembership: (id: number, ref: ComponentRef) => void;
    removeMembership: (id: number, ref: ComponentRef) => void;
  },
): void {
  if (i.structural.length === 0 && i.cancelledSpawns.size === 0) {
    return;
  }
  for (const op of i.structural) {
    switch (op.kind) {
      case 'spawn': {
        if (i.cancelledSpawns.has(op.id)) {
          break;
        }
        i.pendingSpawns.delete(op.id);
        for (const [ref, values] of op.init) {
          const storage = ensureComponent(i, ref);
          ensureCapacity(ref, storage, op.id + 1);
          deps.addMembership(op.id, ref);
          // Same zeroing as 'add': a recycled id can carry stale (in
          // DEV, poisoned) fields from its previous life.
          clearFields(storage, op.id);
          if (values !== undefined) {
            writeFieldValues(storage, op.id, values);
          }
        }
        break;
      }
      case 'despawn': {
        const cancelledId = handleId(op.handle);
        if (i.cancelledSpawns.has(cancelledId)) {
          // The id never became live, but its generation must still advance:
          // otherwise the pre-spawn handle would stay valid for the next
          // entity that recycles this id.
          i.generations[cancelledId] = (i.generations[cancelledId] ?? 0) + 1;
          deps.removeEntityFromIndex(cancelledId);
          i.cancelledSpawns.delete(cancelledId);
          break;
        }
        const id = resolve(i, op.handle);
        if (id === null) {
          break;
        }
        for (const ref of i.componentDefs.values()) {
          deps.removeMembership(id, ref);
          if (import.meta.env.DEV) {
            const storage = i.storages.get(ref);
            if (storage !== undefined) {
              poisonFields(ref, storage, id);
            }
          }
        }
        i.generations[id] = (i.generations[id] ?? 0) + 1;
        deps.removeEntityFromIndex(id);
        break;
      }
      case 'add': {
        const id = resolve(i, op.handle);
        if (id === null) {
          break;
        }
        const storage = ensureComponent(i, op.writer.ref);
        ensureCapacity(op.writer.ref, storage, id + 1);
        deps.addMembership(id, op.writer.ref);
        clearFields(storage, id);
        if (op.values !== undefined) {
          writeFieldValues(storage, id, op.values);
        }
        break;
      }
      case 'remove': {
        const id = resolve(i, op.handle);
        if (id === null) {
          break;
        }
        deps.removeMembership(id, op.writer.ref);
        if (import.meta.env.DEV) {
          const storage = i.storages.get(op.writer.ref);
          if (storage !== undefined) {
            poisonFields(op.writer.ref, storage, id);
          }
        }
        break;
      }
    }
  }
  i.structural = [];
  i.queryCache.clear();
}
