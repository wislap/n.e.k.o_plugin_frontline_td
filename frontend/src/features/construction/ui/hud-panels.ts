// Construction HUD contributions (ADR 0062): build menu first in
// bottom-center (before the road panel).
import type { HudPanelDef } from '../../../ui/hud-panels';
import { BuildMenu } from './BuildMenu';

export const constructionHudPanels: readonly HudPanelDef[] = [
  { id: 'construction.buildMenu', slot: 'bottomCenter', order: 10, Component: BuildMenu },
];
