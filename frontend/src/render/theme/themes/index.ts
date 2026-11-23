// Theme registry (visual-languages): one file per theme, keyed by
// ThemeId. Control = 'legacy' / 'endfield-day'; language 1 = 'field'.
import type { ThemeId } from '../../../client/theme';
import { CEL_THEME } from './cel';
import { DIORAMA_THEME } from './diorama';
import { ENDFIELD_DAY_THEME } from './endfield-day';
import { FIELD_THEME } from './field';
import { LEGACY_THEME } from './legacy';
import { MIST_THEME } from './mist';
import type { RenderTheme } from './types';

export const RENDER_THEMES: Record<ThemeId, RenderTheme> = {
  legacy: LEGACY_THEME,
  'endfield-day': ENDFIELD_DAY_THEME,
  field: FIELD_THEME,
  cel: CEL_THEME,
  mist: MIST_THEME,
  diorama: DIORAMA_THEME,
};

export type { RenderTheme };
export * from './types';
