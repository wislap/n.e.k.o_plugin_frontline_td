// Visual theme ids (visual-slice exploration): 'legacy' is the untouched
// control; the other three are co-developed alternates switched at runtime.
// Pure data + URL parsing only — render-layer parameters live under
// src/render/theme/.
export const THEME_IDS = [
  'legacy',
  'endfield',
  'endfield-day',
  'shapez',
  'mindustry',
  'mindustry-pixel',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export function themeFromSearch(search: string): ThemeId {
  const param = new URLSearchParams(search).get('theme');
  return (THEME_IDS as readonly string[]).includes(param ?? '') ? (param as ThemeId) : 'legacy';
}
