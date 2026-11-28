import { CANONICAL_DANGER_RED } from '../client/palette';

// Faction colours: the observer's own faction always gets LOCAL_COLOR;
// every other faction is coloured from a palette that never contains it.
// Before the first snapshot (localFaction null) everyone uses the palette.
export const LOCAL_COLOR = '#4fa3ff';
const FACTION_COLORS = [CANONICAL_DANGER_RED, '#ffd24f', '#9dff5a', '#c88bff'];

export function factionColorHex(faction: number, localFaction: number | null): string {
  if (localFaction !== null && faction === localFaction) {
    return LOCAL_COLOR;
  }
  return FACTION_COLORS[faction % FACTION_COLORS.length] ?? '#ffffff';
}
