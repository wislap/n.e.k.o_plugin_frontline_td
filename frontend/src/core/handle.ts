import type { Brand } from './brand';

export type EntityId = Brand<number, 'EntityId'>;
export type EntityHandle = Brand<number, 'EntityHandle'>;

// Handle = generation * ID_SPACE + id. 2^32 written as a literal because the
// '**' operator is forbidden in the simulation layer (ADR 0006 purity zones).
const ID_SPACE = 4294967296;
export const MAX_GENERATION = 2097151; // 2^21 - 1
export const NULL_HANDLE = 0 as EntityHandle;

export function packHandle(id: number, generation: number): EntityHandle {
  if (!Number.isSafeInteger(id) || id < 1 || id >= ID_SPACE) {
    throw new RangeError(`entity id must be an integer in 1..${ID_SPACE - 1}, got ${id}`);
  }
  if (!Number.isSafeInteger(generation) || generation < 0 || generation > MAX_GENERATION) {
    throw new RangeError(
      `generation must be an integer in 0..${MAX_GENERATION}, got ${generation}`,
    );
  }
  return (generation * ID_SPACE + id) as EntityHandle;
}

export function handleId(handle: EntityHandle): EntityId {
  return (handle % ID_SPACE) as EntityId;
}

export function handleGeneration(handle: EntityHandle): number {
  return Math.floor(handle / ID_SPACE);
}
