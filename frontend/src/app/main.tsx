import { createRoot } from 'react-dom/client';
import '../i18n';
import { useBuildStore } from '../client/build-store';
import { useCameraStore } from '../client/camera-store';
import { useRuntimeStore } from '../client/runtime-store';
import { useSelectionStore } from '../client/selection-store';
import { createSimClient } from '../client/sim-client';
import { useUiStore } from '../client/ui-store';
import { loadContent } from '../content/index';
import { proto01 } from '../content/frontline_td/maps/proto_01';
import {
  ActivateCommand,
  CancelCommand,
  UpgradeLinksCommand,
} from '../features/construction/protocol';
import { LogisticsNetworkChannel, type LogisticsNetwork } from '../features/logistics/protocol';
import { linkPairs } from '../features/logistics/ui/index';
import { installVisibilityPause } from '../host/visibility';
import { createPanTracker, installPanTracking } from '../input/pan';
import { installKeyboard } from '../input/keyboard';
import { DEFAULT_KEYMAP } from '../input/keymap';
import type { Intent } from '../input/intents';
import { App } from './App';
import { createDevSetup } from './dev-setup';

const worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' });
const client = createSimClient(worker);
const setup = createDevSetup(Date.now() >>> 0);
client.start(setup);

const db = loadContent();
const map = db.maps.byId(proto01.id);
if (map === undefined) {
  throw new Error(`dev map '${proto01.id}' is missing from the content db`);
}

// Initial camera center: the local faction's first start position, else
// the map center.
const start = setup.factions[0]?.start?.units[0];
useCameraStore
  .getState()
  .setCenter(
    start !== undefined ? { x: start.x, y: start.y } : { x: map.width / 2, y: map.height / 2 },
  );

const panTracker = createPanTracker();

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
      return;
    case 'camera.toggle_mode':
      useCameraStore.getState().toggleMode();
      return;
    case 'overlay.toggle_logistics':
      useUiStore.getState().toggleLogisticsOverlay();
      return;
    case 'build.select':
      useBuildStore.getState().select(intent.kindId);
      return;
    case 'build.cancel':
      useBuildStore.getState().cancel();
      return;
    case 'road.toggle': {
      const build = useBuildStore.getState();
      if (build.roadMode) {
        build.cancel();
      } else {
        build.enterRoad();
      }
      return;
    }
    case 'road.confirm': {
      const build = useBuildStore.getState();
      const net = client.snapshots().latest?.channels[LogisticsNetworkChannel.id] as
        LogisticsNetwork | undefined;
      const links = net !== undefined ? linkPairs(net, build.roadSel) : [];
      if (links.length > 0) {
        client.submit({ type: UpgradeLinksCommand.type, payload: { links, level: 1 } });
      }
      build.setRoadSel([]);
      return;
    }
    case 'selection.activate': {
      const selected = [...useSelectionStore.getState().selected];
      if (selected.length > 0) {
        client.submit({ type: ActivateCommand.type, payload: { blueprints: selected } });
      }
      return;
    }
    case 'selection.cancel': {
      const selected = [...useSelectionStore.getState().selected];
      if (selected.length > 0) {
        client.submit({ type: CancelCommand.type, payload: { targets: selected } });
      }
      return;
    }
    default:
  }
}

installKeyboard(window, DEFAULT_KEYMAP, dispatch);
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

createRoot(container).render(<App client={client} db={db} map={map} panTracker={panTracker} />);
