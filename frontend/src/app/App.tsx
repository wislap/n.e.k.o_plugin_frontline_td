import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SimClient } from '../client/sim-client';
import type { ContentDb, ResolvedMap } from '../content/index';
import type { PanTracker } from '../input/pan';
import { readTerrainHeights } from '../features/terrain/render/index';
import { EndScreen } from '../modes/assault/ui/EndScreen';
import { GameCanvas } from '../render/GameCanvas';
import { CANVAS_INTENTS } from './canvas-intents';
import { HUD_PANELS } from './hud-panels';
import { SCENE_LAYERS } from './scene-layers';
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

  useEffect(() => {
    document.title = t('app.title');
  }, [t]);

  return (
    <main>
      <GameCanvas
        client={client}
        db={db}
        map={map}
        layers={SCENE_LAYERS}
        canvasIntents={CANVAS_INTENTS}
        readHeights={readTerrainHeights}
        panTracker={panTracker}
        isHostile={isHostile}
      />
      <Hud
        client={client}
        db={db}
        map={map}
        isHostile={isHostile}
        modeUi={<EndScreen client={client} onRestart={onRestart} />}
        panels={HUD_PANELS}
      />
    </main>
  );
}
