import type { FactionId } from '../core/index';
import type { Controller } from './types';

// A controller whose commands are pushed from outside (e.g. local input
// routed through the runtime). Everything it issues still goes through the
// normal submit path with tick = current + 1.
export interface QueuedController extends Controller {
  push(command: { type: string; payload: unknown }): void;
}

export function createQueuedController(faction: FactionId): QueuedController {
  const queue: { type: string; payload: unknown }[] = [];
  return {
    faction,
    push(command) {
      queue.push(command);
    },
    decide(input) {
      for (const command of queue.splice(0)) {
        input.issue(command.type, command.payload);
      }
    },
  };
}
