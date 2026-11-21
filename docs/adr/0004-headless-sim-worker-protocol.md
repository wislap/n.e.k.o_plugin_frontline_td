# 0004. 无头模拟核心、Worker 与命令 / 快照 / 事件协议

- 状态：已采纳
- 实现：部分（缺：事件流不按观察者过滤，以 all 下发，客户端只在表现层隐藏，见 ADR 0039）
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：架构

## 背景

模拟层需要与渲染、UI 解耦，使规则可测试、可复现，并为将来的 lockstep 联机留余地（[architecture.md §3.2、§6.1](../design/architecture.md)）。

## 决策

- 模拟层是无头游戏核心：不依赖画面、DOM、React、three、zustand；对外只有"命令进，快照 / 事件出"两个口（[§6.1](../design/architecture.md)）。
- 模拟跑在 Web Worker，从第一天起；测试直接调用 sim，不经 Worker，只有一套运行实现（[§5、§10](../design/architecture.md)）。
- 命令带 tick 编号，在下一个 tick 边界生效；暂停与变速是运行时状态，不进命令日志（[§6.5](../design/architecture.md)）。
- 协议通道由各功能在自己的 `protocol.ts` 定义，`protocol/` 只负责拼装：新增功能 = 新增通道，不改共用大类型（[§6.6](../design/architecture.md)）。
- 快照分三类：每 tick 稠密快照（TypedArray，transfer 零拷贝）、事件流、低频 / 变更时发送的摘要与网格层；快照只包含玩家可见的内容（区分真实状态与玩家已知状态）。
- 模拟状态必须始终可完整序列化，保证以后加存档只涉及 UI 与存储层（[§3.7](../design/architecture.md)）。

### 待定事项

- 局外进度与存档位置（浏览器存储 / 插件数据目录）：以后再定（[§13](../design/architecture.md)）。

## 后果

- 渲染与 UI 是模拟层的观察者和输入设备；模拟层不知道画面存在。
- Worker 调试成本高，需要调试面板直接查看 Worker 内实体与系统耗时（[§14](../design/architecture.md)）。

## 相关

- [architecture.md §6.1、§6.5、§6.6](../design/architecture.md)
- [ADR 0005](0005-fixed-timestep-speed-pause.md)、[ADR 0006](0006-determinism.md)
