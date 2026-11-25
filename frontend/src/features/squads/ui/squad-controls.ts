// Squad hotkey helpers (M4): pure logic for digit bindings, right-click
// command routing, and double-press detection. Digit→squad bindings live
// only in the squads channel tags (`player:<digit>`), so they rebuild
// themselves after any load or restart — no separate persistence.
import { readChannel } from '../../../core/index';
import type { Snapshot } from '../../../core/index';
import { MoveCommand } from '../../movement/protocol';
import { SquadsChannel, SquadsOrder, type SquadView } from '../protocol';
import type { SimClient } from '../../../client/sim-client';

const PLAYER_SQUAD_PREFIX = 'player:';
const DOUBLE_PRESS_MS = 400;

export function playerSquadTag(digit: number): string {
  return `${PLAYER_SQUAD_PREFIX}${digit}`;
}

// The bound digit for a squad tag, or null for non-player tags.
export function digitForTag(tag: string | undefined): number | null {
  if (tag === undefined || !tag.startsWith(PLAYER_SQUAD_PREFIX)) {
    return null;
  }
  const digit = Number(tag.slice(PLAYER_SQUAD_PREFIX.length));
  return Number.isInteger(digit) && digit >= 1 && digit <= 9 ? digit : null;
}

// The observer's squad bound to a digit; undefined when none is bound.
export function squadForDigit(
  squads: readonly SquadView[],
  observer: number,
  digit: number,
): SquadView | undefined {
  const tag = playerSquadTag(digit);
  return squads.find((s) => s.faction === observer && s.tag === tag);
}

export interface MoveRouting {
  // Own squads with at least one selected member — ordered as a whole.
  squads: number[];
  // Selected handles belonging to no own squad — plain move candidates.
  plain: number[];
}

// Splits a selection for a right-click order: every squad that has ≥1
// selected member gets the squad order (a plain move would eject the
// member from its squad), everything else gets a plain MoveCommand.
export function routeMoveSelection(
  selected: readonly number[],
  squads: readonly SquadView[],
  observer: number,
): MoveRouting {
  const covered = new Set<number>();
  const squadsToOrder: number[] = [];
  for (const squad of squads) {
    if (squad.faction !== observer || squad.members === undefined) {
      continue;
    }
    const members = new Set(squad.members);
    if (selected.some((h) => members.has(h))) {
      squadsToOrder.push(squad.id);
      for (const h of squad.members) {
        covered.add(h);
      }
    }
  }
  return { squads: squadsToOrder, plain: selected.filter((h) => !covered.has(h)) };
}

export function submitMoveOrder(
  client: SimClient,
  snapshot: Snapshot | null,
  selected: readonly number[],
  x: number,
  y: number,
  guard: boolean,
): void {
  if (selected.length === 0) {
    return;
  }
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const squads = readChannel(snapshot, SquadsChannel)?.squads ?? [];
  const routing = routeMoveSelection(selected, squads, snapshot?.observer ?? -1);
  for (const squad of routing.squads) {
    client.submit({
      type: SquadsOrder.type,
      payload: { squad, kind: guard ? 'guard' : 'advance', x: cellX, y: cellY },
    });
  }
  if (routing.plain.length > 0) {
    client.submit({
      type: MoveCommand.type,
      payload: { units: routing.plain, x: cellX, y: cellY },
    });
  }
}

export interface DigitPress {
  digit: number;
  at: number;
}

// 'select' on a first/different-digit press; 'center' when the same digit
// is pressed again within `windowMs`. The caller stores the returned
// state between presses.
export function digitPress(
  last: DigitPress | null,
  digit: number,
  now: number,
  windowMs: number = DOUBLE_PRESS_MS,
): { action: 'select' | 'center'; last: DigitPress } {
  const action =
    last !== null && last.digit === digit && now - last.at <= windowMs ? 'center' : 'select';
  return { action, last: { digit, at: now } };
}
