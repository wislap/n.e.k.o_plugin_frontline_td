# 0058. 实图寻路硬化、混编净空统一与走廊及状态收口

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-21
- 决策者：wislap
- 批次：P4 寻路与运动实图硬化与收口
- 领域：模拟
- 部分取代：0055（澄清 Dial 环形桶采用 O(1) FIFO 尾插出队，由固定起点与 DIR_ORDER 保证确定性）
- 部分取代：0056（lineWalkable 升级为精确亚格 Amanatides–Woo DDA；buildWideGate 强制门间直线直通并加入拐角补门与桥前反向宽度漏斗；steerRouteFollow 移除旧门回望并收口为实例局部重入缓冲）
- 部分取代：0057（新增 resolveSquadGoalAtTier 对不可通行目标做 6 格来向面吸附、projectFormationSlots 测地距防跨崖过滤、统一混编小队净空口径并将 SquadAnchor 精简为 heading）

## 背景

在 [ADR 0055](0055-resumable-upwind-eikonal-and-component-reachability.md)–[0057](0057-geodesic-distance-cruise-pacing-and-immediate-squad-orders.md) 落地后，真实地形图 `proto_01`（`96×64` 双坡道高台、中央斜向 2 格河桥与占格前哨建筑）的全编队实战与紧随其后的代码审计暴露出四类边界缺陷与长期维护债：

1. **斜向窄桥宽门漂移与回看旧门死循环**：`buildWideGate` 重居中时未验证与上一道门之间是否仍直线可走，且 `steerRouteFollow` 回看 `k - 2` 旧门会在桥头地形折返处形成反复横跳；同时格心近似 `0.5 / adx` 的 `lineWalkable` 会漏判贴近悬崖边缘亚格处即将跨出的悬崖格。
2. **占格建筑目标劫持与跨崖阵型投影**：玩家对敌方占格建筑下 `SquadsOrder('advance')` 时，目标自身不可通行导致 `isGoalReachableWithFallback` 直接拒判并触发 `retargetStructure` 改打附近其他前哨；`projectFormationSlots` 仅按欧氏螺旋找槽容易把槽位投到悬崖背面。
3. **混编小队净空口径分裂与早停补发不一致**：`ensureSquadSlotsAndEmitMove` 对重轻混编采用 `tier = 0`（`every Heavy`），而 `emitTransitGuide` 与 `orders.ts` 的可达性检测却采用 `tier = 1`（`some Heavy`），导致每 10 tick 额外构造又丢弃一次 `tier = 1` 流场且 1 格窄巷内的标准成员 `distanceAt` 为空；仅存在 `idleFar` 成员时也未复用 6 格吸附格。
4. **S3 遗留死字段/死参数与热路径可读性债**：`SquadAnchor` 仍序列化已无读者的 `x / y / halfWidth`，`projectFormationSlots` 保留恒传 `(1, 1)` 的 `widthScale / depthScale`；`RouteChainStore` 将有界重入 BFS 临时数组放在模块全局；`grid-cache.ts`、`eikonal.ts` 与 `pathing/sim/module.ts` 充斥裸数字位掩码且 `ensureComponents` 未复用 `ensureCellBaked`。

## 决策

### 1. 连续亚格 DDA 与前后单调宽门走廊（`movement/sim/{line,route-store,route-chain}.ts`）

- **精确亚格 Amanatides–Woo DDA**：`lineWalkable` 按连续世界锚点坐标 `(u0, v0) -> (u1, v1)` 到最近格界的准确距率初始化 `tMaxX / tMaxY`（带 `canX / canY` 严格单调防死循环保护），消除贴崖/贴墙亚格漏判反弹。
- **门间直通、拐角补门与桥前宽度漏斗**：`buildWideGate(..., prevGate?)` 仅在与 `prevGate` 之间亦满足 `lineWalkable` 时才允许偏移门心；`assignClusterRoutes` 在流线弯出当前直视段时自动在最后合法步点插入拐角门，并逆向运行宽度收敛（`cur.leftW = min(cur.leftW, nxt.leftW + 1.25)`、`rightW` 同理）以在进窄桥/坡道前平滑收窄车道。
- **前向单调走廊随动与实例隔离**：删除 `steerRouteFollow` 回看 `k - 2` 旧门分支并在确认当前门 `gk` 后显式重算 `lanePt`；将 `RejoinBfsScratch`（729 槽有界 BFS 数组与递增 `stamp`）移入 `createRouteChainStore()` 实例内部，保持零热路径堆分配的同时隔离多 `Simulation` 实例。

### 2. 小队目标吸附、混编净空统一与模型瘦身（`squads/sim/{state,formation,transit,orders,commands}.ts`）

- **不可通行目标来向面吸附与测地防跨崖**：新增 `resolveSquadGoalAtTier`（`SQUAD_GOAL_SNAP_RING = 6`），当且仅当目标格自身不可通行时向来向面最近可达格吸附（可通行格若被墙封死仍返回 `null` 以保留 `retargetStructure` 自动破墙改判），并由 `resolveGoalCellWithFallback` 统一服务可达性判定与 `idleFar` 续推发令；`projectFormationSlots` 剔除冗余的 `widthScale / depthScale` 参数并增加测地距过滤 `gd <= sqrt(euclidSq) * 2.5 + 2.5`（带 `farChosen` 兜底）。
- **混编净空统一与 `SquadHeading` 瘦身**：抽取 `squadGoalTier`（全员重型取 `CLEARANCE_HEAVY`，混编取 `CLEARANCE_STANDARD`），统一 `ensureSquadSlotsAndEmitMove`、`emitTransitGuide` 与 `orders.ts` 的 `GoalField` 档位；将 `SquadAnchor` 精简为 `SquadHeading { hx, hy }`（`squad.heading`），合并 `ensureSquadSlotsAndEmitMove` 的全量重建与增量补位探针投影逻辑，并消除 `intents.ts` 中的 `O(N²)` 查重与重复清理。

### 3. `pathing/sim` 单一烘焙真源与命名方向位掩码（`grid-cache.ts`、`eikonal.ts`、`module.ts`）

- 在 `grid-cache.ts` 内导出内部具名位掩码常量 `DIR_N..DIR_NW`、`DIR_CARDINAL` 取代分散的裸数字掩码；显式注释 `tier = 0` 地表代价缓存对 `TerrainApi.stepCost` 对称性的前置依赖；令 `ensureComponents()` 直接复用 `cache.ensureCellBaked` 与双向 `dirMask` 位校验。

## 后果

- **实图复杂地形稳态通行**：`proto_01` 全图 6 大地标 24 单位行军全员平滑抵达、占格东前哨右键直攻不被劫持，并在独立场景测试 `proto01-locomotion.scenario.test.ts` 与混编窄巷/早停回归测试中锁定。
- **技术债与文档同步落地**：`transit.ts` 回到 600 行红线安全区内，混编小队巡航不再每 10 tick 空耗 `tier = 1` 探针流场；同步修正 ADR 0055 FIFO 措辞与 ADR 0010 头部实现状态，以及 `architecture.md`、`movement/README.md`、`squads/README.md`。

## 相关

- [ADR 0010](0010-terrain-model-sector-flowfields.md)、[ADR 0055](0055-resumable-upwind-eikonal-and-component-reachability.md)、[ADR 0056](0056-watershed-proof-corridor-chains-command-snap-and-rear-yielding.md)、[ADR 0057](0057-geodesic-distance-cruise-pacing-and-immediate-squad-orders.md)
- [architecture.md §6.8](../design/architecture.md)
