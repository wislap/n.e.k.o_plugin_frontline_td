import { parseContentId } from '../core/index';

export type FieldType = 'f64' | 'f32' | 'i32' | 'u32' | 'u16' | 'u8' | 'handle';
export type FieldMap = Record<string, FieldType>;

export type FieldArray =
  Float64Array | Float32Array | Int32Array | Uint32Array | Uint16Array | Uint8Array;

export type ReadonlyNumberArray = {
  readonly [i: number]: number;
  readonly length: number;
};

export interface ComponentRef<F extends FieldMap = FieldMap> {
  readonly id: string;
  readonly fields: F;
}

// Static component registry: saves restore components by id even before the
// ref was touched in the new process (ADR 0022 ids are stable).
export const COMPONENT_REGISTRY = new Map<string, ComponentRef>();

// Components are static, module-level constants. The ref doubles as the
// bitecs component term used for membership masks and queries; field values
// live in kernel-owned SoA storage, never inside bitecs.
export function defineComponent<F extends FieldMap>(id: string, fields: F): ComponentRef<F> {
  if (parseContentId(id) === null) {
    throw new Error(`invalid component id '${id}'`);
  }
  const existing = COMPONENT_REGISTRY.get(id);
  if (existing !== undefined && JSON.stringify(existing.fields) !== JSON.stringify(fields)) {
    throw new Error(`component id '${id}' already defined with different fields`);
  }
  const ref: ComponentRef<F> = { id, fields };
  COMPONENT_REGISTRY.set(id, ref);
  return ref;
}

// A writer token: only the module that claimed the component can write or
// structurally change it. Created by SimBuilder.claimWriter.
export interface ComponentWriter<F extends FieldMap = FieldMap> {
  readonly ref: ComponentRef<F>;
  readonly ownerId: string;
}

export function createFieldArray(type: FieldType, capacity: number): FieldArray {
  switch (type) {
    case 'f64':
    case 'handle':
      return new Float64Array(capacity);
    case 'f32':
      return new Float32Array(capacity);
    case 'i32':
      return new Int32Array(capacity);
    case 'u32':
      return new Uint32Array(capacity);
    case 'u16':
      return new Uint16Array(capacity);
    case 'u8':
      return new Uint8Array(capacity);
  }
}

export interface ComponentStorage {
  capacity: number;
  fields: Record<string, FieldArray>;
}

export function createStorage(ref: ComponentRef, capacity: number): ComponentStorage {
  const fields: Record<string, FieldArray> = {};
  for (const [name, type] of Object.entries(ref.fields)) {
    fields[name] = createFieldArray(type, capacity);
  }
  return { capacity, fields };
}

// Storage only ever grows during the structural-apply phase, so a view taken
// inside a tick can never go stale mid-tick (ADR 0020).
export function ensureCapacity(ref: ComponentRef, storage: ComponentStorage, needed: number): void {
  if (needed <= storage.capacity) {
    return;
  }
  let capacity = storage.capacity === 0 ? 1 : storage.capacity;
  while (capacity < needed) {
    capacity *= 2;
  }
  for (const [name, type] of Object.entries(ref.fields)) {
    const next = createFieldArray(type, capacity);
    next.set(storage.fields[name] ?? createFieldArray(type, 0));
    storage.fields[name] = next;
  }
  storage.capacity = capacity;
}
