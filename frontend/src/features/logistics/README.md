# logistics

## 职责
按阵营维护物流网络：拓扑推导（节点、链路、覆盖）、车辆运力分配、
资源运输（外发/回收）、供应状态（能量档位）与检查器。

## 公开接口
- `sim/index.ts`：`createLogisticsModule(db, terrain, opts)`（`starts`、
  可选 `healthBp`）；`unitParts`/`structureParts`/`roadSegmentParts`
  生成部件；`LogisticsModule`（`blockersChanged`、`pave`、
  `linkPath`、`covered`、`connectsToNetwork`、`energyBp`、`stockOf`）。
- `protocol.ts`：`SetPrioritiesCommand`、`ConsumeIntent`/`DepositIntent`
  （`frontline_td:logistics.consume` / `.deposit`，负载
  `{ handle, cargo, amount }`，cargo 为货物注册表索引）、
  货类名/码、unmet 原因码、`LogisticsNetworkChannel`、
  `ROAD_LAYER_ID` 网格层。
- `content.ts`：货物、store、node 与全局物流配置的内容 schema
  （含 `roadLevels`、`segmentCells`、`corridorWidth`）、
  `lowestBuildableRoadLevel`（客户端预览与下单共用）。
- `render/`：`LogisticsOverlay`/`RoadLayer`/`RoadToolLayer`；
  `ui/`：`StockPanel`/`RoadPanel`；检查器（节点/链路/存储）。
  导出全表见 [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `LogisticsNode`（footprint、connect、service、vehicles、warehouse，
  归属本模块）、`CargoStore`（4 槽：cargo/cap/amt/cls/flags/since/
  rate/unmet）、`SiteStore { kind: u16 }`（工地槽，本模块写）。
- `EnergyLow`/`EnergyEmpty` 修改器组件；`FixedAttach`（固定挂载
  node+gen+lastMile，道路工地用）、`Interceptor`（拦截强度 bp，
  由单位内容注入）——spawn 挂载、归属本模块、无字段写者
  （ADR 0047）。
- 网格层：全局 u8 道路层 `frontline_td:logistics.road`（0 土路，
  ≥1 等级）、按阵营 `frontline_td:logistics.service`（覆盖位图）。
- 序列化状态：`frontline_td:logistics.state`、`frontline_td:logistics.roads`。

## 不变量
- 分配每 1 秒（cycleTicks）运行一次：先 rate，再 outbound、reserve、
  inbound、供应状态与利用率记账。
- 路径付费方为上游节点（outbound 近端、inbound 远端）；带宽
  `qMax(R,L,load,m)=floor(R·load·m/(2L·10000))`——R 为剩余预算，
  L 为链路长度，load 为车辆载货量（milli），m 为有效道路倍率
  （10000 bp = 1×），10000 同样为 bp 定点分母。
- 预算树每周期每方向各一棵，仅当付费节点预算归零时重建，与逐次
  重建结果一致（测试覆盖）。
- `since` 存 `tick + 1`，0 表示"无"；生成时未满的非 export 槽从
  出生即为开放需求。
- export 槽也写 unmet 原因码，网络通道把 unmet（需求）与
  unmetExport（回收）分开统计。
- 链路利用率按实际付费方全额预算折算 bp；付费方剩余预算 ≤1% 且
  该方向有流量时对应 `outSat`/`inSat` 置 1。
- 派生拓扑不序列化；节点集合变化、地形阻挡变化与读档触发懒重建；
  链路折线只含合法前驱步（不跨越悬崖或阻挡边）。
- 道路只改链路有效倍率，不改拓扑：搜索与 connect 判定始终用地形
  步进代价。有效倍率 `m = floor(cost·10000 / Σ step_k·10000/m(cell))`
  （步进代价记在目标格上），只在道路版本或拓扑变化时重算。
- 走廊拦截：每周期按敌对 `Interceptor` 单位到链路折线任一格中心
  距离 ≤ `corridorWidth`（含包围盒预筛）求和 strengthBp，配额系数
  `max(0, 10000 − Σ)`；unmet 仍为 `no_capacity`，链路在快照中记
  `intercept` bp。
- `pave` 只升不降并推路层版本；`linkPath` 返回 `LinkPath`（上游
  仓库侧 → 下游的折线格、逐格累计代价、逐格当前道路等级、上游
  节点与两端节点 id）；工地段用的 `FixedAttach` 初始值由内部
  `fixedAttachInit` 另行计算。
- 数量用整数 milli 单位；运力与原因码用核心整数辅助函数。
- 道路工具的选择存规范化端点句柄对 `RoadLinkKey`，不存链路下标；
  每帧和下单时再解析为当前下标（ADR 0045）。

## 对应设计
- [ADR 0025](../../../../docs/adr/0025-logistics-model.md)（模型）、
  [ADR 0030](../../../../docs/adr/0030-logistics-implementation.md)
  （实现约定）；[architecture.md §6.11](../../../../docs/design/architecture.md)
  （modifiers）。
- [ADR 0013](../../../../docs/adr/0013-modifier-pipeline.md)（修正
  值）、[ADR 0043](../../../../docs/adr/0043-review-remediation.md)
  （工地槽结算归物流）。
