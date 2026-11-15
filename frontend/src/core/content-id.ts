import type { Brand } from './brand';

// ADR 0022: content ids and registry keys are 'pack:name'. Names and dotted
// name segments use snake_case; a local pack id prefixes the lowercased
// GitHub id (with '-' folded to '_') and a dot, e.g. 'wislap.frontline_td'.
export type ContentId = Brand<string, 'ContentId'>;

const MARKET_PACK_RE = /^[a-z][a-z0-9_]*$/;
const LOCAL_PACK_RE = /^[a-z0-9_]+\.[a-z][a-z0-9_]*$/;
const DOTTED_NAME_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

export function isPackId(s: string): boolean {
  return MARKET_PACK_RE.test(s) || LOCAL_PACK_RE.test(s);
}

export function parseContentId(s: string): { pack: string; name: string } | null {
  const sep = s.indexOf(':');
  if (sep < 0) {
    return null;
  }
  const pack = s.slice(0, sep);
  const name = s.slice(sep + 1);
  if (!isPackId(pack) || !DOTTED_NAME_RE.test(name)) {
    return null;
  }
  return { pack, name };
}

// For static definitions: throws immediately on an invalid id so typos fail
// at module load, not at runtime.
export function contentId(s: string): ContentId {
  if (parseContentId(s) === null) {
    throw new Error(`invalid content id '${s}'`);
  }
  return s as ContentId;
}
