# 0047. 组件归属声明与契约清单

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-20
- 决策者：wislap
- 批次：治理
- 领域：架构
- 部分取代：0026（组件归属不再只由 claimWriter 表达：新增 ownComponent，声明 spawn 即挂但无字段写者的组件）

## 背景

`docs/generated/contracts.md` 的组件表依赖两处来源：安装时的
`claimWriter` 和首次实体创建时的懒注册。一批组件因此始终缺席
或写者显示为 null：`ruin`、`salvage`、`road_segment`、
`logistics.fixed_attach` 等——它们随实体 spawn 挂上去、之后没有
系统写字段，没有模块认领写者。审计无法回答"这个组件是谁的"。

## 决策

组件引入"归属"概念，与"写者"分离：

- 新 builder API `ownComponent(ref)`：声明安装模块拥有 `ref`，
  同时立即注册（不再懒注册）。`claimWriter` 对非契约组件隐式
  记录同一归属；两个不同模块拥有同一 `ref` 在安装时报错。
- kernel 契约组件（`Faction`、`InWorld`、`UnderConstruction`）
  归属 `kernel`，`ownComponent` 它们报错；`claimWriter` 仍可认领
  写者（如 construction 写 `UnderConstruction`），归属不变。
- `SimManifest` 组件行新增 `owner`，命令与延迟效果列出 `emits`；
  contracts.md 组件表加"所属"列，命令/效果行显示发出的消息；
  kernel 的探针收在清单末尾的合成 `kernel` 条目下。
- `gen-index` 生成契约清单时校验：`COMPONENT_REGISTRY` 中每个
  `defineComponent` 都必须出现在清单里且有非空 `owner`，否则
  报错（"component X is defined but no module owns it"）。
- 首个审计按此标准补齐十个组件的归属声明：construction 认领
  `Ruin`、`Salvage`、`RoadSegment`；logistics 认领 `FixedAttach`、
  `LogisticsNode`、`Interceptor`；movement 认领 `Mover`；combat
  认领 `Targetable`；units 认领 `UnitKind`；vision 认领 `Vision`。

## 后果

- 每个已定义组件都有确定归属，契约清单完整反映装配；新增组件
  忘记声明归属会被生成检查拦下。
- "spawn 即挂、无字段写者"成为一种显式组件形态，区别于"没人
  认领的孤儿 schema"。
