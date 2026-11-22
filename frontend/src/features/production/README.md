# production

## 职责
建筑生产：按结构种类的配方把自身 CargoStore 中的输入货物转换为
输出货物，全部通过物流的 Consume/DepositIntent 结算。

## 公开接口
- `sim/index.ts`：`createProductionModule(db)`、`structureParts`
  （为带 `producer` 配方的结构注入 `Producer`）。
- `protocol.ts`：检查器 ID 与 `PRODUCTION_STATES`/
  `ProductionInspection` 契约类型。
- `content.ts`：`producerSchema`（`inputs`/`outputs` + `time` 秒；
  可选 `unitOutput` 单位产出表（按 `cycle` 轮换，完工在内容出口
  发 `units.spawn`）与 `ramp` 阶梯周期表）。无输入配方不消耗货物
  （虫巢等怪物建筑用）。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Producer { kind, progress, cycle }`（本模块写）；progress 为 tick
  计数，0 = 空闲；cycle 为 `unitOutput` 轮换索引。

## 不变量
- 系统每 tick 运行于 `construction` 阶段，排除 `UnderConstruction`；
  查询要求结构同时带 `CargoStore`。
- 开工条件：全部输入足额且每个输出货都有能装下的 export 槽；
  先按输入发出 ConsumeIntent 再推进。
- 完工按输出发出 DepositIntent（或 `SpawnIntent` + cycle 推进）；
  intent 在下一物流结算时入账。
- 配方经 `Producer.kind` 内容索引查 db，不按 ID 字符串分支。
- 检查器汇报 producing / waiting_inputs / output_full / ready 四种
  状态。

## 对应设计
- [ADR 0025](../../../../docs/adr/0025-logistics-model.md)、
  [ADR 0030](../../../../docs/adr/0030-logistics-implementation.md)、
  [ADR 0035](../../../../docs/adr/0035-assault-mode-director-victory.md)、
  [ADR 0048](../../../../docs/adr/0048-interaction-modes-and-inspector-contract.md)。
- [game_design.md §4.6](../../../../docs/design/game_design.md)
  （生产节奏）。
