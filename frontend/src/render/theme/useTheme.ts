// The game's single render visual (merged language). Kept as a hook so
// debug-panel look toggles (step 2) can re-render consumers when changed.
import { VISUAL, type RenderVisual } from './visual';

export function useRenderTheme(): RenderVisual {
  return VISUAL;
}
