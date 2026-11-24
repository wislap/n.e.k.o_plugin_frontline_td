// The game's render visual. The temporary ?look= A/B axis is static per
// page load; kept as a hook so consumers re-render if a runtime axis
// ever returns.
import { useMemo } from 'react';
import { lookFromSearch, resolveLook, type RenderVisual } from './visual';

const LOOK = lookFromSearch(typeof location === 'undefined' ? '' : location.search);

export function useRenderTheme(): RenderVisual {
  return useMemo(() => resolveLook(LOOK), []);
}
