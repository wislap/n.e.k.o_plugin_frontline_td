# 0015. 地图格式契约与版本号

- 状态：已采纳
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：内容

## 背景

原型自带 1 张固定地图；将来一关一张地图，地图来源多样（手工、生成、外部工具导入等）（[architecture.md §3.5](../design/architecture.md)）。

## 决策

- 地图格式是契约：地形各层、进攻轴线与出怪点、前哨、初始补给节点。
- 地图、内容、回放格式从第一天起带 `formatVersion`（[§3.7](../design/architecture.md)）。回放只保证同一构建内有效；存档跨版本需迁移或声明不兼容。
- 原型的固定地图按此格式手写；将来的编辑器、生成器、外部工具导入都只是"产出此格式"的来源（[§6.12](../design/architecture.md)）。

## 后果

- 地图生产工具与运行时解耦，任何来源只要符合契约即可。
- 格式演进必须显式升级 `formatVersion` 并处理兼容。

## 相关

- [architecture.md §3.5、§3.7、§6.12](../design/architecture.md)
- [ADR 0010](0010-terrain-model-sector-flowfields.md)
