# 0009. 部分 ECS 的边界

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：架构

## 背景

大量单位需要按组件批处理的高性能存储；但并非所有状态都适合 ECS（[architecture.md §6.7](../design/architecture.md)）。

## 决策

- **ECS（bitecs）**：单位、建筑、弹道等数量多、按组件批处理的实体。组件存储由我们分配 TypedArray；位置用 Float64，送渲染时转 Float32。渲染与 UI 只读快照。
- **独立模块（非 ECS）**：地形网格、流场服务、空间哈希、补给网络（图）、导演（规则集）、小队（指令是数据，单位以小队 ID 关联）。
- 字符串、数组、对象引用类数据放在模块内部结构（以实体句柄为键的表、图结构），不塞进组件。
- bitecs 封装在 kernel 内，外部不得直接依赖；bitecs 0.4 的具体 API 在实现时核实。

## 后果

- bitecs 更新慢的风险被隔离：组件存储本就自行分配，替换范围仅限 kernel（[§14](../design/architecture.md)）。
- 热路径直接在 TypedArray 上写循环；kernel 提供类型化视图而不是对象包装（[§7.3](../design/architecture.md)）。

## 相关

- [architecture.md §6.7、§7.3](../design/architecture.md)
- [ADR 0008](0008-module-collaboration.md)
