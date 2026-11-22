import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SimClient } from '../client/sim-client';
import { useUiStore } from '../client/ui-store';
import type { ContentDb, ResolvedMap } from '../content/index';
import { DebugPanel } from '../dev/DebugPanel';
import type { PanTracker } from '../input/pan';
import { EndScreen } from '../modes/assault/ui/EndScreen';
import { GameCanvas } from '../render/GameCanvas';
import { Hud } from '../ui/Hud';

export function App({
  client,
  db,
  map,
  panTracker,
  onRestart,
  isHostile,
}: {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  panTracker: PanTracker;
  onRestart: () => void;
  // Hostility from the match relations (observer, faction) → bool.
  isHostile: (observer: number, faction: number) => boolean;
}) {
  const { t } = useTranslation();
  const panelOpen = useUiStore((state) => state.debugPanelOpen);
  const theme = useUiStore((state) => state.theme);

  useEffect(() => {
    document.title = t('app.title');
  }, [t]);

  // Visual theme on the root node so later stages can skin the HUD via
  // [data-theme] CSS variables.
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  return (
    <main>
      <GameCanvas client={client} db={db} map={map} panTracker={panTracker} isHostile={isHostile} />
      <Hud
        client={client}
        db={db}
        map={map}
        isHostile={isHostile}
        modeUi={<EndScreen client={client} onRestart={onRestart} />}
        debugUi={panelOpen ? <DebugPanel client={client} /> : null}
      />
    </main>
  );
}
