# 0014. 数据驱动的边界

- 状态：已采纳
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：架构

## 背景

"配置驱动，加内容尽量只加数据"是设计原则之一（[architecture.md §7.1](../design/architecture.md)）；但数据里发明条件逻辑会演变成难以维护的脚本语言（[§7.3](../design/architecture.md)）。

## 决策

- 数据只放参数和组合，行为写在代码里。
- 配置需要条件逻辑时，在代码中写具名行为并由数据以 ID 引用，不在数据中发明脚本语言。
- 系统按组件查询，禁止判断内容 ID 或"种类"字符串（lint 强制）；需要特殊行为时新增组件或具名行为，由数据引用。
- 内容用 TS 数据 + `satisfies` 做类型约束，构建时校验（[§6.12](../design/architecture.md)）。
- 局内解锁状态（"本局可用内容"）由占领模块写入，建造、小队模块读取。

## 后果

- 新塔、新武器组合等多数新增只加 `content/` 数据（[§7.4](../design/architecture.md)）。
- 比较内容 ID 字面量的 lint 规则在 M3 随内容体系引入。

## 相关

- [architecture.md §6.12、§7.3](../design/architecture.md)
- [ADR 0011](0011-projectile-effect-composition.md)
