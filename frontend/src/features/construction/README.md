# construction

## 职责
负责建筑的放置与生命周期：蓝图预订、放置校验、工地（site）材料需求、
建造/拆除进度、取消退款与废料（salvage）实体，以及开局建筑的布置。

## 公开接口
- `sim/index.ts`：`createConstructionModule(db, terrain, logistics, opts)`；
  `opts` 含注入的 `structureParts`（`StructurePartsFn`）、`starts`、
  可选 `segmentParts`/`healthBp`/`ruinParts`/`visible`；
  `structureStateOf` 读工地/废墟状态。
- `protocol.ts`：`PlaceCommand`/`ActivateCommand`/`CancelCommand`
  （activate/cancel 数组上限 256）、`UpgradeLinksCommand`
  （`links: [{a,b}]` 上限 64、`level`）、`ConstructionCompleted` 事件
  （issuer 可见）、`StructuresChannel`/`SalvageChannel`/
  `RoadWorksChannel`。
- `rules/`：`checkFootprint`/`checkRange` 与 `PlacementView` 纯放置
  规则（不依赖 sim）；`makePlacementView` 快照侧适配器，建造幽灵
  预览与 eval 机器人共用。放置/等待原因码在这里定义。
- `render/`/`ui/`/`inspector`：建造幽灵与废墟覆盖、`BuildMenu`、
  工地检查器。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Structure`（kind、左上角 x/y）；`Construction`（progress/total/
  mode：0 建造、1 拆除）；`Blueprint`（kind、x、y、activated、
  orderTick）；`Core`（只标在 operational 建筑上，供胜负判定）。
- `Salvage`、`Ruin`、`RoadSegment`（project 索引）：spawn 时挂载，
  归属本模块、无字段写者（ADR 0047）。
- 声明 kernel 契约 `UnderConstruction` 的写者；工地与建成建筑立即
  `setBlocked` 其占地。
- 序列化状态：预订表（按阵营隔离）、`road_projects`。

## 不变量
- 所有命令先完整校验再改动；非法/他阵营 handle 跳过，全无效时
  拒绝 `no_targets`；已在拆除中的建筑再次取消是空操作。
- 占地检查顺序：边界 → 静态地形/坡道 → 等高 → 动态占用 → 自身
  预订 → 需求矿床。
- 节点类建筑要求与己方完工网络的连通（沿用物流拓扑的环距离
  规则），非节点建筑要求中心点被覆盖；占地内任何阵营的 mover
  阻挡直接放置（`units_in_way`）并使蓝图激活保持等待。
- 蓝图激活顺序为 (orderTick, entity id)；等待原因：
  `not_covered`/`hostile_zone`/`not_connected`/`occupied`/
  `reserved`/`units_in_way`/`terrain`。
- 建造进度受已交付材料封顶：`allowed = floor(total·delivered/
  required)`，每 tick 至多推进 1；完工时移除 `UnderConstruction`，
  由 logistics 的工地槽结算（查询 `[SiteStore]` 且排除
  `[UnderConstruction]`）重写 `CargoStore` 并移除 `SiteStore`。
- 取消工地按已交付量退款；拆除完成后生成废料（export 槽，
  `amt = 退款`、`cap = amt`、`since = tick + 1`，全零不生成），
  废料无 Health、不阻塞地形，export 槽全空后每周期清理。
- 预订表按阵营隔离并可序列化（`builder.state`）。`structures`
  通道经注入的 `VisibilityQuery` 过滤（`app/` 接 vision.api，ADR
  0039）；`salvage`/`road_works` 通道仅观察者己方可见，不接
  VisibilityQuery。
- 废墟与禁建区（ADR 0038）：带 `capture` 档案的结构死亡时生成
  `Ruin` 实体（`Structure + Ruin + InWorld + Position`，无
  `Faction`，占地保持封锁，通道 `STATE_RUIN`）；
  `capture.completed` 事件触发下一 tick 的重建工地（工期 =
  `rebuildTicks`，纯时间）。`checkRange` 的 `hostile_zone`：运营中
  的敌对 `exclusion` 结构以占地中心为圆心禁建。
- 道路项目（`upgrade_links`）按上游（仓库侧）→ 下游顺序逐段施工，
  每段 `segmentCells` 格：段实体带 `Construction`/`RoadSegment` 与
  注入的物流工地槽 + `FixedAttach`、战斗部件；无 `Structure`、不
  阻塞地形。完工铺路后 despawn 并接棒下一段；取消退已交付材料为
  废料，被毁材料损失，已铺格不回滚。项目状态可序列化。
- `hpBp` 由注入的战斗读数提供（默认满血）。

## 对应设计
- [ADR 0012](../../../../docs/adr/0012-construction-as-entity.md)
  （命令模型）、[ADR 0023](../../../../docs/adr/0023-grid-layers-groups-commands-rng-runtime-limits.md)
  （拆除约定）、[ADR 0029](../../../../docs/adr/0029-construction-implementation.md)
  （建造实现约定）、[ADR 0035](../../../../docs/adr/0035-assault-mode-director-victory.md)
  （Core 与胜负判定）、[ADR 0038](../../../../docs/adr/0038-outposts-ruins-capture-exclusion.md)
  （废墟与禁建区）。
- [ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)（通道
  可见性）、[ADR 0040](../../../../docs/adr/0040-entity-id-reuse-component-reads.md)
  （句柄校验）、[ADR 0043](../../../../docs/adr/0043-review-remediation.md)
  （注入部件工厂）。
