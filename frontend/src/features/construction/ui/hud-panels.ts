// Construction HUD contributions (ADR 0062): build menu first in
// bottom-center (before the road panel), with thumbnail renderer
// injected from app/.
import type { HudPanelDef } from '../../../ui/hud-panels';
import { createBuildMenuPanel, type ThumbnailRenderer } from './BuildMenu';

export type { ThumbnailRenderer };

export function createConstructionHudPanels(opts?: {
  renderThumbnails?: ThumbnailRenderer;
}): readonly HudPanelDef[] {
  return [
    {
      id: 'construction.buildMenu',
      slot: 'bottomCenter',
      order: 10,
      Component: createBuildMenuPanel(opts?.renderThumbnails),
    },
  ];
}
