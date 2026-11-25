// Scene layer registry (ADR 0062): features declare SceneLayerDef lists,
// app assembles them, GameCanvas maps the sorted list to components.
// The shell owns only cross-feature plumbing (lighting, background,
// camera, input, selection highlights, post). This module must not
// import features/*.
import type { ComponentType } from 'react';
import type { SimClient } from '../client/sim-client';
import type { ContentDb, ResolvedMap } from '../content/index';
import type { FogUniforms } from './shaders';

// Shared read-only dependencies every scene layer may need. Width and
// height come from map.grid — callers never plumb them separately.
export interface SceneContext {
  readonly client: SimClient;
  readonly db: ContentDb;
  readonly map: ResolvedMap;
  readonly heights: ArrayLike<number>;
  // Hostility from the match relations (observer, faction) → bool.
  readonly isHostile: (observer: number, faction: number) => boolean;
  readonly fog: FogUniforms;
}

export interface SceneLayerProps {
  readonly ctx: SceneContext;
}

export interface SceneLayerDef {
  readonly id: string;
  readonly order: number;
  readonly Component: ComponentType<SceneLayerProps>;
}

// Named order segments (ADR 0062 §4). Transparent-layer draw order
// follows `order`; mount order across the whole sorted list must
// reproduce the pre-registry JSX order so three's id tie-breaks are
// unchanged.
export const SCENE_ORDER = {
  ground: 100,
  entities: 200,
  overlay: 300,
  fog: 400,
} as const;
