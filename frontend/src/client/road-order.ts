// Road-upgrade order submission (single implementation for Enter-key
// confirm and canvas click-confirm): the selected node-handle pairs
// become an UpgradeLinksCommand at the lowest buildable road level from
// content.
import type { ContentDb } from '../content/index';
import { UpgradeLinksCommand } from '../features/construction/protocol';
import { lowestBuildableRoadLevel } from '../features/logistics/content';
import { useInteractionStore } from './interaction-store';
import type { SimClient } from './sim-client';

export function submitRoadOrder(client: SimClient, db: ContentDb): void {
  const interaction = useInteractionStore.getState();
  if (interaction.roadSel.length === 0) {
    return;
  }
  // roadSel already holds normalized node-handle pairs, which is the
  // command payload's link identity — no index resolution needed.
  client.submit({
    type: UpgradeLinksCommand.type,
    payload: {
      links: interaction.roadSel,
      level: lowestBuildableRoadLevel(db.logistics.roadLevels),
    },
  });
  // Stay in road mode after submitting.
  interaction.setRoadSel([]);
}
