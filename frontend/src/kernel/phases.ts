// architecture.md §6.5 draft order; changing this order is an ADR-level change.
export const PHASES = [
  'command',
  'director',
  'orders',
  'movement',
  'combat_intent',
  'resolve',
  'cleanup',
  'logistics',
  'construction',
  'capture_fog',
] as const;

export type Phase = (typeof PHASES)[number];

export function phaseIndex(phase: Phase): number {
  const index = (PHASES as readonly string[]).indexOf(phase);
  if (index < 0) {
    throw new Error(`unknown phase '${phase}'`);
  }
  return index;
}
