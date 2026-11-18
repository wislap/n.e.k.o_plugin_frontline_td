# 0013. 修正值管线

- 状态：已采纳
- 实现：已实现（注：目前仅 MoveSpeed 使用）
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：模拟

## 背景

游戏中有多种属性修正来源：Rogue 奖励、前哨加成、相邻加成、补给不足减益、驻防加成等。若各功能各自实现一套，叠加顺序与口径会发散（[architecture.md §6.11](../design/architecture.md)）。

## 决策

- 所有修正统一走「属性 = 基础值 + 修正值叠加」管线，归 kernel，叠加顺序确定。
- 各功能不得各自实现一套修正机制。

## 后果

- 新增修正来源 = 向管线声明修正值，行为可预测。
- kernel 职责增加，但受契约组件准入门槛约束，防止变成大杂烩（[§14](../design/architecture.md)）。

## 相关

- [architecture.md §6.11](../design/architecture.md)
- [ADR 0008](0008-module-collaboration.md)
