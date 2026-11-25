// Vision minimap contributions (ADR 0062 step 4a): the fog raster pass
// (unexplored → fog colour, memory → dim) and the fog-memory ghost
// marks. Moved verbatim from client/minimap-model.ts and
// paint-minimap.ts.
import { readChannel, readLayer } from '../../../core/index';
import type { Snapshot } from '../../../core/index';
import {
  resolveDisposition,
  type MinimapMark,
  type MinimapMarkDef,
  type MinimapRasterDef,
} from '../../../ui/minimap/index';
import { STATE_RUIN } from '../../construction/protocol';
import { VISION_STATE_LAYER_ID, VisionMemoryChannel } from '../protocol';

const FOG_R = 6;
const FOG_G = 10;
const FOG_B = 18;

function visionLayerId(snapshot: Snapshot | null): string {
  return `${VISION_STATE_LAYER_ID}#${snapshot?.observer ?? 0}`;
}

const fogRaster: MinimapRasterDef = {
  id: 'vision.fog',
  order: 30,
  keys: (snapshot) => [readLayer(snapshot, visionLayerId(snapshot))],
  apply(rgba, input) {
    const cellCount = input.map.width * input.map.height;
    const visionLayer = readLayer(input.snapshot, visionLayerId(input.snapshot));
    if (visionLayer === null) {
      for (let i = 0; i < cellCount; i++) {
        const o = i * 4;
        rgba[o] = FOG_R;
        rgba[o + 1] = FOG_G;
        rgba[o + 2] = FOG_B;
        rgba[o + 3] = 255;
      }
      return;
    }
    for (let i = 0; i < cellCount; i++) {
      const visionState = visionLayer[i] ?? 0;
      const o = i * 4;
      if (visionState === 0) {
        rgba[o] = FOG_R;
        rgba[o + 1] = FOG_G;
        rgba[o + 2] = FOG_B;
        rgba[o + 3] = 255;
        continue;
      }
      if (visionState === 1) {
        rgba[o] = Math.round((rgba[o] ?? 0) * 0.45 + 8);
        rgba[o + 1] = Math.round((rgba[o + 1] ?? 0) * 0.45 + 8);
        rgba[o + 2] = Math.round((rgba[o + 2] ?? 0) * 0.45 + 8);
      }
    }
  },
};

function memoryColor(disposition: 'own' | 'hostile' | 'ally' | 'neutral'): string {
  switch (disposition) {
    case 'own':
      return '#4d7ea8';
    case 'hostile':
      return '#8a5058';
    case 'ally':
      return '#468a73';
    case 'neutral':
      return '#5b7390';
  }
}

const memoriesMarks: MinimapMarkDef = {
  id: 'vision.memories',
  order: 20,
  collect({ db, snapshot, isHostile }) {
    const mem = readChannel(snapshot, VisionMemoryChannel) ?? undefined;
    if (mem === undefined) {
      return [];
    }
    const observer = snapshot?.observer ?? 0;
    const marks: MinimapMark[] = [];
    for (let i = 0; i < mem.handles.length; i++) {
      const st = db.structures.byIndex(mem.kind[i] ?? 0);
      const faction = mem.faction[i] ?? 0;
      const state = mem.state[i] ?? 0;
      const disposition =
        state === STATE_RUIN || faction === 0
          ? 'neutral'
          : resolveDisposition(observer, faction, isHostile);
      marks.push({
        kind: 'rect',
        x: mem.x[i] ?? 0,
        y: mem.y[i] ?? 0,
        w: st?.footprint.w ?? 1,
        h: st?.footprint.h ?? 1,
        fill: memoryColor(disposition),
        alpha: 0.65,
      });
    }
    return marks;
  },
};

export const visionMinimapRasters: readonly MinimapRasterDef[] = [fogRaster];
export const visionMinimapMarks: readonly MinimapMarkDef[] = [memoriesMarks];
