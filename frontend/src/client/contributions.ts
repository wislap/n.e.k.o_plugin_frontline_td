// Contribution ordering (ADR 0062): features declare contribution lists
// (scene layers, HUD panels, …), app assembles them. Sort is stable by
// `order` (insertion order wins ties) so mounted DOM/three order is
// reproduced exactly; duplicate ids are an assembly error.
export function sortContributions<T extends { readonly id: string; readonly order: number }>(
  defs: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.id)) {
      throw new Error(`duplicate contribution id: ${def.id}`);
    }
    seen.add(def.id);
  }
  return defs
    .map((def, index) => ({ def, index }))
    .sort((a, b) => a.def.order - b.def.order || a.index - b.index)
    .map(({ def }) => def);
}
