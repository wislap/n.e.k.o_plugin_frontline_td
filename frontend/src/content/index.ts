export { loadContent } from './load';
export type {
  ContentDb,
  ResolvedMap,
  ResolvedStoreProfile,
  ResolvedStructure,
  ResolvedSurface,
  ResolvedUnit,
  ResolvedWeapon,
} from './load';

// Local name of a content id ('pack:name' → 'name'); ids without a
// namespace pass through unchanged. UI display only — never match
// behaviour by local name.
export function localName(id: string): string {
  return id.split(':')[1] ?? id;
}
