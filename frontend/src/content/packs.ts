// The base content pack (ADR 0022). Registries stay empty until features
// populate them in later milestones.
import { hashCanonical } from '../core/index';

export const BASE_PACK_ID = 'frontline_td';
export const BASE_PACK_VERSION = '0.1.0';
export const BASE_PACK_CONTENT = {};

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
