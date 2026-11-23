// UI skin axis (visual-languages): independent from the scene theme so
// skins and themes can be mixed. 'legacy' keeps the dark glass HUD look;
// 'field' is the Endfield-style light/panel-less skin. Pure data + URL
// parsing only — skin CSS lives under src/ui/styles/.
import type { ThemeId } from './theme';

export const UI_SKIN_IDS = ['legacy', 'field', 'cel', 'glass', 'paper'] as const;
export type UiSkinId = (typeof UI_SKIN_IDS)[number];

// Each theme picks a default skin; the ?ui= param or the debug dropdown
// can still override afterwards.
export function defaultSkinFor(theme: ThemeId): UiSkinId {
  switch (theme) {
    case 'cel':
      return 'cel';
    case 'mist':
      return 'glass';
    case 'diorama':
      return 'paper';
    case 'legacy':
      return 'legacy';
    default:
      return 'field';
  }
}

export function uiSkinFromSearch(search: string): UiSkinId | null {
  const param = new URLSearchParams(search).get('ui');
  return (UI_SKIN_IDS as readonly string[]).includes(param ?? '') ? (param as UiSkinId) : null;
}
