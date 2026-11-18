// Road-upgrade order submission (single implementation for Enter-key
// confirm and canvas click-confirm): selected link indices become an
// UpgradeLinksCommand at the lowest buildable road level from content.
import type { ContentDb } from '../content/index';
import { UpgradeLinksCommand } from '../features/construction/protocol';
import { LogisticsNetworkChannel, type LogisticsNetwork } from '../features/logistics/protocol';
import { linkPairs } from '../features/logistics/ui/index';
import { useBuildStore } from './build-store';
import type { SimClient } from './sim-client';

// First level carrying a build profile (0 is the dirt baseline).
function lowestBuildableRoadLevel(db: ContentDb): number {
  const index = db.logistics.roadLevels.findIndex((l) => l.cost !== undefined);
  if (index < 0) {
    throw new Error('logistics content defines no buildable road level');
  }
  return index;
}

export function submitRoadOrder(client: SimClient, db: ContentDb): void {
  const build = useBuildStore.getState();
  if (build.roadSel.length === 0) {
    return;
  }
  const net = client.snapshots().latest?.channels[LogisticsNetworkChannel.id] as
    LogisticsNetwork | undefined;
  if (net === undefined) {
    return;
  }
  const links = linkPairs(net, build.roadSel);
  if (links.length > 0) {
    client.submit({
      type: UpgradeLinksCommand.type,
      payload: { links, level: lowestBuildableRoadLevel(db) },
    });
  }
  // Stay in road mode after submitting.
  build.setRoadSel([]);
}
