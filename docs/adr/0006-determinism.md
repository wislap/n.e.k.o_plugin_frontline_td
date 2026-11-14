# 0006. 确定性

- 状态：已采纳
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：模拟

## 背景

bug 需要可用"种子 + 命令序列"复现；将来的 lockstep 联机也要求确定性。CI 的 Node 与 NEKO 的 Electron V8 版本不同且会随升级变化，因此引擎自带的超越函数不可信（[architecture.md §3.3、§4、§9](../design/architecture.md)）。

## 决策

- 保证范围：同一构建 + 同一种子 + 同一带 tick 编号的命令序列 → 同一状态（Chromium / V8 内）。
- 模拟层（`core` 确定性部分、`kernel`、`content`、`protocol`、`features/*/sim`、`features/*/rules`、`features/*/content.ts`、`features/*/protocol.ts`）禁止：`Math.random`、`Date`、`performance`、DOM 全局对象、超越函数（sin / cos / atan2 / exp / pow 等）。lint 强制。
- 随机数统一使用带种子的 RNG，按用途分流（战斗、导演、地图生成等各自独立），避免无关改动改变其他系统的随机序列。
- 遍历顺序稳定：实体查询顺序、系统顺序固定；排序比较函数不得存在并列不定。
- 渲染层的插值、特效、随机抖动不受限制，不影响模拟。
- 存档用状态序列化，不用回放；回放只用于复现与测试。

## 后果

- 模拟层有自己的确定性数学与 RNG 实现，由 `core` 提供。
- 三类确定性测试（黄金状态哈希、同场景两遍一致、中途存档恢复一致）拦截遍历顺序、浮点累加顺序等隐蔽问题（[§10、§14](../design/architecture.md)）。

## 相关

- [architecture.md §9、§10](../design/architecture.md)
- [ADR 0005](0005-fixed-timestep-speed-pause.md)
