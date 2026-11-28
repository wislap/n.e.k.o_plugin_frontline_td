# construction

## 职责
负责建筑与道路工程的放置与生命周期：蓝图预订、放置校验、工地材料需求、
建造/拆除进度、取消退款、废料与废墟实体、`UpgradeLinksCommand` 链路升级项目
与 `RoadSegment` 分段施工，以及开局建筑布置。

## 公开接口
- `sim/index.ts`：`createConstructionModule(db, terrain, logistics, opts)`
  （`opts` 注入 `structureParts`/`starts` 与可选 `segmentParts`/`healthBp`/
  `ruinParts`/`visible`）；`structureStateOf` 读工地/废墟状态；`Structure`/`Core`。
- `protocol.ts`：`PlaceCommand`/`ActivateCommand`/`CancelCommand`/
  `UpgradeLinksCommand`、`ConstructionCompleted`（issuer 可见）、
  `StructuresChannel`/`SalvageChannel`/`RoadWorksChannel`
  （`frontline_td:construction.roadworks`）、`CONSTRUCTION_INSPECTOR_ID` 与状态码。
- `rules/index.ts`：`checkFootprint`/`checkRange`、`FOOTPRINT_CODES`/
  `RANGE_CODES`、`PlacementView`/`makePlacementView`（幽灵预览与 eval 共用）、
  `classifyCancelSelection`/`demolishRefund` 等纯规则。
- `content.ts`：结构基础字段、`BUILD_CATEGORIES`、
  `STRUCTURE_SILHOUETTES`/`STRUCTURE_GLYPHS`。
- `render/index.ts`：`constructionSceneLayers`（ADR 0062 场景层：Structures、
  结构 HP、RoadWorks、道路段 HP、Ghost、Exclusion）、`renderStructureThumbnails`
  （BuildMenu 离线 3D 缩略图，由 `app/` 注入）。
- `ui/index.tsx`：`createConstructionHudPanels`（ADR 0062：BuildMenu）、
  `constructionInspectorSubjects`（`own_structure`、`hostile_structure`、
  `salvage` 支持 `inspects: true`、`road_segment`）、`constructionCanvasIntents`
  （`build.place`/`demolish.click`）、`constructionMinimapMarks`、
  `subscribeGhostSync`、`findOwnStructureAt`/`pickDemolishableByRay`。
- 导出全表见 [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Structure`、`Construction`、`Blueprint`、`Core`（只标在运营建筑上）：
  本模块 `claimWriter` 拥有并写入。
- `Salvage`/`Ruin`/`RoadSegment`：spawn 挂载、经 `ownComponent` 声明归属
  本模块、无字段写者（ADR 0047）。
- kernel 契约 `UnderConstruction` 的写者；工地与建成建筑立即 `setBlocked` 占地。
- 序列化状态：`frontline_td:construction.reservations`（按阵营隔离）、
  `frontline_td:construction.road_projects`。

## 不变量
- 所有命令先完整校验再改动，非法或他阵营句柄跳过；`CancelCommand` 对已在
  拆除中或同 tick 已排队的实体跳过，全无效时拒绝 `no_targets`。
- 占地校验顺序：边界 → 地形/坡道 → 等高 → 动态占用 → 自身预订 → 需求矿床；
  节点建筑另要求连通己方完工网络。
- 蓝图放置只验占地并写预订，延后 `checkRange` 至激活排期时校验；占格单位使
  直接放置拒绝 `units_in_way` 并使激活保持等待（等待原因含 `not_covered`/
  `not_connected`/`hostile_zone`/`occupied`/`reserved`/`units_in_way`/`terrain`）。
- 建造进度受已交付材料封顶；完工移除 `UnderConstruction`，工地槽由物流结算
  重写为运营 `CargoStore`。
- 取消工地按已交付量退款、拆除生成废料 export 槽；`salvage`/
  `frontline_td:construction.roadworks` 仅观察者己方可见，`structures` 经注入
  `VisibilityQuery` 过滤（ADR 0039）。
- 带 `capture` 档案的结构死亡生成 `Ruin`（无 `Faction`、占地保持封锁）；敌对
  运营 `exclusion` 结构周围禁建（`hostile_zone`）。
- `UpgradeLinksCommand` 校验等级与己方链路、跳过重复与已达标格并拒绝空批；
  道路项目按上游→下游逐段施工，完工铺路，取消退已交付材料进 `Salvage`
  （已铺格不回滚），战毁 `RoadSegment` 终止项目且不掉废料。

## 对应设计
- [ADR 0012](../../../../docs/adr/0012-construction-as-entity.md)、
  [ADR 0029](../../../../docs/adr/0029-construction-implementation.md)、
  [ADR 0038](../../../../docs/adr/0038-outposts-ruins-capture-exclusion.md)、
  [ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)、
  [ADR 0040](../../../../docs/adr/0040-entity-id-reuse-component-reads.md)、
  [ADR 0047](../../../../docs/adr/0047-component-ownership-manifest.md)、
  [ADR 0062](../../../../docs/adr/0062-client-contribution-registry.md)、
  [ADR 0063](../../../../docs/adr/0063-field-visual-pipeline-hud-and-camera-evolution.md)。
- [architecture.md §6.10](../../../../docs/design/architecture.md#610-建造)、
  [game_design.md §4.8](../../../../docs/design/game_design.md#48-防御建筑)。
