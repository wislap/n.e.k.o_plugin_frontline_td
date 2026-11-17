// The base content pack (ADR 0022). Registries stay empty until features
// populate them in later milestones.
import { hashCanonical } from '../core/index';
import { cargos } from './frontline_td/cargos';
import { logisticsConfig } from './frontline_td/logistics-config';
import { movementClasses } from './frontline_td/movement-classes';
import { proto01 } from './frontline_td/maps/proto_01';
import { structures } from './frontline_td/structures';
import { surfaces } from './frontline_td/surfaces';
import { units } from './frontline_td/units';

export const BASE_PACK_ID = 'frontline_td';
export const BASE_PACK_VERSION = '0.1.0';
export const BASE_PACK_CONTENT = {
  surfaces,
  movementClasses,
  units,
  maps: [proto01],
  cargos,
  structures,
  logistics: logisticsConfig,
};

export interface PackManifest {
  id: string;
  version: string;
  contentHash: string;
}

export function basePackManifest(): PackManifest {
  return {
    id: BASE_PACK_ID,
    version: BASE_PACK_VERSION,
    contentHash: hashCanonical(BASE_PACK_CONTENT),
  };
}
