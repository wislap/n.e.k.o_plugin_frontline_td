// Base-pack logistics parameters (ADR 0025). Cycle is 1 s of sim time;
// vehicles carry 5 units per trip at 5 cells/s; the low-energy band slows
// movers to 25% and empty stops them (−10000 is fixed by the spec).
// hpBands are checked top-down: first band whose aboveBp exceeds the
// entity's health applies, so entries go from lowest threshold up.
import type { LogisticsConfigContent } from '../../features/logistics/content';

export const logisticsConfig: LogisticsConfigContent = {
  cycleSeconds: 1,
  vehicle: { load: 5, speed: 5 },
  lowThresholdBp: 3000,
  lowSpeedBp: -7500,
  hpBandsBp: [
    { aboveBp: 2000, factorBp: 2500 },
    { aboveBp: 5000, factorBp: 5000 },
  ],
  roadLevels: [
    { multiplierBp: 10000 },
    // Paved road: doubles link throughput; 1 material per cell, 0.25 s
    // per cell of build time, 100 hp per 8-cell segment.
    {
      multiplierBp: 20000,
      costPerCell: { 'frontline_td:material': 1 },
      secondsPerCell: 0.25,
      segmentHp: 100,
    },
  ],
  segmentCells: 8,
  corridorWidth: 1.5,
};
