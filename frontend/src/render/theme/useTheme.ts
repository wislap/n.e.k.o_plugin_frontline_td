// The game's render visual — a single constants object. Kept as a hook
// so consumers re-render if a runtime axis ever returns.
import { useMemo } from 'react';
import { VISUAL, type RenderVisual } from './visual';

export function useRenderTheme(): RenderVisual {
  return useMemo(() => VISUAL, []);
}
