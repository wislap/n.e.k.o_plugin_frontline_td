import { createRoot } from 'react-dom/client';
import '../i18n';
import '../ui/styles/tokens.css';
import '../ui/styles/base.css';
import { useCameraStore } from '../client/camera-store';
import { getCapture } from '../client/capture-mode';
import { makeIsHostile } from '../client/hostility';
import { IntentContext } from '../client/intent';
import { useInteractionStore } from '../client/interaction-store';
import { useRuntimeStore } from '../client/runtime-store';
import { resetClientState } from '../client/session';
import { createSimClient } from '../client/sim-client';
import { loadContent, type ResolvedMap } from '../content/index';
import { installVisibilityPause } from '../host/visibility';
import { installKeyboard } from '../input/keyboard';
import { createPanTracker, installPanTracking } from '../input/pan';
import { defaultSetup } from '../modes/assault/index';
import type { MatchSetup } from '../protocol/index';
import { App } from './App';
import { createIntentRouter } from './dispatch';

const worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' });
const client = createSimClient(worker);
const capture = getCapture();
const setup = defaultSetup(capture?.seed ?? Date.now() >>> 0);
client.start(setup);
// Hostility for fog-aware client code (ghost previews, exclusion
// circles) comes from the same relations the sim resolves — the restart
// path rebuilds the setup but relations stay constant per mode.
const isHostile = makeIsHostile(setup.relations);

const db = loadContent();
const map: ResolvedMap = (() => {
  const mapId = setup.mapId ?? '';
  const found = db.maps.byId(mapId);
  if (found === undefined) {
    throw new Error(`map '${mapId}' is missing from the content db`);
  }
  return found;
})();

// Camera starts on the local faction's first start position, else the
// map centre. Restart re-centres the same way on the new setup.
function centerOnStart(next: MatchSetup): void {
  const start = next.factions[0]?.start?.units[0];
  useCameraStore
    .getState()
    .setCenter(
      start !== undefined ? { x: start.x, y: start.y } : { x: map.width / 2, y: map.height / 2 },
    );
}
centerOnStart(setup);

// Capture presets apply before the first frame so the camera pose is
// exact: CameraRig initialises its smoothed state and last-mode ref from
// the store, so no transition ever runs.
if (capture !== null) {
  const cam = useCameraStore.getState();
  if (capture.cameraMode === 'tactical') {
    cam.setMode('tactical', false);
  }
  if (capture.center === 'map') {
    cam.setCenter({ x: map.width / 2, y: map.height / 2 });
  }
  if (capture.zoom !== null) {
    cam.setZoom(capture.zoom);
  }
  if (capture.interactionMode !== 'command') {
    useInteractionStore.getState().setMode(capture.interactionMode);
  }
}

const panTracker = createPanTracker();
const router = createIntentRouter({ client, db });

installKeyboard(window, () => useInteractionStore.getState().mode, router.dispatch);
installPanTracking(window, panTracker);
// Auto-pause when the tab hides; never auto-resumes (M3 E5).
installVisibilityPause(document, () => {
  if (useRuntimeStore.getState().stats?.paused === false) {
    client.togglePause();
  }
});

const container = document.getElementById('root');
if (container === null) {
  throw new Error('missing #root element');
}
const root = createRoot(container);

// Every restart bumps matchKey: the whole React subtree remounts, so
// component-local per-match state (EndScreen result, layer caches like
// builtFor, beam/link smoothing) starts fresh alongside the stores.
let matchKey = 0;
const restart = (): void => {
  const next = defaultSetup(Date.now() >>> 0);
  resetClientState();
  router.resetLastDigit();
  client.restart(next);
  centerOnStart(next);
  matchKey += 1;
  render();
};
function render(): void {
  root.render(
    <IntentContext.Provider value={router}>
      <App
        key={matchKey}
        client={client}
        db={db}
        map={map}
        panTracker={panTracker}
        onRestart={restart}
        isHostile={isHostile}
      />
    </IntentContext.Provider>,
  );
}
render();
