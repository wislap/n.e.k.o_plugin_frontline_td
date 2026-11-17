# construction

## 职责
负责建筑的放置与生命周期：蓝图预订、放置校验、工地（site）材料需求、
建造/拆除进度、取消退款与废料（salvage）实体，以及开局建筑的布置。

## 公开接口
- `sim/index.ts`：`createConstructionModule(db, terrain, logistics,
  { structureParts, starts })`；`Structure`/`Construction`/`Blueprint`/
  `Salvage` 组件；`ConstructionModule`。
- `protocol.ts`：`PlaceCommand`/`ActivateCommand`/`CancelCommand`
  （activate/cancel 数组上限 256）、`UpgradeLinksCommand`
  （`links: [{a,b}]` 上限 64、`level`）、`ConstructionCompleted` 事件
  （issuer 可见）、`StructuresChannel`/`SalvageChannel`/
  `RoadWorksChannel`、放置与等待原因码（新增 `already_upgraded`）。
- `rules/placement.ts`：纯函数放置规则 `checkFootprint`/`checkRange`
  与 `PlacementView` 接口（供 sim 适配器与未来客户端预览适配器
  实现，不依赖 sim）；`rules/placement-view.ts` 是快照侧适配器
  `makePlacementView`，建造幽灵预览与 eval 机器人共用。
- `Core` 组件：只标在 operational 建筑上（site 期没有），供
  玩法模块判定胜负（ADR 0035）。
- `content.ts`：结构基础 schema（`id`、`footprint`）；`build` 等
  复合字段在 `content/` 中组装。

## 拥有的组件
- `Structure`（kind、左上角 x/y）；`Construction`（progress/total/
  mode：0 建造、1 拆除）；`Blueprint`（kind、x、y、activated、
  orderTick）；`Salvage` 标记；`RoadSegment`（project 索引）。
- 声明 `UnderConstruction` 的写者；工地与建成建筑立即
  `setBlocked` 其占地。

## 不变量
- 所有命令先完整校验再改动；非法/他阵营 handle 跳过，全无效时
  拒绝 `no_targets`；已在拆除中的建筑再次取消是空操作。
- 占地检查顺序：边界 → 静态地形/坡道 → 等高 → 动态占用 → 自身
  预订 → 需求矿床。
- 节点类建筑要求与己方完工网络的连通（沿用物流拓扑的环距离
  规则），非节点建筑要求中心点被覆盖；占地内任何阵营的 mover
  阻挡直接放置（`units_in_way`）并使蓝图激活保持等待。
- 蓝图激活顺序为 (orderTick, entity id)；等待原因：
  `not_covered`/`not_connected`/`occupied`/`reserved`/
  `units_in_way`/`terrain`。
- 建造进度受已交付材料封顶：`allowed = floor(total·delivered/
  required)`，每 tick 至多推进 1；完工时移除 `UnderConstruction`
  并把工地槽转换为运营存储（由注入的 `structureParts` 完成）。
- 取消工地按已交付量退款；拆除完成后生成废料（export 槽，
  `amt = 退款`、`cap = amt`、`since = tick + 1`，全零不生成），
  废料无 Health、不阻塞地形，export 槽全空后每周期清理。
- 预订表按阵营隔离并可序列化（`builder.state`）；蓝图仅出现在
  观察者自身快照通道中。
- 道路项目（`upgrade_links`）按上游（仓库侧）→ 下游顺序逐段施工，
  每段 `segmentCells` 格：段实体带 `Construction`/`RoadSegment` 与
  注入的物流工地槽 + `FixedAttach`、战斗部件；无 `Structure`、不
  阻塞地形。完工铺路后 despawn 并接棒下一段；取消退已交付材料为
  废料，被毁材料损失，已铺格不回滚。项目状态可序列化。
- `hpBp` 由注入的战斗读数提供（默认满血）。

## 对应设计章节
- docs/adr/0012（命令）、0023（拆除）、0029（建造实现约定）。
