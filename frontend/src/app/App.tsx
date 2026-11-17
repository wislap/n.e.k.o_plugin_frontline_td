import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SimClient } from '../client/sim-client';
import { useUiStore } from '../client/ui-store';
import type { ContentDb, ResolvedMap } from '../content/index';
import { DebugPanel } from '../dev/DebugPanel';
import type { PanTracker } from '../input/pan';
import { GameCanvas } from '../render/GameCanvas';
import { Hud } from '../ui/Hud';
import { EndScreen } from '../modes/assault/ui/EndScreen';

export function App({
  client,
  db,
  map,
  panTracker,
  onRestart,
}: {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  panTracker: PanTracker;
  onRestart: () => void;
}) {
  const { t } = useTranslation();
  const panelOpen = useUiStore((state) => state.debugPanelOpen);

  useEffect(() => {
    document.title = t('app.title');
  }, [t]);

  return (
    <main>
      <GameCanvas client={client} db={db} map={map} panTracker={panTracker} />
      <Hud client={client} db={db} modeUi={<EndScreen client={client} onRestart={onRestart} />} />
      {panelOpen && <DebugPanel client={client} />}
    </main>
  );
}
