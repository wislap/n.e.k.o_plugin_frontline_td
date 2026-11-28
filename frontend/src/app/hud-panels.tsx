// HUD panel assembly (ADR 0062): app is the only place shell and
// feature panel lists are combined. groupHudPanels reproduces the
// pre-registry in-slot DOM order.
import { useSelectionStore } from '../client/selection-store';
import { useUiStore } from '../client/ui-store';
import type { ContentDb } from '../content/index';
import { DebugPanel } from '../dev/DebugPanel';
import { renderStructureThumbnails } from '../features/construction/render/index';
import {
  createConstructionHudPanels,
  type ThumbnailRenderer,
} from '../features/construction/ui/index';
import { logisticsHudPanels } from '../features/logistics/ui/index';
import { squadsHudPanels, submitMoveOrder } from '../features/squads/ui/index';
import { groupHudPanels, type HudPanelProps } from '../ui/hud-panels';
import { createInspectorPanel } from '../ui/inspector/index';
import { createMinimapPanel } from '../ui/minimap/index';
import { SHELL_HUD_PANELS } from '../ui/shell-panels';
import { INSPECTOR_SUBJECTS } from './inspector-subjects';
import { MINIMAP_MARKS, MINIMAP_RASTERS } from './minimap-contributions';
import { SCENE_LAYERS } from './scene-layers';

const SCENE_LAYER_IDS = SCENE_LAYERS.map((l) => l.id);

const thumbnailCache = new WeakMap<ContentDb, ReadonlyMap<string, string>>();
const getStructureThumbnails: ThumbnailRenderer = (db) => {
  const cached = thumbnailCache.get(db);
  if (cached !== undefined) {
    return cached;
  }
  const rendered = renderStructureThumbnails(db);
  thumbnailCache.set(db, rendered);
  return rendered;
};

// Dev debug panel: registered like every other panel; it reads the
// store flag itself and renders nothing while closed.
function DebugHudPanel({ ctx }: HudPanelProps) {
  const open = useUiStore((s) => s.debugPanelOpen);
  if (!open) {
    return null;
  }
  return <DebugPanel client={ctx.client} sceneLayerIds={SCENE_LAYER_IDS} />;
}

export const HUD_PANELS = groupHudPanels([
  ...SHELL_HUD_PANELS,
  ...createConstructionHudPanels({ renderThumbnails: getStructureThumbnails }),
  ...logisticsHudPanels,
  ...squadsHudPanels,
  {
    id: 'shell.minimap',
    slot: 'topLeft',
    order: 20,
    Component: createMinimapPanel({
      rasters: MINIMAP_RASTERS,
      marks: MINIMAP_MARKS,
      onMoveOrder: (ctx, x, y, guard) => {
        submitMoveOrder(
          ctx.client,
          ctx.client.snapshots().latest,
          [...useSelectionStore.getState().selected],
          x,
          y,
          guard,
        );
      },
    }),
  },
  {
    id: 'shell.inspector',
    slot: 'bottomRight',
    order: 10,
    Component: createInspectorPanel(INSPECTOR_SUBJECTS),
  },
  { id: 'shell.debugPanel', slot: 'topLeft', order: 40, Component: DebugHudPanel },
]);
