// Logistics HUD contributions (ADR 0062): warehouse stock top-right,
// road tool panel bottom-center after the build menu.
import type { HudPanelDef } from '../../../ui/hud-panels';
import { RoadPanel } from './RoadPanel';
import { StockPanel } from './StockPanel';

export const logisticsHudPanels: readonly HudPanelDef[] = [
  { id: 'logistics.stockPanel', slot: 'topRight', order: 10, Component: StockPanel },
  { id: 'logistics.roadPanel', slot: 'bottomCenter', order: 20, Component: RoadPanel },
];
