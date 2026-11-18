// Vision content fields (M5 batch B): `vision` is the sight radius in
// cells for units and operational structures (loader fills defaults 6/4);
// `visionLandmark` marks structures every faction remembers from the
// first vision tick (outpost, hive).
import { s } from '../../core/index';

export const visionFields = {
  vision: s.optional(s.int({ min: 1, max: 64 })),
};

export const visionLandmarkFields = {
  visionLandmark: s.optional(s.bool()),
};

export const DEFAULT_UNIT_VISION_CELLS = 6;
export const DEFAULT_STRUCTURE_VISION_CELLS = 4;
