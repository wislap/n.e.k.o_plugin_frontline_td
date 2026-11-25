// Minimap contribution types (ADR 0062 step 4a): features declare
// per-cell raster passes (terrain base, roads, fog) and overlay marks
// (structures, memories, units, threats, capture overlays); app sorts
// them with sortContributions and hands them to createMinimapPanel.
// This module must not import features/*.
import type { ContentDb, ResolvedMap } from '../../content/index';
import type { Snapshot } from '../../core/index';

interface MinimapInput {
  readonly db: ContentDb;
  readonly map: ResolvedMap;
  readonly snapshot: Snapshot | null;
  readonly isHostile: (observer: number, faction: number) => boolean;
  readonly selected: ReadonlySet<number>;
  readonly nowMs: number;
}

// Per-cell raster passes over the cached terrain image, applied in
// order on every recomposite.
export interface MinimapRasterDef {
  readonly id: string;
  readonly order: number;
  // Identities read; recomposite when any changes.
  keys(snapshot: Snapshot | null): readonly unknown[];
  apply(
    rgba: Uint8ClampedArray,
    input: Omit<MinimapInput, 'selected' | 'isHostile' | 'nowMs'>,
  ): void;
}

export type MinimapMark =
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: string;
      stroke?: string;
      lineWidth?: number;
      grow?: number;
      alpha?: number;
    }
  | {
      kind: 'ring';
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      lineWidth: number;
      padPx: number;
    }
  | {
      kind: 'path';
      points: readonly number[];
      color: string;
      lineWidth: number;
      dash?: readonly number[];
    }
  | { kind: 'diamond'; x: number; y: number; radiusPx: number; color: string; lineWidth: number }
  | { kind: 'dot'; x: number; y: number; sizePx: number; color: string };

export interface MinimapMarkDef {
  readonly id: string;
  readonly order: number;
  collect(input: MinimapInput): readonly MinimapMark[];
}

// Shared faction→disposition resolver for mark collectors.
export function resolveDisposition(
  observer: number,
  faction: number,
  isHostile: (observer: number, faction: number) => boolean,
): 'own' | 'hostile' | 'ally' {
  if (faction === observer) {
    return 'own';
  }
  return isHostile(observer, faction) ? 'hostile' : 'ally';
}
