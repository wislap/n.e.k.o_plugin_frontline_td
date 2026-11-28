// Logistics canvas intent handlers (ADR 0062 step 4b): the road tool's
// link click — select/extend a link, toggle additive links, or confirm
// an already-selected link as an upgrade order. Moved verbatim from
// render/input-dispatch.ts.
import { readChannel } from '../../../core/index';
import {
  defineCanvasIntentHandler,
  type CanvasIntentHandlerDef,
} from '../../../client/canvas-input';
import { LogisticsNetworkChannel, type LogisticsNetwork } from '../protocol';
import { submitRoadOrder } from './road-order';
import { useRoadToolStore } from './road-tool-store';
import { extendRoadSelection, linkKey, nearestLink, sameKey } from './road-select';

const roadClick = defineCanvasIntentHandler({
  id: 'logistics.road_click',
  kind: 'road.click',
  handle(intent, env) {
    const ground = env.groundAt(intent.x, intent.y);
    if (ground === null) {
      return;
    }
    const roadTool = useRoadToolStore.getState();
    const latest = env.client.snapshots().latest;
    const network = readChannel(latest, LogisticsNetworkChannel);
    const links: LogisticsNetwork['links'] | { a: []; pathOffsets: []; pathCells: [] } =
      network?.links ?? { a: [], pathOffsets: [], pathCells: [] };
    const link = nearestLink(links, env.map.grid.width, ground.x, ground.y);
    if (link === -1) {
      return;
    }
    const key = network === null ? null : linkKey(network, link);
    if (key === null) {
      return;
    }
    if (intent.additive) {
      roadTool.toggleRoadLink(key);
      return;
    }
    if (roadTool.roadSel.some((k) => sameKey(k, key.a, key.b))) {
      submitRoadOrder(env.client, env.db);
      return;
    }
    roadTool.setRoadSel(extendRoadSelection(env.db, latest, link));
  },
});

export const logisticsCanvasIntents: readonly CanvasIntentHandlerDef[] = [roadClick];
