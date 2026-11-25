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
| [0044](../adr/0044-adr-implementation-field.md) | ADR 实现状态字段 | 已采纳 | 已实现 | wislap | 治理 | 2026-11-18 |
| [0046](../adr/0046-doc-consistency-conventions.md) | 文档一致性约定 | 已采纳 | 已实现 | wislap | 治理 | 2026-11-20 |
| [0061](../adr/0061-doc-abstraction-and-tuning-records.md) | 文档抽象层级与调参记录约定 | 已采纳 | 已实现 | wislap | 治理 | 2026-11-22 |
| [0062](../adr/0062-client-contribution-registry.md) | 客户端贡献点注册：场景层、HUD 面板、检视器与小地图由功能声明、app 装配 | 已采纳 | 部分（HUD 面板、检视器、小地图贡献点，画布输入拆分与依赖规则未做） | wislap | 前端重构 P3 | 2026-11-24 |

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
| [0047](../adr/0047-component-ownership-manifest.md) | 组件归属声明与契约清单 | 已采纳 | 已实现 | wislap | 治理 | 2026-11-20 |

### 模拟
| 编号 | 标题 | 状态 | 实现 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|---|
| [0005](../adr/0005-fixed-timestep-speed-pause.md) | 固定步长 20Hz、变速与暂停 | 已采纳 | 已实现 | wislap | M0 架构基线 | 2026-11-14 |
| [0006](../adr/0006-determinism.md) | 确定性 | 已采纳 | 已实现 | wislap | M0 架构基线 | 2026-11-14 |
| [0013](../adr/0013-modifier-pipeline.md) | 修正值管线 | 已采纳 | 已实现（目前仅 MoveSpeed 使用） | wislap | M0 架构基线 | 2026-11-14 |
| [0020](../adr/0020-numeric-time-capacity-conventions.md) | 数值、时间与容量约定 | 已采纳 | 已实现 | wislap | M1 前置 | 2026-11-15 |
| [0021](../adr/0021-scheduled-effects-entity-relations.md) | 延迟效果与实体关系 | 已采纳；部分被 0043 取代（容纳关系的 ContainedIn 契约组件设计） | 已实现（调度队列已实现，尚无生产使用方） | wislap | M1 前置 | 2026-11-15 |
| [0026](../adr/0026-kernel-implementation-conventions.md) | 模拟内核的实现约定 | 已采纳；部分被 0043 取代（契约组件清单中的 ContainedIn）、部分被 0047 取代（组件归属不再只由 claimWriter 表达：新增 ownComponent，声明 spawn 即挂但无字段写者的组件） | 已实现 | wislap | M1 模拟核心 | 2026-11-15 |
| [0034](../adr/0034-squads.md) | 小队 | 已采纳；部分被 0054 取代（小队升级为持久职能分排阵型槽位、虚拟领航锚点、隘口柔缩/展开与行军巡航同步，经 MoveIntent.slots 与 FormationGuideIntent 驱动，仍不直写移动组件）、部分被 0057 取代（小队 `advance` 可达性探针改为 $O(1)$ 连通分量查询，且 `SquadsOrder` / `SquadsGather` 下令次 tick 立即生效） | 已实现 | wislap | M4 MVP 收尾 | 2026-11-17 |
| [0035](../adr/0035-assault-mode-director-victory.md) | 攻占模式、导演与胜负 | 已采纳；部分被 0038 取代（波次目标） | 已实现 | wislap | M4 MVP 收尾 | 2026-11-17 |
| [0036](../adr/0036-controller-state-save-load.md) | 控制者状态与存档 | 已采纳 | 已实现 | wislap | M4 MVP 收尾 | 2026-11-17 |
| [0038](../adr/0038-outposts-ruins-capture-exclusion.md) | 据点、废墟、占领与禁建区 | 已采纳 | 已实现 | wislap | M5 | 2026-11-18 |
| [0039](../adr/0039-vision-fog-of-war.md) | 视野与战争迷雾 | 已采纳 | 已实现 | wislap | M5 | 2026-11-18 |
| [0053](../adr/0053-damped-asymmetric-avoidance-arrival-hysteresis-and-wall-margins.md) | 阻尼非对称避让、到达迟滞与墙体边距 | 已采纳；部分被 0056 取代（在同阵营双行进单位分离中增加纵向后车让行与单侧超车切向滑步，消除后车顶推前车抽动）、部分被 0059 取代（`integrate` 实际位移回写 `Velocity` 并对 `steer` 航向引入保留标量速率的惯性滤波；新增 `MoveTarget.stall` 3 tick 接触传染本地停驻与 `blockedByHolder` 存档往返） | 已实现 | wislap | S2 阻尼避让与到达迟滞 | 2026-11-21 |
| [0054](../adr/0054-squad-leader-anchor-role-formations-and-cruise-sync.md) | 小队虚拟领航锚点、混编职能分排与巡航控速 | 已采纳；部分被 0056 取代（在流场之上引入共享宽门走廊链 `RouteChain` 与内部组件 `RouteFollow`，从根源消除障碍物中线处的分水岭分裂与稀疏孤立绕路）、部分被 0057 取代（移除 2D 虚拟领航锚点与路径点转向覆盖，简化 `FormationGuide` 为标量巡航限速并改用 1D 连续测地距截尾中位数控速）、部分被 0059 取代（交战包抄改用 `projectSurroundArcSlots` 15 射线射程扇弧落位与同射程带 2-opt 解交叉，替代向敌心投影成块） | 已实现 | wislap | S3 小队编队领航与混编协同 | 2026-11-21 |
| [0056](../adr/0056-watershed-proof-corridor-chains-command-snap-and-rear-yielding.md) | 分水岭防分裂空间聚类与宽门走廊链、MoveCommand 近端吸附及纵向后车让行 | 已采纳；部分被 0058 取代（lineWalkable 升级为精确亚格 Amanatides–Woo DDA；buildWideGate 强制门间直线直通并加入拐角补门与桥前反向宽度漏斗；steerRouteFollow 移除旧门回望并收口为实例局部重入缓冲）、部分被 0059 取代（`MoveIntent` 轻重混编优先共享重型可达 `GoalField` 消除 1 格窄缝分道拆队；引入 1.5 格弧长 C¹ 平滑空间孔径脊柱与 `[3.8, 8.0]` 终端平滑渐隐替代离散路门硬切换） | 已实现 | wislap | P2 寻路与运动 V2 重构 | 2026-11-21 |
| [0057](../adr/0057-geodesic-distance-cruise-pacing-and-immediate-squad-orders.md) | 基于连续测地距截尾中位数的巡航控速与小队指令首拍瞬发 | 已采纳；部分被 0058 取代（新增 resolveSquadGoalAtTier 对不可通行目标做 6 格来向面吸附、projectFormationSlots 测地距防跨崖过滤、统一混编小队净空口径并将 SquadAnchor 精简为 heading） | 已实现 | wislap | P3 寻路与运动 V2 重构 | 2026-11-21 |
| [0058](../adr/0058-real-map-locomotion-hardening-and-squad-cleanup.md) | 实图寻路硬化、混编净空统一与走廊及状态收口 | 已采纳；部分被 0059 取代（将 `squadGoalTier` 混编小队默认净空统一提升至 `CLEARANCE_HEAVY`，仅对跨墙离群标准成员懒惰探测 `CLEARANCE_STANDARD`；桥前反向宽度漏斗斜率由 `1.25` 改为 `0.7`） | 已实现 | wislap | P4 寻路与运动实图硬化与收口 | 2026-11-21 |
| [0059](../adr/0059-damped-aperture-locomotion-mixed-cohesion-and-surround-arcs.md) | 阻尼速度惯性、混编统一流域、空间孔径缩列与弧形包抄 | 已采纳 | 已实现 | wislap | P5 寻路与集群运动融合重构 | 2026-11-21 |

### 地形
| 编号 | 标题 | 状态 | 实现 | 决策者 | 批次 | 日期 |
|---|---|---|---|---|---|---|
| [0010](../adr/0010-terrain-model-sector-flowfields.md) | 地形模型与分区流场 | 已采纳；部分被 0052 取代（补齐按移动类别 × 净空分档 1×1 标准档 / 2×2 重型档的门户流场，并在离散 8 向流场之上新增扇区内对偶双线性连续流向梯度查询 smoothDirectionAt）、部分被 0055 取代（以按需暂停/恢复的迎风 Eikonal 连续距离场、Dial 环形桶队列与懒惰连通分量缓存取代 16×16 扇区门户图与局部 Dijkstra） | 部分（高度影响视线/射程与海域/空中类别未做；原分区流场已由 ADR 0055 迎风 Eikonal 取代） | wislap | M0 架构基线 | 2026-11-14 |
| [0027](../adr/0027-map-terrain-flowfield-movement.md) | 地图格式、地形规则、分区流场与移动的实现约定 | 已采纳；部分被 0053 取代（转向接入连续流向梯度 smoothDirectionAt 并引入到达减速带与守位迟滞死区；分离改为双斜率过阻尼排斥、r²×状态非对称让路、友军/对向切向绕行与单 tick 推挤限幅；积分增加按净空分档的平面墙距与凸角圆弧夹紧；移动编组与出兵按 (cls, tier) 分档）、部分被 0055 取代（分区流场与门户近似实现改为全图无缝迎风 Eikonal 求解与 O(1) 连通分量可达性判定）、部分被 0056 取代（为 `MoveCommand` 引入 `<= 3` 格近端向己侧吸附，替代死区零容错直接拒绝） | 已实现 | wislap | M2 第一个参考实现 | 2026-11-16 |
| [0052](../adr/0052-terrain-clearance-tiers-and-smooth-flow-gradients.md) | 地形净空分档与连续流场方向梯度 | 已采纳；部分被 0055 取代（保留两档净空与三段式连续流向梯度契约，并将双线性插值与中心差分从扇区内限制升级为全图无缝跨区查询）、部分被 0059 取代（在 `smoothDirectionAt` Stage 1/2 失败时增加 Stage 2b 贴墙单侧迎风合法梯度回退，保留亚格安全门控） | 已实现 | wislap | S1 地形净空与连续流场 | 2026-11-21 |
| [0055](../adr/0055-resumable-upwind-eikonal-and-component-reachability.md) | 可恢复迎风 Eikonal 求解器与连通分量可达性 | 已采纳；部分被 0058 取代（澄清 Dial 环形桶采用 O(1) FIFO 尾插出队，由固定起点与 DIR_ORDER 保证确定性） | 已实现 | wislap | P1 寻路与运动 V2 重构 | 2026-11-21 |

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
| [0025](../adr/0025-logistics-model.md) | 物流模型：运力配额、统一货物与自动路由 | 已采纳；部分被 0030 取代（连线沿道路走、倍率按长度加权；线路车辆时间由两端节点共同消耗，改为每个方向由一端节点付费） | 部分（修复优先级类别与节点修复未做；被毁节点不留废墟、无重建折扣） | wislap | M1 前置 | 2026-11-15 |
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
| [0028](../adr/0028-rendering-camera-picking.md) | 渲染、镜头与拾取 | 已采纳；部分被 0048 取代（按 V 切换视角改为 Tab；删除暂停自动切指挥视角，改为进入建造/物流模式自动切 2D 且可锁定视角；点选拆分为己方可控选中集合与可固定检视对象）、部分被 0060 取代（观战镜头由固定正南 55° 升级为无奇点全向 3D 轨道阻尼镜头，支持自由旋转、智能俯角与一键归北；拖拽平移与滚轮缩放升级为三维平面射线精确锚定；点选升级为三维实体包围体优先拾取） | 已实现 | wislap | M2 第一个参考实现 | 2026-11-16 |
| [0048](../adr/0048-interaction-modes-and-inspector-contract.md) | 客户端交互模式、检视焦点与强类型检查器契约 | 已采纳；部分被 0049 取代（快捷键速查由居中浮层改为左中常驻可折叠快捷键引导栏并以 K 键开关、Esc 不再关闭引导栏；战术检视面板移至右下角，左下角承载一级模式栏并预留小地图槽位）、部分被 0060 取代（补充 Q/E 连续旋转、Alt+左键与中键轨道旋转、Shift+中键抓地平移及 N/Home 归北快捷键） | 已实现 | wislap | F1 客户端交互底座 | 2026-11-20 |
| [0049](../adr/0049-hud-design-system-and-layout.md) | 近未来战术 HUD 设计系统、九宫格布局与建造分类字段 | 已采纳 | 已实现 | wislap | F2 战术 HUD 主体 | 2026-11-20 |
| [0050](../adr/0050-tactical-sandbox-rendering-and-gpu-lifecycle.md) | 电子沙盘程序化建筑渲染、战术圈层反馈与 WebGL 资源生命周期 | 已采纳；部分被 0051 取代（屋顶战术图标升级为 128×128 各向异性过滤加 polygonOffset；全图动态 InstancedMesh 与 LineSegments 强制显式声明 frustumCulled 并由 ESLint 守门） | 已实现 | wislap | F4 电子沙盘渲染与 GPU 治理 | 2026-11-20 |
| [0051](../adr/0051-scene-culling-depth-precision-and-decal-stack.md) | 全图批次视锥裁剪契约、动态深度窗口与地表贴花层级 | 已采纳 | 已实现 | wislap | R1 场景视锥裁剪与深度精度治理 | 2026-11-21 |
| [0060](../adr/0060-orbital-3d-camera-ray-anchored-controls-and-volume-picking.md) | 全 3D 自由轨道沙盘镜头、射线锚定操控与三维实体拾取 | 已采纳 | 已实现 | wislap | R2 全 3D 自由轨道镜头与三维交互 | 2026-11-21 |

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
- [0047 组件归属声明与契约清单](../adr/0047-component-ownership-manifest.md)
- [0061 文档抽象层级与调参记录约定](../adr/0061-doc-abstraction-and-tuning-records.md)

### F1 客户端交互底座（2026-11-20）
- [0048 客户端交互模式、检视焦点与强类型检查器契约](../adr/0048-interaction-modes-and-inspector-contract.md)

### F2 战术 HUD 主体（2026-11-20）
- [0049 近未来战术 HUD 设计系统、九宫格布局与建造分类字段](../adr/0049-hud-design-system-and-layout.md)

### F4 电子沙盘渲染与 GPU 治理（2026-11-20）
- [0050 电子沙盘程序化建筑渲染、战术圈层反馈与 WebGL 资源生命周期](../adr/0050-tactical-sandbox-rendering-and-gpu-lifecycle.md)

### R1 场景视锥裁剪与深度精度治理（2026-11-21）
- [0051 全图批次视锥裁剪契约、动态深度窗口与地表贴花层级](../adr/0051-scene-culling-depth-precision-and-decal-stack.md)

### S1 地形净空与连续流场（2026-11-21）
- [0052 地形净空分档与连续流场方向梯度](../adr/0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)

### S2 阻尼避让与到达迟滞（2026-11-21）
- [0053 阻尼非对称避让、到达迟滞与墙体边距](../adr/0053-damped-asymmetric-avoidance-arrival-hysteresis-and-wall-margins.md)

### S3 小队编队领航与混编协同（2026-11-21）
- [0054 小队虚拟领航锚点、混编职能分排与巡航控速](../adr/0054-squad-leader-anchor-role-formations-and-cruise-sync.md)

### P1 寻路与运动 V2 重构（2026-11-21）
- [0055 可恢复迎风 Eikonal 求解器与连通分量可达性](../adr/0055-resumable-upwind-eikonal-and-component-reachability.md)

### P2 寻路与运动 V2 重构（2026-11-21）
- [0056 分水岭防分裂空间聚类与宽门走廊链、MoveCommand 近端吸附及纵向后车让行](../adr/0056-watershed-proof-corridor-chains-command-snap-and-rear-yielding.md)

### P3 寻路与运动 V2 重构（2026-11-21）
- [0057 基于连续测地距截尾中位数的巡航控速与小队指令首拍瞬发](../adr/0057-geodesic-distance-cruise-pacing-and-immediate-squad-orders.md)

### P4 寻路与运动实图硬化与收口（2026-11-21）
- [0058 实图寻路硬化、混编净空统一与走廊及状态收口](../adr/0058-real-map-locomotion-hardening-and-squad-cleanup.md)

### P5 寻路与集群运动融合重构（2026-11-21）
- [0059 阻尼速度惯性、混编统一流域、空间孔径缩列与弧形包抄](../adr/0059-damped-aperture-locomotion-mixed-cohesion-and-surround-arcs.md)

### R2 全 3D 自由轨道镜头与三维交互（2026-11-21）
- [0060 全 3D 自由轨道沙盘镜头、射线锚定操控与三维实体拾取](../adr/0060-orbital-3d-camera-ray-anchored-controls-and-volume-picking.md)

### 前端重构 P3（2026-11-24）
- [0062 客户端贡献点注册：场景层、HUD 面板、检视器与小地图由功能声明、app 装配](../adr/0062-client-contribution-registry.md)
