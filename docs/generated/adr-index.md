<!-- 自动生成，勿手改：npm run gen:index -->

# ADR 索引

## 当前有效（按领域）

### 工程
| 编号 | 标题 | 状态 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|
| [0001](../adr/0001-adr-process-and-docs.md) | ADR 流程与文档体系 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0002](../adr/0002-plugin-form-static-panel.md) | 插件形态：static 面板 + Python 薄壳 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0003](../adr/0003-tech-stack.md) | 技术栈 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0017](../adr/0017-anti-decay-mechanisms.md) | 防腐化机制 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0018](../adr/0018-licenses.md) | 许可证与依赖许可证 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0024](../adr/0024-evaluation-framework.md) | 评估框架：性能基线与数值平衡 | 已采纳 | wislap | M1 前置 | 2026-11-15 |

### 架构
| 编号 | 标题 | 状态 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|
| [0004](../adr/0004-headless-sim-worker-protocol.md) | 无头模拟核心、Worker 与命令 / 快照 / 事件协议 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0007](../adr/0007-feature-first-layout-dependency-rules.md) | 功能优先目录与依赖规则 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0008](../adr/0008-module-collaboration.md) | 模块协作模式 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0009](../adr/0009-partial-ecs-boundary.md) | 部分 ECS 的边界 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0014](../adr/0014-data-driven-boundaries.md) | 数据驱动的边界 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0019](../adr/0019-factions-and-pluggable-modes.md) | 阵营模型与玩法可插拔 | 已采纳 | wislap | M1 前置 | 2026-11-15 |
| [0023](../adr/0023-grid-layers-groups-commands-rng-runtime-limits.md) | 网格图层、编组、命令 schema、RNG 登记与运行时限制 | 已采纳 | wislap | M1 前置 | 2026-11-15 |

### 模拟
| 编号 | 标题 | 状态 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|
| [0005](../adr/0005-fixed-timestep-speed-pause.md) | 固定步长 20Hz、变速与暂停 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0006](../adr/0006-determinism.md) | 确定性 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0013](../adr/0013-modifier-pipeline.md) | 修正值管线 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0020](../adr/0020-numeric-time-capacity-conventions.md) | 数值、时间与容量约定 | 已采纳 | wislap | M1 前置 | 2026-11-15 |
| [0021](../adr/0021-scheduled-effects-entity-relations.md) | 延迟效果与实体关系 | 已采纳 | wislap | M1 前置 | 2026-11-15 |
| [0026](../adr/0026-kernel-implementation-conventions.md) | 模拟内核的实现约定 | 已采纳 | wislap | M1 模拟核心 | 2026-11-15 |

### 地形
| 编号 | 标题 | 状态 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|
| [0010](../adr/0010-terrain-model-sector-flowfields.md) | 地形模型与分区流场 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0027](../adr/0027-map-terrain-flowfield-movement.md) | 地图格式、地形规则、分区流场与移动的实现约定 | 已采纳 | wislap | M2 第一个参考实现 | 2026-11-16 |

### 战斗
| 编号 | 标题 | 状态 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|
| [0011](../adr/0011-projectile-effect-composition.md) | 弹道与效果的组合模型 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |

### 建造
| 编号 | 标题 | 状态 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|
| [0012](../adr/0012-construction-as-entity.md) | 建造即实体 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |

### 物流
| 编号 | 标题 | 状态 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|
| [0025](../adr/0025-logistics-model.md) | 物流模型：运力配额、统一货物与自动路由 | 已采纳 | wislap | M1 前置 | 2026-11-15 |

### 内容
| 编号 | 标题 | 状态 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|
| [0015](../adr/0015-map-format-versioning.md) | 地图格式契约与版本号 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0022](../adr/0022-match-setup-content-ids-packs.md) | 对局启动参数、内容 ID 与内容包 | 已采纳 | wislap | M1 前置 | 2026-11-15 |

### UI
| 编号 | 标题 | 状态 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|
| [0016](../adr/0016-i18n-strategy.md) | 多语言策略 | 已采纳 | wislap | M0 架构基线 | 2026-11-14 |
| [0028](../adr/0028-rendering-camera-picking.md) | 渲染、镜头与拾取 | 已采纳 | wislap | M2 第一个参考实现 | 2026-11-16 |

## 已取代 / 已废弃

无

## 批次时间线

### M0 架构基线（2026-11-14）
- [0001 ADR 流程与文档体系](../adr/0001-adr-process-and-docs.md)
- [0002 插件形态：static 面板 + Python 薄壳](../adr/0002-plugin-form-static-panel.md)
- [0003 技术栈](../adr/0003-tech-stack.md)
- [0004 无头模拟核心、Worker 与命令 / 快照 / 事件协议](../adr/0004-headless-sim-worker-protocol.md)
- [0005 固定步长 20Hz、变速与暂停](../adr/0005-fixed-timestep-speed-pause.md)
- [0006 确定性](../adr/0006-determinism.md)
- [0007 功能优先目录与依赖规则](../adr/0007-feature-first-layout-dependency-rules.md)
- [0008 模块协作模式](../adr/0008-module-collaboration.md)
- [0009 部分 ECS 的边界](../adr/0009-partial-ecs-boundary.md)
- [0010 地形模型与分区流场](../adr/0010-terrain-model-sector-flowfields.md)
- [0011 弹道与效果的组合模型](../adr/0011-projectile-effect-composition.md)
- [0012 建造即实体](../adr/0012-construction-as-entity.md)
- [0013 修正值管线](../adr/0013-modifier-pipeline.md)
- [0014 数据驱动的边界](../adr/0014-data-driven-boundaries.md)
- [0015 地图格式契约与版本号](../adr/0015-map-format-versioning.md)
- [0016 多语言策略](../adr/0016-i18n-strategy.md)
- [0017 防腐化机制](../adr/0017-anti-decay-mechanisms.md)
- [0018 许可证与依赖许可证](../adr/0018-licenses.md)

### M1 前置（2026-11-15）
- [0019 阵营模型与玩法可插拔](../adr/0019-factions-and-pluggable-modes.md)
- [0020 数值、时间与容量约定](../adr/0020-numeric-time-capacity-conventions.md)
- [0021 延迟效果与实体关系](../adr/0021-scheduled-effects-entity-relations.md)
- [0022 对局启动参数、内容 ID 与内容包](../adr/0022-match-setup-content-ids-packs.md)
- [0023 网格图层、编组、命令 schema、RNG 登记与运行时限制](../adr/0023-grid-layers-groups-commands-rng-runtime-limits.md)
- [0024 评估框架：性能基线与数值平衡](../adr/0024-evaluation-framework.md)
- [0025 物流模型：运力配额、统一货物与自动路由](../adr/0025-logistics-model.md)

### M1 模拟核心（2026-11-15）
- [0026 模拟内核的实现约定](../adr/0026-kernel-implementation-conventions.md)

### M2 第一个参考实现（2026-11-16）
- [0027 地图格式、地形规则、分区流场与移动的实现约定](../adr/0027-map-terrain-flowfield-movement.md)
- [0028 渲染、镜头与拾取](../adr/0028-rendering-camera-picking.md)
