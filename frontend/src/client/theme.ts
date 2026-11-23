// Visual theme ids (visual-languages exploration): 'legacy' is the
// untouched control; 'endfield-day' is the previous-stage control;
// 'field' is language 1 (stylized PBR daylight). Pure data + URL parsing
// only — render-layer parameters live under src/render/theme/.
export const THEME_IDS = ['legacy', 'endfield-day', 'field'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export function themeFromSearch(search: string): ThemeId {
  const param = new URLSearchParams(search).get('theme');
  return (THEME_IDS as readonly string[]).includes(param ?? '') ? (param as ThemeId) : 'legacy';
}
