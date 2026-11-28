# logistics

## 职责
按阵营维护物流网络：拓扑推导（节点、链路、覆盖）、每 tick 意图结算与工地转正、
车辆运力分配、资源运输（外发/回收）、供应状态（能量档位）与检查器。

## 公开接口
- `sim/index.ts`：`createLogisticsModule(db, terrain, opts)`（`starts`、
  可选 `healthBp`）；`unitParts`/`structureParts`/`roadSegmentParts`/
  `exportStoreInit`；`LogisticsModule`（`blockersChanged`、`pave`、
  `linkPath`、`covered`、`connectsToNetwork`、`energyBp`、`stockOf`）。
- `protocol.ts`：`SetPrioritiesCommand`、`ConsumeIntent`/`DepositIntent`、
  unmet 原因码、`LogisticsNetworkChannel`、`ROAD_LAYER_ID`、
  `SERVICE_LAYER_ID`、`LOGISTICS_INSPECTOR_ID`（`frontline_td:logistics`）
  与检查器契约。
- `content.ts`：货物、store、node 与全局配置 schema（`roadLevels` 等）、
  `lowestBuildableRoadLevel`（预览与下单共用）。
- `render/`：`logisticsSceneLayers`（ADR 0062 场景层：RoadLayer、
  LogisticsOverlay 经共享 `CoverUniforms` + 着色器 `ftdCoverApply` 渲染
  服务覆盖与链路/范围环、RoadToolLayer）。
- `ui/`：`logisticsHudPanels`（ADR 0062：StockPanel/RoadPanel）、
  `logisticsCanvasIntents`（`road.click`）、`logisticsMinimapRasters`、
  `LogisticsSection`（检视器小节，覆盖节点/货物槽与道路工地，不单设逐链路
  检视）、道路工具 store 与选路/下单辅助（经 `client/link-flow` 读平滑流量）。
- 导出全表见 [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `CargoStore`、`SiteStore { kind: u16 }`、`EnergyLow`/`EnergyEmpty`
  修改器：由本模块经 `claimWriter` 拥有并写入。
- `LogisticsNode`、`Interceptor`、`FixedAttach`：spawn 挂载、经
  `ownComponent` 声明归属本模块、无字段写者（写者 `—`，ADR 0047）。
- 网格层：`frontline_td:logistics.road`（全局 u8 道路等级）、
  `frontline_td:logistics.service`（按阵营覆盖位图）。
- 序列化状态：`frontline_td:logistics.state`、`frontline_td:logistics.roads`。

## 不变量
- `logistics.resolve` 在 `logistics` 阶段每 tick 运行：先结算
  `ConsumeIntent`/`DepositIntent`（结果钳制在 `[0, capacity]`），再将已移除
  `UnderConstruction` 的 `SiteStore` 重写为运营 `CargoStore`。
- `logistics.allocate` 按周期拍在 `logistics` 阶段运行：按需重建拓扑并刷新
  道路倍率后，按速率 → 外发 → 储备回退 → 回收 → 供应状态与利用率记账顺序结算。
- 每方向付费方为上游节点（外发近端、回收远端）；带宽与利用率以基点定点记账，
  付费方预算耗尽触发预算树重建。
- `since` 以正值记录首次缺货拍、0 表示无；export 槽也写 unmet 原因码，
  需求与回收分开统计；数量统一用整数 milli。
- 派生拓扑不序列化；阻挡变更后于下一分配拍懒惰重算受影响连通网（含节点集合
  变化与读档触发）；链路折线不含跨越悬崖或阻挡的步。
- 道路只改链路有效倍率不改拓扑；`pave` 只升不降并在 `capture_fog` 镜像路层；
  道路工具选择存规范化 `RoadLinkKey`，渲染/下单时再解析为当前下标（ADR 0045）。

## 对应设计
- [ADR 0013](../../../../docs/adr/0013-modifier-pipeline.md)、
  [ADR 0025](../../../../docs/adr/0025-logistics-model.md)、
  [ADR 0030](../../../../docs/adr/0030-logistics-implementation.md)、
  [ADR 0043](../../../../docs/adr/0043-review-remediation.md)、
  [ADR 0045](../../../../docs/adr/0045-second-review-conventions.md)、
  [ADR 0047](../../../../docs/adr/0047-component-ownership-manifest.md)、
  [ADR 0062](../../../../docs/adr/0062-client-contribution-registry.md)、
  [ADR 0063](../../../../docs/adr/0063-field-visual-pipeline-hud-and-camera-evolution.md)。
- [game_design.md §4.5](../../../../docs/design/game_design.md#45-物流与补给整个游戏的主轴)、
  [architecture.md §6.11](../../../../docs/design/architecture.md#611-修正值管线)。
