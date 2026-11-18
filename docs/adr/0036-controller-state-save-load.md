# 0036. 控制者状态与存档

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-17
- 决策者：wislap
- 批次：M4 MVP 收尾
- 领域：模拟

## 背景

ADR 0026 定下「可序列化状态 + 哈希」的存档模型，但
`Controller` 的私有状态当时没有归口：M4 的导演把 phase、
小队 id、`launchTick` 等放在闭包里，存档/恢复后行为分叉；
eval 机器人有同样问题。同时 M4 的对拍测试抓出第二个潜伏
bug：`serialize()` 的输出并不是独立副本。

## 决策

### 控制者存档

- `Controller` 增加可选 `save(): Serializable` /
  `load(data): void`。kernel 把控制者状态写进存档
  `controllerStates`，按 faction 升序排列，并入状态哈希；
  恢复时在第一次 step 之前对号入座调 `load`。
- **规则**：实现 `save`/`load` 的控制者不得把任何可变状态
  留在它们之外（闭包、模块级变量都不许）。已写入
  AGENTS.md。
- `QueuedController`（玩家本地输入队列）有意**不**实现——
  队列是瞬态外部输入，不是模拟状态；恢复由外部重新喂
  命令（回放路径同样不受影响：回放不挂控制者）。

### `serialize()` 深拷贝（`copySerializable`）

- 发现：模块 `save()` 钩子（物流 `states` 的 `stock`、`unmet`
  等数组）、事件/意图通道条目、调度队列 `params`、
  `controller.save()`、命令日志 `payload` 都按引用进存档——
  源模拟继续跑会污染已生成的存档对象；先 `serialize()` 再
  继续跑源模拟、之后 `restoreSimulation`，恢复出的模拟在
  下一 tick 即分叉（物流 `cargo_store` 数值对不上）。
- 修复：`kernel/serialize.ts` 增加 `copySerializable`
  （数组/对象/类型化数组递归拷贝），对上述每一处入存档
  的值做深拷贝。哈希不变——字节内容相同，只是脱钩。
- 这条同时是契约：**调用方拿到的 `serialize()` 结果是可
  独立持有、可跨 Worker 传输的副本**。

## 后果

- 导演、四个 eval 机器人、测试用有状态控制者全部经
  `save`/`load` 往返；`resolveSetup` 的 `Resolved` 带上
  `config` + `modules` 供 `restoreSimulation` 换新实例恢复。
- 评测新增确定性测试：`resolveSetup` 两次逐 tick 同哈希；
  90 s 存档 → 全新 `resolveSetup` 恢复 → 终态同哈希。
- 本 ADR 细化 ADR 0026 的存档口径（不修改原文）。
