import type { Brand } from './brand';

export type FactionId = Brand<number, 'FactionId'>;
export type FactionRelation = 'hostile' | 'allied' | 'neutral';

export const MAX_FACTION_ID = 65535;

export function toFactionId(n: number): FactionId {
  if (!Number.isInteger(n) || n < 0 || n > MAX_FACTION_ID) {
    throw new RangeError(`faction id must be an integer in 0..${MAX_FACTION_ID}, got ${n}`);
  }
  return n as FactionId;
}
