// Production protocol: inspector contract for structure producers.

// Inspector section id for production entities.
export const PRODUCTION_INSPECTOR_ID = 'frontline_td:production';

// Possible producer operational states.
export const PRODUCTION_STATES = ['ready', 'producing', 'waiting_inputs', 'output_full'] as const;

// String state name union derived from PRODUCTION_STATES.
export type ProductionStateName = (typeof PRODUCTION_STATES)[number];

// Inspector section payload emitted by frontline_td:production.
export type ProductionInspection = {
  state: ProductionStateName;
  progress: number;
  total: number;
  missing: number[];
  full: number[];
  nextUnit?: string;
};
