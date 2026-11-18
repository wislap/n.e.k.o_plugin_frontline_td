# 0007. 功能优先目录与依赖规则

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：架构

## 背景

诉求第一是"模块化，改动可控"：改一个子系统、加一个功能时，其他系统的改动可预测、局部化；分层必须由工具强制，不靠自觉（[architecture.md §4](../design/architecture.md)）。

## 决策

- 目录布局功能优先：`features/<x>/{sim,rules,render,ui}`，辅以 `core`、`kernel`、`content`、`protocol`、`runtime`、`client`、`render`、`ui`、`input`、`i18n`、`host`、`dev`、`app`（[§6.3](../design/architecture.md)）。
- 依赖规则由 dependency-cruiser 强制（[§6.4](../design/architecture.md)）：
  - `core` 不依赖任何内部模块；`kernel` 只依赖 `core`。
  - `features/*/sim` 可依赖 `core`、`kernel`、`content`、本功能 `rules`，以及其他功能 `sim/index.ts` 的公开接口。
  - `features/*/rules` 只依赖 `core`、`protocol` 类型、`content` 类型——这是"客户端不得依赖模拟层"的有意例外，用于消除 UI 与 sim 重复实现同一规则（如可否建造、是否买得起）。
  - `features/*/render`、`features/*/ui` 禁止依赖任何 `sim/`，只能用 `client`、`protocol`、`rules`、`render` / `ui` 公共设施、`i18n`。
  - 跨功能引用只能经由 `index.ts`；禁止循环依赖；只有 `app/` 可以装配全部模块。
- 违反依赖规则时修改设计，不改规则；规则本身的改动属架构级改动，必须先写 ADR。

## 后果

- 依赖单向流动：模拟层不知道画面存在，画面不能改模拟状态。
- 每个功能的 `README.md` 记录职责 / 公开接口 / 拥有的组件 / 不变量 / 对应设计章节。

## 相关

- [architecture.md §6.3、§6.4、§7.1](../design/architecture.md)
- [ADR 0008](0008-module-collaboration.md)、[ADR 0017](0017-anti-decay-mechanisms.md)
