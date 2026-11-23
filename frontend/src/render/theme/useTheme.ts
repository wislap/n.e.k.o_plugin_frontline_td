// The game's single render visual (merged language). Kept as a hook so the
// temporary debug-panel palette/atmosphere axes re-render consumers.
import { useMemo } from 'react';
import { useUiStore } from '../../client/ui-store';
import { resolveVisual, type RenderVisual } from './visual';

export function useRenderTheme(): RenderVisual {
  const palette = useUiStore((s) => s.palette);
  const atmosphere = useUiStore((s) => s.atmosphere);
  return useMemo(() => resolveVisual(palette, atmosphere), [palette, atmosphere]);
}
