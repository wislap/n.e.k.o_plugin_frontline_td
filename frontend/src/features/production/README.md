# production

## 职责
建筑生产：按结构种类的配方把自身 CargoStore 中的输入货物转换为
输出货物，全部通过物流的 Consume/DepositIntent 结算。

## 公开接口
- `sim/index.ts`：`createProductionModule(db)`、`structureParts`
  （为带 `producer` 配方的结构注入 `Producer` 组件）、`Producer`。
- `content.ts`：`producerSchema`（`inputs`/`outputs` 货物表 +
  `time` 秒；loader 换成货物索引、milli 与 tick）。
- 配方通过 `Producer.kind`（结构内容索引）从 db 查找，不按 ID
  字符串分支。

## 拥有的组件
- `Producer { kind, progress }`；progress 为 tick 计数，0 = 空闲。

## 不变量
- 系统每 tick 运行于 `construction` 阶段，排除 `UnderConstruction`。
- 空闲（progress = 0）：全部输入在自身 CargoStore 中足额，且每个
  输出货都有能装下的 export 槽时才开工——先按输入发出
  ConsumeIntent，然后 progress = 1。
- 运行中：progress + 1；到达 `timeTicks` 时按输出发出 DepositIntent
  并归零。intent 在下一物流结算时被扣/入账。
- 检查器汇报 producing / waiting_inputs（缺哪些货物索引）/
  output_full（"运不回去"）。

## 对应设计章节
- `.plans/m3.md` 的 M3-C。
