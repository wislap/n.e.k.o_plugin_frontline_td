# production

## 职责
建筑生产：按结构种类的配方把输入货物转换为输出货物或轮换生成单位；货物经物流
`ConsumeIntent`/`DepositIntent` 结算，单位产出经 `SpawnIntent` 转交 units 生成。

## 公开接口
- `sim/index.ts`：`createProductionModule(db)`、`structureParts`
  （为带 `producer` 配方的结构注入 `Producer`）。
- `protocol.ts`：`PRODUCTION_INSPECTOR_ID`（`frontline_td:production`）与
  `PRODUCTION_STATES`/`ProductionInspection`/`ProductionStateName` 契约类型。
- `ui/`：`ProductionSection`（ADR 0062：检视器生产小节，供 construction 的
  `own_structure` 视图引用）。
- `content.ts`：`producerSchema`（`inputs`/`outputs` + `time` 秒；可选
  `unitOutput` 单位产出轮换表与按对局时间生效的 `ramp` 阶梯周期表；支持如虫巢
  `hive` 的无输入配方）。
- 导出全表见 [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Producer { kind, progress, cycle }`（本模块 `claimWriter` 拥有并写入）；
  `progress` 为 0 表示空闲，`cycle` 为 `unitOutput` 轮换索引。

## 不变量
- 系统每 tick 运行于 `construction` 阶段，排除 `UnderConstruction`（查询实体
  同时带 `Producer`、`InWorld` 与 `CargoStore`）。
- 无输入配方（如 `hive`）不消耗货物、内容无需配置 `stores`（由物流结构部件
  补空 `CargoStore`）或物流接入即可持续运转；有输入配方须全部输入足额且每个输出
  货物都有余量足够的 export 槽才开工（先发 `ConsumeIntent` 再推进）。
- 产出分两类：货物产出完工时发 `DepositIntent`，于下一 tick `logistics.resolve`
  （每 tick 结算，非周期分配拍）入账；单位产出完工时按 `cycle` 发 `SpawnIntent`
  （含南缘出口偏移），于同 tick `capture_fog` 阶段由 units 生成并推进 `cycle`。
- 配方经 `Producer.kind` 内容索引查 db，不按 ID 字符串分支；`ramp` 取当前已
  生效的最新阶梯周期。
- 检查器汇报 `producing` / `waiting_inputs` / `output_full` / `ready` 四种
  状态及下一待产单位。

## 对应设计
- [ADR 0025](../../../../docs/adr/0025-logistics-model.md)、
  [ADR 0030](../../../../docs/adr/0030-logistics-implementation.md)、
  [ADR 0035](../../../../docs/adr/0035-assault-mode-director-victory.md)、
  [ADR 0048](../../../../docs/adr/0048-interaction-modes-and-inspector-contract.md)、
  [ADR 0062](../../../../docs/adr/0062-client-contribution-registry.md)。
- [game_design.md §4.6](../../../../docs/design/game_design.md#46-生产)。
