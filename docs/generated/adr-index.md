<!-- 自动生成，勿手改：npm run gen:index -->

# ADR 索引

## 当前有效（按领域）

### 工程
| 编号 | 标题 | 状态 | 实现 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|---|
| [0001](../adr/0001-adr-process-and-docs.md) | ADR 流程与文档体系 | 已采纳；部分被 0041 取代（ADR 头部字段：新增可选的"部分取代"行）、部分被 0044 取代（ADR 头部字段：新增必填"实现"行，与"状态""部分取代"同属可更新的元数据）、部分被 0046 取代（ADR 领域取值"补给"改名为"物流"） | 已实现 | wislap | M0 架构基线 | 2026-11-14 |
| [0002](../adr/0002-plugin-form-static-panel.md) | 插件形态：static 面板 + Python 薄壳 | 已采纳；部分被 0032 取代（启动时主动请求显示模式） | 已实现 | wislap | M0 架构基线 | 2026-11-14 |
| [0003](../adr/0003-tech-stack.md) | 技术栈 | 已采纳 | 已实现 | wislap | M0 架构基线 | 2026-11-14 |
| [0017](../adr/0017-anti-decay-mechanisms.md) | 防腐化机制 | 已采纳；部分被 0041 取代（棘轮的超长文件阈值、公共接口清单的形式）、部分被 0042 取代（CI 管道固定顺序：改为 verify:static → test → verify:build 三段、三个并行 job） | 已实现 | wislap | M0 架构基线 | 2026-11-14 |
| [0018](../adr/0018-licenses.md) | 许可证与依赖许可证 | 已采纳 | 已实现 | wislap | M0 架构基线 | 2026-11-14 |
| [0024](../adr/0024-evaluation-framework.md) | 评估框架：性能基线与数值平衡 | 已采纳 | 已实现 | wislap | M1 前置 | 2026-11-15 |
| [0032](../adr/0032-host-display-autopause.md) | 宿主显示模式与自动暂停 | 已采纳 | 已实现 | wislap | M3 跨模块参考实现 | 2026-11-17 |
| [0033](../adr/0033-design-checklist-referenced-items.md) | 《设计决策清单 v2》被引用条目 | 已采纳 | 已实现 | wislap | M3 跨模块参考实现 | 2026-11-17 |
| [0037](../adr/0037-eval-bots-balance-runner.md) | 策略机器人与对拍 | 已采纳 | 已实现 | wislap | M4 MVP 收尾 | 2026-11-17 |
| [0040](../adr/0040-entity-id-reuse-component-reads.md) | 实体 ID 复用与组件数组读取 | 已采纳 | 已实现 | wislap | M5 | 2026-11-18 |
| [0041](../adr/0041-governance-and-indexes-v2.md) | 门禁与索引 v2 | 已采纳；部分被 0042 取代（CI 为单一 job 顺序管道的描述） | 已实现 | wislap | 治理 | 2026-11-18 |
| [0042](../adr/0042-verification-segmentation-parallel-ci.md) | 验证分段与 CI 并行 | 已采纳 | 已实现 | wislap | 治理 | 2026-11-18 |
| [0043](../adr/0043-review-remediation.md) | 评审整改约定 | 已采纳 | 已实现 | wislap | 治理 | 2026-11-18 |
| [0044](../adr/0044-adr-implementation-field.md) | ADR 实现状态字段 | 已采纳 | 已实现 | wislap | 治理 | 2026-11-19 |
| [0046](../adr/0046-doc-consistency-conventions.md) | 文档一致性约定 | 已采纳 | 部分（功能 README 尚未按第 3、4 条改写，check-docs 的链接检查未做） | wislap | 治理 | 2026-11-20 |

### 架构
| 编号 | 标题 | 状态 | 实现 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|---|
| [0004](../adr/0004-headless-sim-worker-protocol.md) | 无头模拟核心、Worker 与命令 / 快照 / 事件协议 | 已采纳 | 部分（事件流不按观察者过滤，以 all 下发，客户端只在表现层隐藏，见 ADR 0039） | wislap | M0 架构基线 | 2026-11-14 |
| [0007](../adr/0007-feature-first-layout-dependency-rules.md) | 功能优先目录与依赖规则 | 已采纳 | 已实现 | wislap | M0 架构基线 | 2026-11-14 |
| [0008](../adr/0008-module-collaboration.md) | 模块协作模式 | 已采纳 | 部分（伤害管线只有基础值 → 血量；修正值、抗性、护盾阶段与声明式插入未做） | wislap | M0 架构基线 | 2026-11-14 |
| [0009](../adr/0009-partial-ecs-boundary.md) | 部分 ECS 的边界 | 已采纳 | 已实现 | wislap | M0 架构基线 | 2026-11-14 |
| [0014](../adr/0014-data-driven-boundaries.md) | 数据驱动的边界 | 已采纳 | 部分（局内解锁未做，carryIn.unlocks 有 schema 无消费方） | wislap | M0 架构基线 | 2026-11-14 |
| [0019](../adr/0019-factions-and-pluggable-modes.md) | 阵营模型与玩法可插拔 | 已采纳；部分被 0038 取代（归属变更方式：占领后新建实体，不改写 Faction） | 已实现 | wislap | M1 前置 | 2026-11-15 |
| [0023](../adr/0023-grid-layers-groups-commands-rng-runtime-limits.md) | 网格图层、编组、命令 schema、RNG 登记与运行时限制 | 已采纳；部分被 0034 取代（编组可嵌套：小队为单层，嵌套编组不做） | 部分（经济收入来源注册接口未做） | wislap | M1 前置 | 2026-11-15 |
| [0045](../adr/0045-second-review-conventions.md) | 第二轮评审整改约定 | 已采纳 | 已实现 | wislap | 治理 | 2026-11-20 |

### 模拟
| 编号 | 标题 | 状态 | 实现 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|---|
| [0005](../adr/0005-fixed-timestep-speed-pause.md) | 固定步长 20Hz、变速与暂停 | 已采纳 | 已实现 | wislap | M0 架构基线 | 2026-11-14 |
| [0006](../adr/0006-determinism.md) | 确定性 | 已采纳 | 已实现 | wislap | M0 架构基线 | 2026-11-14 |
| [0013](../adr/0013-modifier-pipeline.md) | 修正值管线 | 已采纳 | 已实现（目前仅 MoveSpeed 使用） | wislap | M0 架构基线 | 2026-11-14 |
| [0020](../adr/0020-numeric-time-capacity-conventions.md) | 数值、时间与容量约定 | 已采纳 | 已实现 | wislap | M1 前置 | 2026-11-15 |
| [0021](../adr/0021-scheduled-effects-entity-relations.md) | 延迟效果与实体关系 | 已采纳；部分被 0043 取代（容纳关系的 ContainedIn 契约组件设计） | 已实现（调度队列已实现，尚无生产使用方） | wislap | M1 前置 | 2026-11-15 |
| [0026](../adr/0026-kernel-implementation-conventions.md) | 模拟内核的实现约定 | 已采纳；部分被 0043 取代（契约组件清单中的 ContainedIn） | 已实现 | wislap | M1 模拟核心 | 2026-11-15 |
| [0034](../adr/0034-squads.md) | 小队 | 已采纳 | 已实现 | wislap | M4 MVP 收尾 | 2026-11-17 |
| [0035](../adr/0035-assault-mode-director-victory.md) | 攻占模式、导演与胜负 | 已采纳；部分被 0038 取代（波次目标） | 已实现 | wislap | M4 MVP 收尾 | 2026-11-17 |
| [0036](../adr/0036-controller-state-save-load.md) | 控制者状态与存档 | 已采纳 | 已实现 | wislap | M4 MVP 收尾 | 2026-11-17 |
| [0038](../adr/0038-outposts-ruins-capture-exclusion.md) | 据点、废墟、占领与禁建区 | 已采纳 | 已实现 | wislap | M5 | 2026-11-18 |
| [0039](../adr/0039-vision-fog-of-war.md) | 视野与战争迷雾 | 已采纳 | 已实现 | wislap | M5 | 2026-11-18 |

### 地形
| 编号 | 标题 | 状态 | 实现 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|---|
| [0010](../adr/0010-terrain-model-sector-flowfields.md) | 地形模型与分区流场 | 已采纳 | 部分（分区失效仍是全局：invalidateCells 清全图 fields/portalDists，rebuildNodesAndEdges 全局重编号） | wislap | M0 架构基线 | 2026-11-14 |
| [0027](../adr/0027-map-terrain-flowfield-movement.md) | 地图格式、地形规则、分区流场与移动的实现约定 | 已采纳 | 已实现 | wislap | M2 第一个参考实现 | 2026-11-16 |

### 战斗
| 编号 | 标题 | 状态 | 实现 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|---|
| [0011](../adr/0011-projectile-effect-composition.md) | 弹道与效果的组合模型 | 已采纳 | 部分（仅 instant 交付；追踪、抛物线与区域效果包未做） | wislap | M0 架构基线 | 2026-11-14 |
| [0031](../adr/0031-combat-modifiers-inspect.md) | 战斗、修正值与检视约定 | 已采纳；部分被 0043 取代（修正值数量类 floorDiv / 几何类浮点之分；combat 最后注册的理由） | 部分（战斗未经 ctx.stat 读修正值，EnergyLow/EnergyEmpty 目前只影响移动） | wislap | M3 跨模块参考实现 | 2026-11-17 |

### 建造
| 编号 | 标题 | 状态 | 实现 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|---|
| [0012](../adr/0012-construction-as-entity.md) | 建造即实体 | 已采纳；部分被 0029 取代（下令即占格可攻击：新增蓝图状态，不占格、不可攻击，激活后才成为工地） | 部分（修复与升级未复用工地机制；可调优先级只有建造、生产两档） | wislap | M0 架构基线 | 2026-11-14 |
| [0029](../adr/0029-construction-implementation.md) | 建造实现：蓝图、工地、拆除残骸与道路工程 | 已采纳 | 已实现 | wislap | M3 跨模块参考实现 | 2026-11-17 |

### 物流
| 编号 | 标题 | 状态 | 实现 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|---|
| [0025](../adr/0025-logistics-model.md) | 物流模型：运力配额、统一货物与自动路由 | 已采纳；部分被 0030 取代（连线沿道路走、倍率按长度加权）、部分被 0030 取代（线路车辆时间由两端节点共同消耗，改为每个方向由一端节点付费） | 部分（修复优先级类别与节点修复未做；被毁节点不留废墟、无重建折扣） | wislap | M1 前置 | 2026-11-15 |
| [0030](../adr/0030-logistics-implementation.md) | 物流实现约定：付费方、道路倍率、走廊拦截与拓扑增量失效 | 已采纳 | 已实现 | wislap | M3 跨模块参考实现 | 2026-11-17 |

### 内容
| 编号 | 标题 | 状态 | 实现 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|---|
| [0015](../adr/0015-map-format-versioning.md) | 地图格式契约与版本号 | 已采纳 | 部分（内容包没有 formatVersion；回放格式尚不存在） | wislap | M0 架构基线 | 2026-11-14 |
| [0022](../adr/0022-match-setup-content-ids-packs.md) | 对局启动参数、内容 ID 与内容包 | 已采纳 | 部分（别名表与包补丁未做；组件序列化 u16 内容索引，存档与内容版本绑定） | wislap | M1 前置 | 2026-11-15 |

### UI
| 编号 | 标题 | 状态 | 实现 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|---|
| [0016](../adr/0016-i18n-strategy.md) | 多语言策略 | 已采纳 | 已实现 | wislap | M0 架构基线 | 2026-11-14 |
| [0028](../adr/0028-rendering-camera-picking.md) | 渲染、镜头与拾取 | 已采纳 | 部分（关闭"暂停自动切指挥视角"的设置没有界面；建造模式不会自动切到指挥视角） | wislap | M2 第一个参考实现 | 2026-11-16 |

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

### M3 跨模块参考实现（2026-11-17）
- [0029 建造实现：蓝图、工地、拆除残骸与道路工程](../adr/0029-construction-implementation.md)
- [0030 物流实现约定：付费方、道路倍率、走廊拦截与拓扑增量失效](../adr/0030-logistics-implementation.md)
- [0031 战斗、修正值与检视约定](../adr/0031-combat-modifiers-inspect.md)
- [0032 宿主显示模式与自动暂停](../adr/0032-host-display-autopause.md)
- [0033 《设计决策清单 v2》被引用条目](../adr/0033-design-checklist-referenced-items.md)

### M4 MVP 收尾（2026-11-17）
- [0034 小队](../adr/0034-squads.md)
- [0035 攻占模式、导演与胜负](../adr/0035-assault-mode-director-victory.md)
- [0036 控制者状态与存档](../adr/0036-controller-state-save-load.md)
- [0037 策略机器人与对拍](../adr/0037-eval-bots-balance-runner.md)

### M5（2026-11-18）
- [0038 据点、废墟、占领与禁建区](../adr/0038-outposts-ruins-capture-exclusion.md)
- [0039 视野与战争迷雾](../adr/0039-vision-fog-of-war.md)
- [0040 实体 ID 复用与组件数组读取](../adr/0040-entity-id-reuse-component-reads.md)

### 治理（2026-11-18）
- [0041 门禁与索引 v2](../adr/0041-governance-and-indexes-v2.md)
- [0042 验证分段与 CI 并行](../adr/0042-verification-segmentation-parallel-ci.md)
- [0043 评审整改约定](../adr/0043-review-remediation.md)
- [0044 ADR 实现状态字段](../adr/0044-adr-implementation-field.md)
- [0045 第二轮评审整改约定](../adr/0045-second-review-conventions.md)
- [0046 文档一致性约定](../adr/0046-doc-consistency-conventions.md)
