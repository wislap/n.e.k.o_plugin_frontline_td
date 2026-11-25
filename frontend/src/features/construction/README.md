# construction

## 职责
负责建筑的放置与生命周期：蓝图预订、放置校验、工地材料需求、
建造/拆除进度、取消退款、废料与废墟实体，以及开局建筑布置。

## 公开接口
- `sim/index.ts`：`createConstructionModule(db, terrain, logistics, opts)`；
  `opts` 注入 `structureParts`/`starts` 与可选 `segmentParts`/
  `healthBp`/`ruinParts`/`visible`；`structureStateOf` 读工地/废墟状态。
- `protocol.ts`：`PlaceCommand`/`ActivateCommand`/`CancelCommand`、
  `UpgradeLinksCommand`、`ConstructionCompleted` 事件（issuer 可见）、
  `StructuresChannel`/`SalvageChannel`/`RoadWorksChannel`、检查器
  契约与放置/等待原因码。
- `rules/`：`checkFootprint`/`checkRange`、`PlacementView` 与
  `makePlacementView`（幽灵预览与 eval 机器人共用）、拆除退款与
  取消选区分类等纯规则。
- `content.ts`：结构基础字段、`BUILD_CATEGORIES`、轮廓/图标声明。
- `render/`/`ui/`/`inspector`：`constructionSceneLayers`（ADR 0062
  场景层：Structures、结构 HP、RoadWorks、道路段 HP、Ghost、
  Exclusion）、BuildMenu、工地检查器。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Structure`、`Construction`、`Blueprint`、`Core`（只标在运营建筑上）。
- `Salvage`/`Ruin`/`RoadSegment`：spawn 挂载、归属本模块、无字段
  写者（ADR 0047）。
- kernel 契约 `UnderConstruction` 的写者；工地与建成建筑立即
  `setBlocked` 占地。
- 序列化状态：预订表（按阵营隔离）、`road_projects`。

## 不变量
- 命令先完整校验再改动；非法/他阵营 handle 跳过，全无效拒绝
  `no_targets`；已在拆除中的建筑再取消是空操作。
- 占地校验顺序：边界 → 地形/坡道 → 等高 → 动态占用 → 自身预订
  → 需求矿床；节点建筑另要求连通己方完工网络。
- 蓝图按 (orderTick, entity id) 激活；占格单位使放置拒绝
  `units_in_way` 并使激活保持等待。
- 建造进度受已交付材料封顶；完工移除 `UnderConstruction`，工地槽
  由物流结算重写为运营 `CargoStore`。
- 取消工地按已交付量退款；拆除生成废料 export 槽；`salvage`/
  `road_works` 通道仅观察者己方可见，`structures` 经注入的
  `VisibilityQuery` 过滤（ADR 0039）。
- 带 `capture` 档案的结构死亡生成 `Ruin`（无 `Faction`、占地保持
  封锁）；敌对运营 `exclusion` 结构周围禁建（`hostile_zone`）。
- 道路项目按上游→下游逐段施工；完工铺路，取消退已交付材料，
  已铺格不回滚。

## 对应设计
- [ADR 0012](../../../../docs/adr/0012-construction-as-entity.md)、
  [ADR 0029](../../../../docs/adr/0029-construction-implementation.md)、
  [ADR 0038](../../../../docs/adr/0038-outposts-ruins-capture-exclusion.md)、
  [ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)、
  [ADR 0040](../../../../docs/adr/0040-entity-id-reuse-component-reads.md)。
