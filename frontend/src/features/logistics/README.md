# logistics

## 职责
按阵营维护物流网络：拓扑推导（节点、链路、覆盖）、车辆运力分配、
资源运输（外发/回收）、供应状态（能量档位）与检查器。

## 公开接口
- `sim/index.ts`：`createLogisticsModule(db, terrain, opts)`（`starts`、
  可选 `healthBp`）、`LogisticsNode`/`CargoStore`/`SiteStore` 组件、
  `unitParts`/`structureParts` 生成部件、`LogisticsModule`（`markTopologyDirty`）。
- `protocol.ts`：`SetPrioritiesCommand`、`ConsumeIntent`/`DepositIntent`
  （`frontline_td:logistics.consume` / `.deposit`，负载
  `{ handle, cargo, amount }`，cargo 为货物注册表索引）、
  货类名/码、unmet 原因码、`LogisticsNetworkChannel`。
- `content.ts`：货物、store、node 与全局物流配置的内容 schema。

## 拥有的组件
- `LogisticsNode`（footprint、connect、service、vehicles、warehouse）；
- `CargoStore`（4 槽：cargo/cap/amt/cls/flags/since/rate/unmet）；
- `SiteStore` 标记；`EnergyLow`/`EnergyEmpty` 修改器组件。

## 不变量
- 分配每 1 秒（cycleTicks）运行一次：先 rate，再 outbound、reserve、
  inbound、供应状态与利用率记账。
- 路径付费方为上游节点（outbound 近端、inbound 远端）；带宽
  `qMax(B,L,load,m)=B·load·m/(2L·m)`。
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
- 数量用整数 milli 单位；运力与原因码用核心整数辅助函数。

## 对应设计章节
- `.plans/m3.md` 的 M3-B1；docs/design/architecture.md §6.11（modifiers）。
