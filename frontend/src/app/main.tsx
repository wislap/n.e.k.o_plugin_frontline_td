import { createRoot } from 'react-dom/client';
import '../i18n';
import { createSimClient } from '../client/sim-client';
import { useUiStore } from '../client/ui-store';
import { installKeyboard } from '../input/keyboard';
import { DEFAULT_KEYMAP } from '../input/keymap';
import type { Intent } from '../input/intents';
import { App } from './App';
import { createDevSetup } from './dev-setup';

const worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' });
const client = createSimClient(worker);
client.start(createDevSetup(Date.now() >>> 0));

function dispatch(intent: Intent): void {
  switch (intent.kind) {
    case 'runtime.toggle_pause':
      client.togglePause();
      return;
    case 'runtime.set_speed':
      client.setSpeedIndex(intent.index);
      return;
    case 'dev.toggle_panel':
      useUiStore.getState().toggleDebugPanel();
  }
}

installKeyboard(window, DEFAULT_KEYMAP, dispatch);

const container = document.getElementById('root');
if (container === null) {
  throw new Error('missing #root element');
}

createRoot(container).render(<App client={client} />);
