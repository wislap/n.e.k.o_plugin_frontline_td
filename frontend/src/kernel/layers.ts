import { parseContentId } from '../core/index';
import type { FieldArray } from './components';
import { createFieldArray } from './components';
import type { FieldType } from './components';

export type GridLayerType = Extract<FieldType, 'u8' | 'u16' | 'i32' | 'f64'>;

export interface GridLayerRef {
  readonly kind: 'gridLayer';
  readonly id: string;
  readonly type: GridLayerType;
  readonly perFaction: boolean;
}

export const LAYER_REGISTRY = new Map<string, GridLayerRef>();

export function defineGridLayer(
  id: string,
  type: GridLayerType,
  opts: { perFaction: boolean },
): GridLayerRef {
  if (parseContentId(id) === null) {
    throw new Error(`invalid grid layer id '${id}'`);
  }
  const existing = LAYER_REGISTRY.get(id);
  if (
    existing !== undefined &&
    (existing.type !== type || existing.perFaction !== opts.perFaction)
  ) {
    throw new Error(`grid layer id '${id}' already defined with different type or perFaction`);
  }
  const ref: GridLayerRef = { kind: 'gridLayer', id, type, perFaction: opts.perFaction };
  LAYER_REGISTRY.set(id, ref);
  return ref;
}

export interface GridLayerWriter {
  readonly layer: GridLayerRef;
  readonly ownerId: string;
}

// Layer values: one array for global layers, one per faction otherwise.
export type LayerStorage = { data: FieldArray } | { perFaction: Map<number, FieldArray> };

export function createLayerStorage(
  ref: GridLayerRef,
  size: number,
  factions: readonly number[],
): LayerStorage {
  if (!ref.perFaction) {
    return { data: createFieldArray(ref.type, size) };
  }
  const perFaction = new Map<number, FieldArray>();
  for (const faction of factions) {
    perFaction.set(faction, createFieldArray(ref.type, size));
  }
  return { perFaction };
}
