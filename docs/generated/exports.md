<!-- 自动生成，勿手改：npm run gen:index -->

# 公共导出清单

## src/content/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `ContentDb` | interface |  |
| `loadContent` | function |  |
| `localName` | function | Local name of a content id ('pack:name' → 'name'); |
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
| `lnMilli` | function | round(ln(2) * 1e6) round(1000 * ln(valueMilli / 1000)) for valueMilli >= 1000, integer-only (no Math.log — ADR 0006): the mantissa is range-reduced to [1, 2) in micro units by repeated halving, then ln(y) = 2·atanh((y−1)/(y+1)) is summed as a fixed-point series. |
| `MILLI` | const |  |
| `NULL_HANDLE` | const |  |
| `packHandle` | function |  |
| `parseContentId` | function |  |
| `rngNextIntBelow` | function | Unbiased integer in [0, n) via rejection sampling; |
| `RngState` | type | Seeded, serializable RNG: sfc32 over a Uint32Array(4) state. |
| `s` | export | A tiny schema DSL deriving both the TS type and the runtime validator. |
| `Serializable` | type | JSON-like data plus TypedArrays. |
| `Snapshot` | interface |  |
| `SnapshotChannelDef` | interface |  |
| `SnapshotEventEntry` | interface |  |
| `Tick` | type |  |
| `TICK_MS` | const |  |
| `TICKS_PER_SECOND` | const |  |
| `toFactionId` | function |  |
| `toTick` | function |  |
| `validate` | function |  |

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
| `captureRuinParts` | function | Injected into construction as a ruin part factory (wired in app): every ruin carries Capture; |
| `createCaptureModule` | function |  |

## src/features/combat/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `CombatDied` | event def |  |
| `CombatShot` | event def |  |
| `DamageIntent` | intent def |  |
| `DamagePayload` | type | target = entity handle, amount = milli damage. |
| `DiedPayload` | type | Emitted once per entity when its hp drops to 0; |
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
| `healthFraction` | function | hp fraction in basis points; |
| `roadSegmentParts` | function | Road-segment parts (E1): flat segment hp and a 0.5-cell hit radius. |
| `structureParts` | function |  |
| `unitParts` | function |  |

## src/features/construction/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `ActivateCommand` | command def |  |
| `CancelCommand` | command def |  |
| `ConstructionCompleted` | event def |  |
| `ConstructionCompletedPayload` | type |  |
| `ConstructionSalvage` | interface |  |
| `ConstructionStructures` | interface |  |
| `PlaceCommand` | command def |  |
| `RoadSegmentDesc` | interface | Data handed to the injected road-segment parts factories (logistics contributes site slots + FixedAttach, combat Health + Targetable). |
| `RoadWorks` | interface | Per-observer road-works snapshot: live segments plus planned projects. |
| `RoadWorksChannel` | channel def |  |
| `SalvageChannel` | channel def |  |
| `STATE_BLUEPRINT` | const |  |
| `STATE_DEMOLISHING` | const |  |
| `STATE_NAMES` | const |  |
| `STATE_OPERATIONAL` | const |  |
| `STATE_RUIN` | const |  |
| `STATE_SITE` | const |  |
| `STATE_WAITING` | const |  |
| `StructuresChannel` | channel def |  |
| `UpgradeLinksCommand` | command def |  |

## src/features/construction/render/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `ExclusionLayer` | function |  |
| `GhostPreview` | function |  |
| `roadWorksHpItems` | function | HP-bar collector for road segments (only damaged ones render). |
| `RoadWorksLayer` | function |  |
| `structureKindHeight` | function | Greybox height from content (`visual.height`, required per kind); |
| `StructuresLayer` | function |  |

## src/features/construction/rules/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `checkFootprint` | function | One pass per check category so the reason precedence is the code order above, independent of which cell fails first. |
| `checkRange` | function |  |
| `FOOTPRINT_CODES` | const |  |
| `makePlacementView` | function |  |
| `PlacementRule` | interface | Shared placement rules (ADR 0012): pure footprint and range checks used by the sim (authoritative) and the client preview (batch D). |
| `PlacementView` | interface |  |
| `RANGE_CODES` | const |  |

## src/features/construction/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `Core` | component def |  |
| `createConstructionModule` | function |  |
| `Structure` | component def |  |
| `StructurePartsFn` | type | Injected structure spawn-part factories (logistics contributes node + store parts; |
| `structureStateOf` | function | Structures-channel state for a Structure entity (blueprints have their own rows). |

## src/features/construction/ui/index.tsx

| 名称 | 种类 | 说明 |
|---|---|---|
| `BuildMenu` | function |  |

## src/features/logistics/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `ADJUSTABLE_CLASSES` | const |  |
| `CARGO_CLASSES` | const |  |
| `CARGO_CONSTRUCTION` | const |  |
| `CARGO_PRODUCTION` | const |  |
| `CARGO_RESERVE` | const |  |
| `cargoClassCode` | function |  |
| `CargoClassName` | type |  |
| `ConsumeIntent` | intent def |  |
| `DepositIntent` | intent def |  |
| `LogisticsNetwork` | interface |  |
| `LogisticsNetworkChannel` | channel def |  |
| `ROAD_LAYER_ID` | const |  |
| `SERVICE_LAYER_ID` | const |  |
| `SetPrioritiesCommand` | command def |  |
| `SLOT_EXPORT` | const |  |
| `SLOT_SITE` | const |  |
| `StoreTransferPayload` | type | Other features only emit these; |
| `UNMET_DISCONNECTED` | const |  |
| `UNMET_NO_CAPACITY` | const |  |
| `UNMET_NO_STOCK` | const |  |
| `UNMET_NONE` | const |  |
| `UNMET_NOT_COVERED` | const |  |
| `UNMET_REASONS` | const |  |

## src/features/logistics/render/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `linkFlow` | function |  |
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
| `EnergyLowModifier` | modifier def |  |
| `exportStoreInit` | function | A CargoStore whose filled slots are pure export buffers (cargo, amt = cap = refund, export flag, since = tick + 1). |
| `Interceptor` | component def |  |
| `LinkPath` | interface | The upgrade query for construction: the link polyline oriented upstream (warehouse side per the budget-free full tree) -> downstream, per-cell cumulative path cost, the upstream node's handle and the link index. |
| `LogisticsModule` | interface |  |
| `LogisticsNode` | component def |  |
| `roadSegmentParts` | function | Road-segment parts (E1): construction-class site slots for the segment's material cost and a FixedAttach pinning it to the project's upstream node. |
| `sget` | function |  |
| `structureParts` | function | Structure spawn parts for the two phases. |
| `unitParts` | function | A unit's declared store profile becomes its CargoStore; |

## src/features/logistics/ui/index.tsx

| 名称 | 种类 | 说明 |
|---|---|---|
| `extendRoute` | function | Extends a clicked link into a route: from each endpoint greedily pick the incident unselected link with the highest flow (ties by link index), continuing while the candidate flow is >= half the clicked link's flow and the far node is neither a warehouse nor a leaf. |
| `linkPairs` | function | Converts selected link indices to the node-handle pairs the upgrade_links command expects (dropping dangling indices). |
| `nearestLink` | function | Nearest link whose polyline is within maxDist cells of (x, y); |
| `RoadPanel` | function |  |
| `StockPanel` | function |  |

## src/features/movement/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `MoveCommand` | command def |  |
| `MoveIntent` | intent def |  |
| `MoveOrdered` | event def |  |
| `StopIntent` | intent def |  |

## src/features/movement/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `createMovementModule` | function |  |
| `MoveCommand` | command def |  |
| `Mover` | component def |  |
| `moverComponents` | function | Spawn tuples for a movable entity: callers add Faction/InWorld/UnitKind. |
| `MoveSpeed` | stat def |  |
| `MoveTarget` | component def |  |
| `Position` | component def |  |

## src/features/pathing/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `createPathingModule` | function |  |
| `dijkstra` | function | neighbors(node, visit) must call visit(to, cost) for every outgoing edge. |
| `DIR_ORDER` | const |  |
| `PathingApi` | interface |  |
| `UNREACHABLE` | const |  |

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
| `SquadsCreate` | command def |  |
| `SquadsDisband` | command def |  |
| `SquadsGather` | command def |  |
| `SquadsLaunched` | event def |  |
| `SquadsOrder` | command def |  |
| `SquadsSetStrength` | command def |  |
| `SquadsSnapshot` | interface |  |
| `SquadView` | interface | Full view of an own squad; |

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

## src/features/terrain/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `TERRAIN_BLOCKED_LAYER_ID` | const |  |
| `TERRAIN_HEIGHT_LAYER_ID` | const |  |
| `TERRAIN_SURFACE_LAYER_ID` | const |  |

## src/features/terrain/render/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `TerrainMesh` | function |  |

## src/features/terrain/rules/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `heightStepPassable` | function | The 8-neighbour edge rule (ADR 0015): a step is allowed when both cells are passable for the class and either the heights are equal, or \|dh\| = 1 and the LOWER cell is a ramp. |
| `spiralOffsets` | function | Square spiral offsets around (cx,cy), ring by ring, fixed traversal order. |

## src/features/terrain/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `createTerrainApi` | function |  |
| `createTerrainModule` | function |  |
| `TerrainApi` | interface |  |

## src/features/units/protocol.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `DenseUnits` | interface |  |
| `DenseUnitsChannel` | channel def |  |
| `SpawnIntent` | intent def |  |
| `UnitsSpawned` | event def |  |

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
| `fogBuckets` | function | Buckets every cell of the layer into unexplored (0) and explored (1); |
| `FogBuckets` | interface |  |
| `hostileExcluders` | function | Operational hostile structures carrying an `exclusion` field, merged across row sets (structures channel first, then vision memory rows — memory rows by definition are not currently visible, so they never duplicate a live channel row). |
| `isCellVisible` | function | True when the cell containing position (x, y) is currently visible (layer value 2) to the layer's owner. |
| `StructureRows` | interface | Minimal structure-row shape shared by the structures channel and the vision memory channel (both carry the same columns). |

## src/features/vision/sim/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `createVisionModule` | function |  |
| `structureVisionParts` | const |  |
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
| `Faction` | component def |  |
| `GridLayerWriter` | interface |  |
| `InWorld` | component def |  |
| `OPERATIONAL_EXCLUDE` | const |  |
| `QueuedController` | interface | A controller whose commands are pushed from outside (e.g. |
| `ReadonlyNumberArray` | type |  |
| `restoreSimulation` | function |  |
| `runScenario` | function |  |
| `SimBuilder` | interface |  |
| `SimConfig` | interface |  |
| `SimModule` | interface |  |
| `Simulation` | interface |  |
| `SpawnInit` | type |  |
| `SystemContext` | interface | The context a system / effect / command handler / snapshot builder sees. |
| `UnderConstruction` | component def |  |
| `VisibilityQuery` | type | Per-observer visibility predicate injected into snapshot channel builders (M5 fog): vision wires its layer query in app/; |
| `WriteView` | type |  |

## src/protocol/index.ts

| 名称 | 种类 | 说明 |
|---|---|---|
| `MainToWorker` | type |  |
| `MatchSetup` | type |  |
| `parseMatchSetup` | function |  |
| `RuntimeStats` | interface |  |
| `SPEED_STEPS` | const |  |
| `WorkerToMain` | type |  |
