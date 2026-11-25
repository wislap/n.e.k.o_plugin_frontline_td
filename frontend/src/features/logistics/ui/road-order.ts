// Road-upgrade order submission (single implementation for Enter-key
// confirm and canvas click-confirm): the selected node-handle pairs
// become an UpgradeLinksCommand at the lowest buildable road level from
// content.
import type { ContentDb } from '../../../content/index';
import { UpgradeLinksCommand } from '../../construction/protocol';
import { lowestBuildableRoadLevel } from '../content';
import { useRoadToolStore } from './road-tool-store';
import type { SimClient } from '../../../client/sim-client';

export function submitRoadOrder(client: SimClient, db: ContentDb): void {
  const roadTool = useRoadToolStore.getState();
  if (roadTool.roadSel.length === 0) {
    return;
  }
  // roadSel already holds normalized node-handle pairs, which is the
  // command payload's link identity — no index resolution needed.
  client.submit({
    type: UpgradeLinksCommand.type,
    payload: {
      links: roadTool.roadSel,
      level: lowestBuildableRoadLevel(db.logistics.roadLevels),
    },
  });
  // Stay in road mode after submitting.
  roadTool.setRoadSel([]);
}
