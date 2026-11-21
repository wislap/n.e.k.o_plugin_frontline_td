# production

## 职责
建筑生产：按结构种类的配方把自身 CargoStore 中的输入货物转换为
输出货物，全部通过物流的 Consume/DepositIntent 结算。

## 公开接口
- `sim/index.ts`：`createProductionModule(db)`、`structureParts`
  （为带 `producer` 配方的结构注入 `Producer` 组件）。
- `protocol.ts`：`PRODUCTION_INSPECTOR_ID`（`frontline_td:production`）、
  `PRODUCTION_STATES`/`ProductionStateName` 与 `ProductionInspection`
  检查器契约类型。
- `content.ts`：`producerSchema`（`inputs`/`outputs` 货物表 +
  `time` 秒；loader 换成货物索引、milli 与 tick），以及两个可选
  字段：`producer.unitOutput`（替代 cargo 输出的单位产出表，按
  `cycle` 依次产出，产出时在内容指定的出口位置发
  `units.spawn` 意图）与 `producer.ramp`（`[{ atSeconds, seconds }]`
  阶梯表，取当前比赛 tick 之前最后一档作为生产周期；无 ramp
  时用 `time`）。无输入配方不消耗货物，也不要求挂靠/能量
  （虫巢等怪物建筑用）。
- 配方通过 `Producer.kind`（结构内容索引）从 db 查找，不按 ID
  字符串分支。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Producer { kind, progress, cycle }`（本模块写）；progress 为 tick
  计数，0 = 空闲；cycle 为 `unitOutput` 轮换索引。

## 不变量
- 系统每 tick 运行于 `construction` 阶段，排除 `UnderConstruction`；
  查询要求结构同时带 `CargoStore`。
- 空闲（progress = 0）：全部输入在自身 CargoStore 中足额，且每个
  输出货都有能装下的 export 槽时才开工——先按输入发出
  ConsumeIntent，然后 progress = 1。带 `unitOutput` 的配方完工时
  发 `SpawnIntent` 并推进 `cycle`。
- 运行中：progress + 1；到达 `timeTicks` 时按输出发出 DepositIntent
  并归零。intent 在下一物流结算时被扣/入账。
- 检查器汇报 producing / waiting_inputs（缺哪些货物索引）/
  output_full（"运不回去"）/ ready 四种状态。

## 对应设计
- [ADR 0025](../../../../docs/adr/0025-logistics-model.md)（物流
  模型）、[ADR 0030](../../../../docs/adr/0030-logistics-implementation.md)
  （实现约定）、[ADR 0035](../../../../docs/adr/0035-assault-mode-director-victory.md)
  （胜负判定的生产链路）、[ADR 0048](../../../../docs/adr/0048-interaction-modes-and-inspector-contract.md)
  （强类型 `ProductionInspection` 检查器契约）。
- [game_design.md §4.6](../../../../docs/design/game_design.md)
  （生产与补给节奏）。
