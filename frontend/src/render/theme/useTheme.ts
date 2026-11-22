// Hook: current render theme from the client UI store.
import { useUiStore } from '../../client/ui-store';
import { RENDER_THEMES, type RenderTheme } from './themes';

export function useRenderTheme(): RenderTheme {
  return RENDER_THEMES[useUiStore((s) => s.theme)];
}
