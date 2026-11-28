// Canvas intent handler registry (ADR 0062): features declare handlers
// for the screen-space intents that need the camera/raycaster; the shell
// keeps the camera.* cases and delegates the rest to the assembled map.
// This module must not import features/*.
import type { ContentDb, ResolvedMap } from '../content/index';
import type { Intent } from '../input/intents';
import type { Ray } from './picking';
import type { SimClient } from './sim-client';

export interface CanvasInputEnv {
  readonly client: SimClient;
  readonly db: ContentDb;
  readonly map: ResolvedMap;
  readonly heights: ArrayLike<number>;
  rayAt(sx: number, sy: number): Ray;
  groundAt(sx: number, sy: number): { x: number; y: number } | null;
  project(x: number, y: number, elevOffset?: number): { x: number; y: number; inFront: boolean };
}

export interface CanvasIntentHandlerDef<K extends Intent['kind'] = Intent['kind']> {
  readonly id: string;
  readonly kind: K;
  handle(intent: Extract<Intent, { kind: K }>, env: CanvasInputEnv, nowMs: number): void;
}

export function defineCanvasIntentHandler<K extends Intent['kind']>(
  def: CanvasIntentHandlerDef<K>,
): CanvasIntentHandlerDef {
  // The single type-erasing cast: callers register concrete kinds, the
  // map stores them uniformly.
  return def as unknown as CanvasIntentHandlerDef;
}

export function indexCanvasIntentHandlers(
  defs: readonly CanvasIntentHandlerDef[],
): ReadonlyMap<Intent['kind'], CanvasIntentHandlerDef> {
  const map = new Map<Intent['kind'], CanvasIntentHandlerDef>();
  for (const def of defs) {
    if (map.has(def.kind)) {
      throw new Error(`duplicate canvas intent handler for kind ${def.kind}`);
    }
    map.set(def.kind, def);
  }
  return map;
}
