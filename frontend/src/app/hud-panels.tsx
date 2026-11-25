// HUD panel assembly (ADR 0062): app is the only place shell and
// feature panel lists are combined. groupHudPanels reproduces the
// pre-registry in-slot DOM order.
import { useUiStore } from '../client/ui-store';
import { DebugPanel } from '../dev/DebugPanel';
import { constructionHudPanels } from '../features/construction/ui/index';
import { logisticsHudPanels } from '../features/logistics/ui/index';
import { squadsHudPanels } from '../features/squads/ui/index';
import { groupHudPanels, type HudPanelProps } from '../ui/hud-panels';
import { createInspectorPanel } from '../ui/inspector/index';
import { createMinimapPanel } from '../ui/minimap/index';
import { SHELL_HUD_PANELS } from '../ui/shell-panels';
import { INSPECTOR_SUBJECTS } from './inspector-subjects';
import { MINIMAP_MARKS, MINIMAP_RASTERS } from './minimap-contributions';

// Dev debug panel: registered like every other panel; it reads the
// store flag itself and renders nothing while closed.
function DebugHudPanel({ ctx }: HudPanelProps) {
  const open = useUiStore((s) => s.debugPanelOpen);
  if (!open) {
    return null;
  }
  return <DebugPanel client={ctx.client} />;
}

export const HUD_PANELS = groupHudPanels([
  ...SHELL_HUD_PANELS,
  ...constructionHudPanels,
  ...logisticsHudPanels,
  ...squadsHudPanels,
  {
    id: 'shell.minimap',
    slot: 'topLeft',
    order: 20,
    Component: createMinimapPanel({ rasters: MINIMAP_RASTERS, marks: MINIMAP_MARKS }),
  },
  {
    id: 'shell.inspector',
    slot: 'bottomRight',
    order: 10,
    Component: createInspectorPanel(INSPECTOR_SUBJECTS),
  },
  { id: 'shell.debugPanel', slot: 'topLeft', order: 40, Component: DebugHudPanel },
]);
