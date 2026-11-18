// The single intent dispatcher (client-side contract): keyboard and
// pointer both feed one app-level router. Global intents are handled in
// app/dispatch.ts; canvas-dependent intents (camera raycasts, picks,
// build placement) are forwarded to the handler the canvas registers
// while mounted. UI components dispatch intents through IntentContext
// instead of poking stores directly.
import { createContext, useContext } from 'react';
import type { Intent } from '../input/intents';

export type IntentDispatch = (intent: Intent) => void;

export interface IntentRouter {
  dispatch: IntentDispatch;
  // GameCanvas's input bridge registers its canvas handler here on
  // mount and unregisters (null) on unmount.
  setCanvasHandler(handler: IntentDispatch | null): void;
}

export const IntentContext = createContext<IntentRouter | null>(null);

export function useIntentRouter(): IntentRouter {
  const router = useContext(IntentContext);
  if (router === null) {
    throw new Error('useIntentRouter used outside the IntentContext provider');
  }
  return router;
}
