# logistics

## 职责
按阵营维护物流网络：拓扑推导（节点、链路、覆盖）、车辆运力分配、
资源运输（外发/回收）、供应状态（能量档位）与检查器。

## 公开接口
- `sim/index.ts`：`createLogisticsModule(db, terrain, opts)`（`starts`、
  可选 `healthBp`）；`unitParts`/`structureParts`/`roadSegmentParts`；
  `LogisticsModule`（`blockersChanged`、`pave`、`linkPath`、
  `covered`、`connectsToNetwork`、`energyBp`、`stockOf`）。
- `protocol.ts`：`SetPrioritiesCommand`、`ConsumeIntent`/
  `DepositIntent`、unmet 原因码、`LogisticsNetworkChannel`、
  `ROAD_LAYER_ID` 与检查器契约类型。
- `content.ts`：货物、store、node 与全局配置 schema（`roadLevels`
  等）、`lowestBuildableRoadLevel`（预览与下单共用）。
- `render/`：LogisticsOverlay（全图 DataTexture 服务覆盖层）/
  RoadLayer/RoadToolLayer；`ui/`：StockPanel/RoadPanel 与道路选择
  辅助；检查器（节点/链路/存储）。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `LogisticsNode`、`CargoStore`、`SiteStore { kind: u16 }`（工地槽，
  本模块写）；`EnergyLow`/`EnergyEmpty` 修改器。
- `FixedAttach`（道路工地）、`Interceptor`（拦截强度）——spawn
  挂载、归属本模块、无字段写者（ADR 0047）。
- 网格层：`frontline_td:logistics.road`（全局 u8 道路等级）、
  `frontline_td:logistics.service`（按阵营覆盖位图）。
- 序列化状态：`frontline_td:logistics.state`、
  `frontline_td:logistics.roads`。

## 不变量
- 分配每 cycleTicks 运行一次：rate → outbound → reserve → inbound
  → 供应状态与利用率记账。
- 每方向付费方为上游节点（outbound 近端、inbound 远端）；带宽与
  利用率以 bp 定点记账，付费方预算耗尽触发预算树重建。
- `since` 存 `tick + 1`，0 表示"无"；export 槽也写 unmet 原因码，
  需求与回收分开统计。
- 派生拓扑不序列化；节点集合、地形阻挡与读档触发懒重建；链路
  折线不含跨越悬崖/阻挡的步。
- 道路只改链路有效倍率不改拓扑；`pave` 只升不降并推路层版本；
  `linkPath` 返回上游→下游折线与逐格数据。
- 道路工具的选择存规范化端点句柄对 `RoadLinkKey`，渲染/下单时
  再解析为当前链路下标（ADR 0045）。
- 数量用整数 milli；工地槽结算在结构完工时把 `SiteStore` 重写为
  运营 `CargoStore`（排除 `UnderConstruction` 查询）。

## 对应设计
- [ADR 0025](../../../../docs/adr/0025-logistics-model.md)、
  [ADR 0030](../../../../docs/adr/0030-logistics-implementation.md)、
  [ADR 0013](../../../../docs/adr/0013-modifier-pipeline.md)、
  [ADR 0043](../../../../docs/adr/0043-review-remediation.md)。
- [architecture.md §6.11](../../../../docs/design/architecture.md)
  （modifiers）。
