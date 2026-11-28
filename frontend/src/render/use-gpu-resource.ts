// Shared GPU resource lifecycle helpers: a disposal-owning hook for
// useMemo'd resources, a disposer for single/composite values, and a
// useFrame rebuild gate for source-identity watches.

import { useEffect } from 'react';

interface GpuResource {
  dispose(): void;
}

type GpuResourceInput =
  GpuResource | readonly GpuResource[] | Readonly<Record<string, GpuResource>> | null | undefined;

function disposeGpu(resource: GpuResourceInput): void {
  if (resource === null || resource === undefined) {
    return;
  }
  if (Array.isArray(resource)) {
    for (const r of resource as readonly GpuResource[]) {
      r.dispose();
    }
    return;
  }
  if (typeof resource === 'object' && !('dispose' in resource)) {
    const record = resource as Readonly<Record<string, GpuResource>>;
    for (const r of Object.values(record)) {
      r.dispose();
    }
    return;
  }
  (resource as GpuResource).dispose();
}

/**
 * Owns disposal of `resource`: disposes the previous value whenever the
 * value changes (useMemo rebuilds it) and once more on unmount. Creation
 * stays in a call-site useMemo because react-compiler requires literal
 * hook dependency lists.
 */
export function useGpuResource(resource: GpuResourceInput): void {
  useEffect(() => {
    return () => {
      disposeGpu(resource);
    };
  }, [resource]);
}

export interface BindableGeometry {
  dispose(): void;
  userData: Record<string, unknown>;
}

/**
 * Replaces `object.geometry` with `geometry`, disposing the previous geometry
 * unless it is marked `userData.shared === true` (e.g., silhouette assets).
 * Disposes R3F's default placeholder BufferGeometry on first imperative bind.
 */
export function bindGeometry<G extends BindableGeometry>(
  object: { geometry: G },
  geometry: G,
): void {
  if (object.geometry !== geometry) {
    if (object.geometry.userData['shared'] !== true) {
      object.geometry.dispose();
    }
    object.geometry = geometry;
  }
}

/**
 * useFrame rebuild gate: records `source` in `ref` and returns true when it
 * differs from the previously recorded identity. Pair with an early return
 * so the rebuild body only runs when the source buffer changed.
 */
export function markBuilt<T>(ref: { current: T }, source: T): boolean {
  if (ref.current === source) {
    return false;
  }
  ref.current = source;
  return true;
}
