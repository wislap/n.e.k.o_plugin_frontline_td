<!-- 自动生成，勿手改：npm run gen:index -->

# 公共导出清单

## src/content/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `ContentDb` | interface |  |
| `loadContent` | function |  |
| `localName` | function | Local name of a content id ('pack:name' → 'name'); ids without a namespace pass through unchanged. |
| `ResolvedMap` | interface |  |
| `ResolvedStoreProfile` | interface |  |
| `ResolvedStructure` | interface |  |
| `ResolvedSurface` | interface |  |
| `ResolvedUnit` | interface |  |
| `ResolvedWeapon` | interface | Damage in milli units, cooldown in ticks, cost amount in milli. |

## src/core/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `AnySchema` | type |  |
| `COMMAND_REJECTED` | event def |  |
| `CommandDef` | interface |  |
| `CommandEnvelope` | interface |  |
| `CommandRejectedPayload` | type |  |
| `contentId` | function | For static definitions: throws immediately on an invalid id so typos fail at module load, not at runtime. |
| `ContentId` | type | ADR 0022: content ids and registry keys are 'pack:name'. |
| `createRngState` | function |  |
| `defineCommand` | function |  |
| `defineEvent` | function |  |
| `defineIntent` | function |  |
| `defineSnapshotChannel` | function |  |
| `distance` | function | Math.sqrt is IEEE correctly-rounded and therefore deterministic (ADR 0006). |
| `EntityHandle` | type |  |
| `EntityId` | type |  |
| `EventDef` | interface |  |
| `EventVisibility` | type |  |
| `FactionId` | type |  |
| `FactionRelation` | type |  |
| `floorDiv` | function | True floor division (rounds toward -Infinity, unlike Math.trunc division). |
| `handleGeneration` | function |  |
| `handleId` | function |  |
| `hashCanonical` | function | Hashes plain data only: null, boolean, number (as f64 bits), string, arrays, TypedArrays (tagged by type), and plain objects (keys sorted). |
| `Infer` | type |  |
| `Inspection` | interface | Read-only per-entity explanation produced by Simulation.inspect: the entity's active modifiers plus every non-null module inspector section. |
| `IntentDef` | interface | Intents are like events but always invisible to snapshots and allow exactly one reader. |
| `isPackId` | function |  |
| `lnMilli` | function | round(1000 * ln(valueMilli / 1000)) for valueMilli >= 1000, integer-only (no Math.log — ADR 0006): the mantissa is range-reduced to [1, 2) in micro units by repeated halving, then ln(y) = 2·atanh((y−1)/(y+1)) is summed as a fixed-point series. |
| `MILLI` | const |  |
| `NULL_HANDLE` | const |  |
| `packHandle` | function |  |
| `parseContentId` | function |  |
| `readChannel` | function |  |
| `readLayer` | function |  |
| `rngNextIntBelow` | function | Unbiased integer in [0, n) via rejection sampling; n in 1..2^32. |
| `RngState` | type |  |
| `s` | export | A tiny schema DSL deriving both the TS type and the runtime validator. |
| `Serializable` | type | JSON-like data plus TypedArrays. |
| `SerializableTypedArray` | type |  |
| `Snapshot` | interface |  |
| `SnapshotChannelDef` | interface |  |
| `SnapshotEventEntry` | interface |  |
| `Tick` | type |  |
| `TICK_MS` | const |  |
| `TICKS_PER_SECOND` | const |  |
| `toFactionId` | function |  |
| `toTick` | function |  |
| `validate` | function |  |

## src/features/capture/content.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `captureProfileSchema` | const |  |

## src/features/capture/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `CaptureCompleted` | event def |  |
| `CaptureCompletedPayload` | type | Emitted when a ruin's tug-of-war progress reaches its total under one faction. |
| `CapturePoints` | interface |  |
| `CapturePointsChannel` | channel def |  |

## src/features/capture/render/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `CaptureLayer` | function |  |

## src/features/capture/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `captureRuinParts` | function | Injected into construction as a ruin part factory (wired in app): every ruin carries Capture; kind/x/y mirror the Structure fields so the module needs no construction import. |
| `createCaptureModule` | function |  |

## src/features/combat/content.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `weaponSchema` | const |  |

## src/features/combat/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `COMBAT_INSPECTOR_ID` | const | Inspector section id for combat entities. |
| `CombatDied` | event def |  |
| `CombatInspection` | type | Inspector section payload emitted by frontline_td:combat. |
| `CombatShot` | event def |  |
| `DamageIntent` | intent def |  |
| `DamagePayload` | type | target = entity handle, amount = milli damage. |
| `DiedPayload` | type | Emitted once per entity when its hp drops to 0; cleanup-phase readers (movement, construction) release per-entity resources before combat's own despawn runs. |
| `ShotPayload` | type |  |

## src/features/combat/render/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `BeamsLayer` | function |  |

## src/features/combat/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `CombatModule` | interface |  |
| `createCombatModule` | function |  |
| `Health` | component def |  |
| `healthFraction` | function | hp fraction in basis points; entities without Health read as full. |
| `roadSegmentParts` | function | Road-segment parts (E1): flat segment hp and a 0.5-cell hit radius. |
| `structureParts` | function |  |
| `unitParts` | function |  |

## src/features/construction/content.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `BUILD_CATEGORIES` | const | Build menu category tabs (ADR 0049): structures with a `build` block belong to one of these groups; omitted entries default to 'production'. |
| `BuildCategory` | type |  |
| `STRUCTURE_GLYPHS` | const | Procedural roof tactical glyph badges for structures (ADR 0050). |
| `STRUCTURE_SILHOUETTES` | const | Procedural 3D silhouette shapes for structures (ADR 0050). |
| `structureBaseFields` | const |  |
| `StructureGlyph` | type |  |
| `StructureSilhouette` | type |  |

## src/features/construction/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `ActivateCommand` | command def | construction.activate: activate blueprint handles for auto-start. |
| `CancelCommand` | command def | construction.cancel: blueprint -> despawn; build site -> salvage of delivered materials; finished building -> demolition. |
| `CONSTRUCTION_INSPECTOR_ID` | const | Inspector section id for construction entities. |
| `ConstructionCompleted` | event def |  |
| `ConstructionCompletedPayload` | type |  |
| `ConstructionInspection` | type | Inspector section payload emitted by frontline_td:construction. |
| `ConstructionSalvage` | interface |  |
| `ConstructionSiteSlot` | type | Delivered vs required cargo amounts for a single construction site slot. |
| `ConstructionStateName` | type | String state names corresponding to StructuresChannel row states. |
| `ConstructionStructures` | interface |  |
| `PlaceCommand` | command def | construction.place: kind is a structure content id; blueprint spawns a reservation instead of a site. |
| `RoadSegmentDesc` | interface | Data handed to the injected road-segment parts factories (logistics contributes site slots + FixedAttach, combat Health + Targetable). |
| `RoadWorks` | interface | Per-observer road-works snapshot: live segments plus planned projects. |
| `RoadWorksChannel` | channel def |  |
| `SalvageChannel` | channel def |  |
| `STATE_BLUEPRINT` | const | Structures channel row states. |
| `STATE_DEMOLISHING` | const |  |
| `STATE_NAMES` | const |  |
| `STATE_OPERATIONAL` | const |  |
| `STATE_RUIN` | const |  |
| `STATE_SITE` | const |  |
| `STATE_WAITING` | const |  |
| `StructuresChannel` | channel def |  |
| `UpgradeLinksCommand` | command def | construction.upgrade_links: order road projects on links between own nodes (a/b are node entity handles); level is a roadLevels index. |

## src/features/construction/render/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `ExclusionLayer` | function |  |
| `GhostPreview` | function |  |
| `roadWorksHpItems` | function | HP-bar collector for road segments (only damaged ones render). |
| `RoadWorksLayer` | function |  |
| `structureKindHeight` | function | Greybox height from content (`visual.height`, required per kind); unknown indices fall back to a unit-height box. |
| `StructuresLayer` | function |  |

## src/features/construction/rules/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `centeredFootprint` | function | Top-left cell of a footprint centered on (groundX, groundY). |
| `checkFootprint` | function | One pass per check category so the reason precedence is the code order above, independent of which cell fails first. |
| `checkRange` | function |  |
| `classifyCancelSelection` | function | Classify selected handles into cancellable targets, operational buildings that require demolition confirmation, and aggregated demolition refunds. |
| `demolishRefund` | function | Refund slots for a demolished building: build cost x salvageBp. |
| `FOOTPRINT_CODES` | const |  |
| `makePlacementView` | function |  |
| `PlacementRule` | interface |  |
| `PlacementView` | interface |  |
| `RANGE_CODES` | const |  |

## src/features/construction/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `Core` | component def | Core tag: construction-owned flag present only on operational structures whose content sets `core` (added at spawn-complete or on site completion). |
| `createConstructionModule` | function |  |
| `Structure` | component def | A placed structure (site or building); x,y is the footprint top-left. |
| `StructurePartsFn` | type | Injected structure spawn-part factories (logistics contributes node + store parts; later batches add theirs). |
| `structureStateOf` | function | Structures-channel state for a Structure entity (blueprints have their own rows). |

## src/features/construction/ui/index.tsx

| 名称 | 种类 | 说明 |
|---|---|---|
| `BuildMenu` | function |  |

## src/features/logistics/content.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `CargoContent` | type |  |
| `cargoSchema` | const |  |
| `LogisticsConfigContent` | type |  |
| `logisticsConfigSchema` | const | Pack-level logistics parameters (single object, not a registry). |
| `lowestBuildableRoadLevel` | function | First road level carrying a build profile (level 0 is the dirt baseline). |
| `nodeProfileSchema` | const | Structure logistics node: connect and service in cells (connect is converted to cost units ×10 by the loader), warehouse marks the faction stock hub. |
| `storeProfileSchema` | const | One CargoStore slot: capacity in units (converted to milli by the loader), an optional per-second rate (negative = upkeep drain) and the export flag that marks the slot as a source shipped to the warehouse. |

## src/features/logistics/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `ADJUSTABLE_CLASSES` | const | Classes a faction can reorder; lifeline is always first, reserve last. |
| `CARGO_CLASSES` | const |  |
| `CARGO_CONSTRUCTION` | const | Cargo slot class codes (CargoStore.cls{i}). |
| `CARGO_PRODUCTION` | const |  |
| `CARGO_RESERVE` | const |  |
| `cargoClassCode` | function |  |
| `CargoClassName` | type |  |
| `ConsumeIntent` | intent def |  |
| `DepositIntent` | intent def |  |
| `LOGISTICS_INSPECTOR_ID` | const | Inspector section id for logistics entities. |
| `LogisticsInspection` | type | Inspector section payload emitted by frontline_td:logistics. |
| `LogisticsNetwork` | interface |  |
| `LogisticsNetworkChannel` | channel def |  |
| `LogisticsSlotInspection` | type | Single CargoStore slot summary inside a logistics inspection. |
| `ROAD_LAYER_ID` | const | Global road-level layer id (u8): 0 = dirt, >=1 paved level. |
| `RoadLinkKey` | interface | Stable link identity: the normalized pair of endpoint node handles (smaller first). |
| `SERVICE_LAYER_ID` | const | Per-faction coverage layer id (u8, perFaction). |
| `SetPrioritiesCommand` | command def |  |
| `SLOT_EXPORT` | const | CargoStore slot flag bits. |
| `SLOT_SITE` | const |  |
| `StoreTransferPayload` | type | Other features only emit these; logistics is the sole reader/resolver. |
| `UNMET_DISCONNECTED` | const |  |
| `UNMET_NO_CAPACITY` | const |  |
| `UNMET_NO_STOCK` | const |  |
| `UNMET_NONE` | const | Unmet-demand reason codes (CargoStore.unmet{i}). |
| `UNMET_NOT_COVERED` | const |  |
| `UNMET_REASONS` | const |  |

## src/features/logistics/render/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `LogisticsOverlay` | function |  |
| `RoadLayer` | function |  |
| `RoadToolLayer` | function |  |

## src/features/logistics/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `CARGO_SLOTS` | const |  |
| `CargoRead` | type |  |
| `CargoStore` | component def |  |
| `createLogisticsModule` | function |  |
| `EMPTY_CARGO` | const |  |
| `EnergyEmptyModifier` | modifier def |  |
| `EnergyLowModifier` | modifier def | Supply-state modifiers; the values come from the pack logistics config (lowSpeedBp) and the spec-fixed −10000 for empty. |
| `exportStoreInit` | function | A CargoStore whose filled slots are pure export buffers (cargo, amt = cap = refund, export flag, since = tick + 1). |
| `Interceptor` | component def | Interception strength (bp) this entity applies to hostile link quotas inside the corridor around link polylines. |
| `LinkPath` | interface | The upgrade query for construction: the link polyline oriented upstream (warehouse side per the budget-free full tree) -> downstream, per-cell cumulative path cost, the upstream node's handle and the link index. |
| `LogisticsModule` | interface |  |
| `LogisticsNode` | component def | connect: max link path cost in cost units (cell = 10); service: coverage radius in cells; w/h: structure footprint (B1 uses it for link rings). |
| `roadSegmentParts` | function | Road-segment parts (E1): construction-class site slots for the segment's material cost and a FixedAttach pinning it to the project's upstream node. |
| `sget` | function |  |
| `structureParts` | function | Structure spawn parts for the two phases. |
| `unitParts` | function | A unit's declared store profile becomes its CargoStore; the robot's lifeline battery (energy 60, −0.05/s) is defined in the pack. |

## src/features/logistics/ui/index.tsx

| 名称 | 种类 | 说明 |
|---|---|---|
| `extendRoadSelection` | function | Extends a clicked link into a route over the current snapshot, using smoothed link flow and stopping at warehouse or leaf nodes, then maps the selected link indices back to stable handle-pair keys. |
| `linkKey` | function | Node-handle pair of link `index` (smaller handle first), or null when either endpoint handle is unset. |
| `nearestLink` | function | Nearest link whose polyline is within maxDist cells of (x, y); ties resolve by link index. |
| `RoadPanel` | function |  |
| `sameKey` | function |  |
| `StockPanel` | function |  |

## src/features/movement/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `FormationGuideIntent` | intent def | Transient scalar squad cruise speed cap (ADR 0054 / ADR 0057). |
| `MoveCommand` | command def |  |
| `MoveIntent` | intent def | Sim-internal order channel (ADR 0008): squads/AI emit these; the resolver validates handle liveness and Mover but not faction (the emitter's responsibility). |
| `MoveOrdered` | event def | Emitted by the MoveCommand handler with the handles it applied (player override — squads drop these members). |
| `StopIntent` | intent def |  |

## src/features/movement/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `createMovementModule` | function |  |
| `MoveCommand` | command def |  |
| `Mover` | component def |  |
| `moverComponents` | function | Spawn tuples for a movable entity: callers add Faction/InWorld/UnitKind. |
| `MoveSpeed` | stat def | The movement speed stat: logistics' energy modifiers multiply it (ADR 0025). |
| `MoveTarget` | component def | One shared pathing goal id + the unit's slot point (cell centre). |
| `Position` | component def |  |

## src/features/pathing/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `createPathingModule` | function |  |
| `dijkstra` | function | neighbors(node, visit) must call visit(to, cost) for every outgoing edge. |
| `DIR_ORDER` | const | Neighbour order for direction pick: N, E, S, W, NE, SE, SW, NW. |
| `PathingApi` | interface |  |
| `UNREACHABLE` | const |  |

## src/features/production/content.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `producerSchema` | const |  |

## src/features/production/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `PRODUCTION_INSPECTOR_ID` | const | Inspector section id for production entities. |
| `PRODUCTION_STATES` | const | Possible producer operational states. |
| `ProductionInspection` | type | Inspector section payload emitted by frontline_td:production. |
| `ProductionStateName` | type | String state name union derived from PRODUCTION_STATES. |

## src/features/production/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `createProductionModule` | function |  |
| `structureParts` | function |  |

## src/features/squads/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `SquadsAssign` | command def |  |
| `SquadsChannel` | channel def |  |
| `SquadsCreate` | command def | Payload `units` are entity handles; `squad` is a squad id. |
| `SquadsDisband` | command def |  |
| `SquadsGather` | command def |  |
| `SquadsLaunched` | event def | Emitted when a gathering squad's launchTick arrives and its order becomes advance — the wave has launched. |
| `SquadsOrder` | command def |  |
| `SquadsSetStrength` | command def |  |
| `SquadsSnapshot` | interface |  |
| `SquadView` | interface | Full view of an own squad; hostiles only expose the public fields. |

## src/features/squads/render/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `bannerThreat` | function | Banner summary while any gather is visible: biggest gathering squad's member count and the soonest launch. |
| `ThreatsLayer` | function |  |

## src/features/squads/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `createSquadsModule` | function |  |

## src/features/squads/ui/index.tsx

| 名称 | 种类 | 说明 |
|---|---|---|
| `SquadPanel` | function |  |

## src/features/terrain/content.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `decodeMap` | function |  |
| `MapContent` | type |  |
| `mapSchema` | const |  |
| `MovementClassContent` | type |  |
| `movementClassSchema` | const |  |
| `SurfaceContent` | type |  |
| `surfaceSchema` | const | A class missing from `costs` is impassable on the surface. |
| `TerrainGrid` | interface |  |

## src/features/terrain/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `TERRAIN_BLOCKED_LAYER_ID` | const |  |
| `TERRAIN_HEIGHT_LAYER_ID` | const | Terrain layer ids: shared by the sim layer defs and the client renderer (render/input may import this file but never sim/). |
| `TERRAIN_SURFACE_LAYER_ID` | const |  |

## src/features/terrain/render/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `buildOutskirtsGeometry` | function |  |
| `buildTerrainGeometry` | function |  |
| `ScatterLayer` | function |  |
| `TerrainMesh` | function |  |

## src/features/terrain/rules/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `CLEARANCE_HEAVY` | const |  |
| `CLEARANCE_STANDARD` | const |  |
| `CLEARANCE_TIERS` | const |  |
| `clearanceAnchorCell` | function |  |
| `clearanceAnchorCenter` | function |  |
| `clearanceFootprintSize` | function |  |
| `ClearanceTier` | type |  |
| `clearanceTierForRadius` | function |  |
| `heightStepPassable` | function | The 8-neighbour edge rule (ADR 0015): a step is allowed when both cells are passable for the class and either the heights are equal, or \|dh\| = 1 and the LOWER cell is a ramp. |
| `spiralOffsets` | function | Square spiral offsets around (cx,cy), ring by ring, fixed traversal order. |
| `STANDARD_RADIUS_MAX` | const |  |

## src/features/terrain/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `createTerrainApi` | function |  |
| `createTerrainModule` | function |  |
| `TerrainApi` | interface |  |

## src/features/units/content.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `UnitContent` | type |  |
| `unitSchema` | const |  |

## src/features/units/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `DenseUnits` | interface |  |
| `DenseUnitsChannel` | channel def |  |
| `SpawnIntent` | intent def | Spawn a unit of content-id `kind` for `faction` at the nearest passable free cell around (x, y) — the same spiral as start spawning. |
| `UnitsSpawned` | event def | Emitted when the spawned unit's handle is known (same tick as the intent resolves; the entity becomes query-visible next tick). |

## src/features/units/render/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `factionColorHex` | function |  |
| `UnitsLayer` | function |  |

## src/features/units/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `createUnitsModule` | function |  |
| `DenseUnits` | interface |  |
| `DenseUnitsChannel` | channel def |  |
| `FactionStart` | interface |  |
| `StartUnit` | interface |  |
| `UnitKind` | component def |  |

## src/features/vision/content.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `DEFAULT_STRUCTURE_VISION_CELLS` | const |  |
| `DEFAULT_UNIT_VISION_CELLS` | const |  |
| `visionFields` | const |  |
| `visionLandmarkFields` | const |  |

## src/features/vision/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `VISION_STATE_LAYER_ID` | const |  |
| `VisionMemory` | interface |  |
| `VisionMemoryChannel` | channel def |  |

## src/features/vision/render/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `FogLayer` | function |  |
| `MemoryLayer` | function |  |

## src/features/vision/rules/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `ExclusionCircle` | interface |  |
| `hostileExcluders` | function | Operational hostile structures carrying an `exclusion` field, merged across row sets (structures channel first, then vision memory rows — memory rows by definition are not currently visible, so they never duplicate a live channel row). |
| `isCellVisible` | function | True when the cell containing position (x, y) is currently visible (layer value 2) to the layer's owner. |
| `StructureRows` | interface | Minimal structure-row shape shared by the structures channel and the vision memory channel (both carry the same columns). |

## src/features/vision/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `createVisionModule` | function |  |
| `structureVisionParts` | function | Injected into construction's structureParts (wired in app/). |
| `unitVisionParts` | function | Injected into units' unitParts (wired in app/). |
| `VisionLayer` | layer def |  |

## src/kernel/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `ComponentRef` | interface |  |
| `ComponentWriter` | interface | A writer token: only the module that claimed the component can write or structurally change it. |
| `Controller` | interface |  |
| `CONTROLLER_STREAM_ID` | const |  |
| `createQueuedController` | function |  |
| `createSimulation` | function |  |
| `defineComponent` | function | Components are static, module-level constants. |
| `defineGridLayer` | function |  |
| `defineModifier` | function |  |
| `defineStat` | function |  |
| `Faction` | component def | Kernel contract components (ADR 0019/0021). |
| `GridLayerWriter` | interface |  |
| `InWorld` | component def |  |
| `OPERATIONAL_EXCLUDE` | const |  |
| `QueuedController` | interface | A controller whose commands are pushed from outside (e.g. local input routed through the runtime). |
| `ReadonlyNumberArray` | type |  |
| `restoreSimulation` | function |  |
| `runScenario` | function |  |
| `SimBuilder` | interface |  |
| `SimConfig` | interface |  |
| `SimModule` | interface |  |
| `Simulation` | interface |  |
| `SpawnInit` | type |  |
| `SystemContext` | interface | The context a system / effect / command handler / snapshot builder sees. |
| `UnderConstruction` | component def | Set by construction while a structure is being built (claimed there). |
| `VisibilityQuery` | type | Per-observer visibility predicate injected into snapshot channel builders (M5 fog): vision wires its layer query in app/; filtered features declare it optional and default to all-visible. |
| `WriteView` | type |  |

## src/modes/assault/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `ASSAULT_MODE_ID` | const |  |
| `AssaultChannel` | channel def |  |
| `assaultDirector` | function |  |
| `assaultEnded` | function |  |
| `AssaultModeContext` | interface |  |
| `assaultModules` | function |  |
| `AssaultState` | interface |  |
| `defaultSetup` | function |  |

## src/protocol/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `MainToWorker` | type |  |
| `MatchSetup` | type |  |
| `parseMatchSetup` | function |  |
| `RuntimeStats` | interface |  |
| `SPEED_STEPS` | const | ADR 0005: index 0 is paused; indices are multipliers of base speed. |
| `WorkerToMain` | type |  |

## src/testing/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `denseUnits` | function | Read the dense-units snapshot channel for one faction (the common `dense(sim)` helper previously copy-pasted per test world). |
| `makeGrid` | function | Grid builder from ASCII rows: '.' (anything else) = flat ground, '#' = rock surface 1, '^' or 'r' = ramp, 'p' = plateau (height 1), '1'..'9' = height level. |
| `must` | function | Require a base-pack entry by name: throws with the entry name when the registry lookup misses (a content bug, not a test expectation). |
