// HUD panel registry (ADR 0062 step 2): features declare HudPanelDef
// lists, app assembles them per slot, Hud renders each slot's sorted
// panels. This module must not import features/*.
import type { ComponentType } from 'react';
import { sortContributions } from '../client/contributions';
import type { SimClient } from '../client/sim-client';
import type { ContentDb, ResolvedMap } from '../content/index';

export type HudSlot =
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'middleLeft'
  | 'middleRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight';

// Shared read-only dependencies every HUD panel may need. map is null
// when no match map is resolved.
export interface HudContext {
  readonly client: SimClient;
  readonly db: ContentDb;
  readonly map: ResolvedMap | null;
  // Hostility from the match relations (observer, faction) → bool.
  readonly isHostile: (observer: number, faction: number) => boolean;
}

export interface HudPanelProps {
  readonly ctx: HudContext;
}

export interface HudPanelDef {
  readonly id: string;
  readonly slot: HudSlot;
  readonly order: number;
  readonly Component: ComponentType<HudPanelProps>;
}

export type HudPanelGroups = Readonly<Record<HudSlot, readonly HudPanelDef[]>>;

// Sort all defs (stable, duplicate-id throw), then group by slot.
// `order` reproduces the pre-registry in-slot DOM order.
export function groupHudPanels(defs: readonly HudPanelDef[]): HudPanelGroups {
  const groups: Record<HudSlot, HudPanelDef[]> = {
    topLeft: [],
    topCenter: [],
    topRight: [],
    middleLeft: [],
    middleRight: [],
    bottomLeft: [],
    bottomCenter: [],
    bottomRight: [],
  };
  for (const def of sortContributions(defs)) {
    groups[def.slot].push(def);
  }
  return groups;
}
