// Squads HUD contributions (ADR 0062): squad strip bottom-left, threat
// banner top-center.
import type { HudPanelDef } from '../../../ui/hud-panels';
import { SquadPanel } from './SquadPanel';
import { ThreatBanner } from './ThreatBanner';

export const squadsHudPanels: readonly HudPanelDef[] = [
  { id: 'squads.squadPanel', slot: 'bottomLeft', order: 10, Component: SquadPanel },
  { id: 'squads.threatBanner', slot: 'topCenter', order: 20, Component: ThreatBanner },
];
