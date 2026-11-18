# vision — fog of war (M5 batch B)

Per-faction fog layer plus observer structure memory. Design decisions:
[ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md) (fog model,
memory, filtering) and [ADR 0040](../../../../docs/adr/0040-entity-id-reuse-component-reads.md)
(handle validation under entity-id reuse).

- `content.ts`: `vision` sight radius (cells) on units and structures
  (defaults 6 / 4); `visionLandmark` flags structures seeded into every
  faction's memory at the first vision tick (outpost, hive).
- `protocol.ts`: the `frontline_td:vision.state` layer id and the
  `frontline_td:vision.memory` snapshot channel — remembered non-own
  structures whose footprint is NOT currently visible (structures-channel
  columns: handle, kind, x, y, faction, state).
- `sim/`: `Vision { radius, x, y }` component (injected via `unitParts`
  / `structureParts` — structures carry no Position, so the factory bakes
  the footprint centre in; sites, ruins and blueprints get no part), the
  `capture_fog` recompute system (every 5 ticks: 2 -> 1 downgrade, then
  stamp integer discs per source), and the `VisionApi` query
  (`visible` / `visibleRect`; omniscient factions always true).

Filtering is by injection only: units, construction, squads and capture
channel builders take an optional `VisibilityQuery` wired from
`vision.api` in `app/` — vision never enters the filtered features, and
no module imports `sim/` internals of vision.

Client overlays (batch D): `render/FogLayer` (unexplored/explored
instanced quads, rebuilt on layer-identity change), `render/MemoryLayer`
(dim remembered-structure boxes), and `rules/` pure helpers —
`isCellVisible`, `fogBuckets`, `hostileExcluders` — shared by beams,
build ghost and the exclusion overlay. Match hostility comes from
`client/hostility.ts` (MatchSetup relations), not an approximation.

Known limitation: event visibility stays `'all'`; effects in hidden
cells are filtered client-side only (ADR 0039).
