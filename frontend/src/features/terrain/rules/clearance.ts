// Two-tier clearance constants and footprint-anchor math (ADR 0052).
// Pure deterministic helpers shared by terrain, pathing, and movement.

export const CLEARANCE_STANDARD = 0;
export const CLEARANCE_HEAVY = 1;
export const CLEARANCE_TIERS = 2;
export const STANDARD_RADIUS_MAX = 0.45;

export type ClearanceTier = 0 | 1;

export function clearanceTierForRadius(radius: number): ClearanceTier {
  return radius > STANDARD_RADIUS_MAX ? CLEARANCE_HEAVY : CLEARANCE_STANDARD;
}

export function clearanceFootprintSize(tier: ClearanceTier): 1 | 2 {
  return tier === CLEARANCE_HEAVY ? 2 : 1;
}

export function clearanceAnchorCell(worldCoord: number, tier: ClearanceTier): number {
  return tier === CLEARANCE_HEAVY ? Math.floor(worldCoord - 0.5) : Math.floor(worldCoord);
}

export function clearanceAnchorCenter(anchorCell: number, tier: ClearanceTier): number {
  return tier === CLEARANCE_HEAVY ? anchorCell + 1 : anchorCell + 0.5;
}
