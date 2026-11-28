# 0056. 分水岭防分裂空间聚类与宽门走廊链、MoveCommand 近端吸附及纵向后车让行

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-21
- 决策者：wislap
- 批次：P2 寻路与运动 V2 重构
- 领域：模拟
- 部分取代：0027（为 `MoveCommand` 引入 `<= 3` 格近端向己侧吸附，替代死区零容错直接拒绝）
- 部分取代：0034（MoveCommand 改为近端 3 环可达吸附，不再零容错拒绝）
- 部分取代：0053（在同阵营双行进单位分离中增加纵向后车让行与单侧超车切向滑步，消除后车顶推前车抽动；resolveTierTarget 改为 maxSnapRing）
- 部分取代：0054（在流场之上引入共享宽门走廊链 `RouteChain` 与内部组件 `RouteFollow`，从根源消除障碍物中线处的分水岭分裂与稀疏孤立绕路）

## 背景

在 [ADR 0055](0055-resumable-upwind-eikonal-and-component-reachability.md) 建立全图连续迎风 Eikonal 流场后，单体测地绕障与开阔地直行精度已达 1.03 倍欧氏距离以内，但在多单位玩家操作与群体行军中仍存在三类体验痛点：

1. **障碍物分水岭分裂（Watershed Splitting）**：同一批紧密站位的单位若跨越大型障碍物（或双通道）中线，Eikonal 梯度在脊线两侧自然分叉。少数位于外侧边缘的单位会沿着另一条完全不同的绕障分支大幅脱队绕行，破坏“整队作为一个整体绕同侧通过”的直觉预期。为每支集群复制独立 `GoalField` 内存开销过高，必须在不分配额外流场的前提下锁定共享拓扑走廊。
2. **`MoveCommand` 对遮挡边角零容错拒绝**：在 `MoveCommand` 下若玩家点击在 3×3 建筑体心或岩石边缘 1–3 格内，`resolveTierTarget`（`allowSnap = false`）直接返回 `invalid_target` 静默无效；即使用意图吸附（`allowSnap = true`）也仅按螺旋首次命中而非偏向来向面。
3. **纵向同向队列后车顶推前车**：混编快慢单位或拥挤纵队同向行军时，旧分离力仅按静态 `r²` 等权分配（同处于 `active === 1` 的两单位质量权重完全相等），导致后方高速单位直接把前方慢速单位往前“撞推”，同时两侧超车切向力还会将前车横推偏离路径。

## 决策

### 1. 基于共享流场的空间聚类与宽门走廊链（`route-store.ts`、`route-chain.ts`、`components.ts`）

- **内部组件与状态序列化**：在 `movement/sim/components.ts` 新增永久内部组件 `RouteFollow { chain: u32, gate: u16, lane: f64, active: u8 }`（不从 `movement/sim/index.ts` 导出，保持与 `Velocity`、`FormationGuide` 同等内部封装边界）；状态键 `frontline_td:movement.routes` 按 `chainSlots` 升序保存当前激活 `RouteChain`（全闲置时仅存 `{ nextId, freeIds, chains: [] }`），确保 mid-run 存档与恢复位级一致。
- **可行走单链聚类（Walkable Single-Linkage BFS）**：在 `applyMoveGroup` 为同一 `(cls, tier)` 子组写入目标后，先释放旧 `RouteFollow` 引用；若 `clsIds.length >= 2`，按 `distSq <= 81`（9 格）且（同锚格或 `lineWalkable` 直通）划分为若干局部连通团。跨墙或相距超过 9 格的不同团独立规划、互不干扰，避免把隔墙部队强拉过墙；对 64 单位密堆出生点跳过已访问节点，实际仅需 $O(|C|)$ 次直线校验。
- **开阔地极速跳过**：对每个 `|C| >= 2` 的集群取最接近质心且流场可达的代表单位，若质心距目标 `<= 8` 格，或代表单位至目标 `lineWalkable` 为真且集群极端轮廓点（全员不超过 8 点，或极值 x / y / x+y / x-y 8 点）均可直达对应槽位，则跳过走廊构建，直接享受连续 Eikonal 流场零误差直行。
- **共享宽门丝带提取与零额外流场约束**：仅在不满足开阔地直达时，从代表单位位置沿唯一共享的 `tgtGoal`（禁止额外调用 `pathing.acquireGoal`）调用 `smoothDirectionAt` 步进追踪（步长 `0.75`、上限 `360` 步、距终点 `<= 6.5` 格提前终止）。每 `3.0` 格（首门在 `s >= 2.5`）采集一个 `RouteGate { x, y, ax, ay, tx, ty, nx, ny, halfW, leftW, rightW }`：沿右法线 ± 方向以 `0.5` 格步长（保持格间 `canStep` 连续性，防跨缝跳跃）探测通行余宽 `<= 4.5` 格，在 `[-2.25, +2.25]` 内居中偏移中心并从新门中心复核左右净宽 `leftW / rightW`（扣除 `0.35` 边距），保留最宽 `4.5` 格双排通行宽度而不塌缩成单点排队。
- **车道保持与自愈回退 steer**：入队成员按起始相对第一门的横向投影归一化并截断为 `lane ∈ [-1, 1]`。`steer` 优先检查 `DIRECT_DIST` 直达终点（命中即释放 `RouteFollow`）；否则运行 `steerRouteFollow`：自动推进已越过或 `1`-门平滑前瞻的门索引，纯算术计算 `min(clusterHalfW, sideW) * lane` 处车道点；若遇障碍物阻挡，依次回退至门中心、前两门回望重汇，或用 `RouteChainStore` 内 256 槽确定性直接映射备忘表与预分配 729 槽静态定长数组在 `|dx|,|dy| <= 12` 窗口内做 8 邻域有界 BFS 重入（同表亦加速 `DIRECT_DIST` 近端未直线直达目标的重汇）；一旦动态障碍封死门格或 BFS 不可达，立即释放 `RouteFollow` 并无缝回落至 `pathing.smoothDirectionAt`。
- **同侧槽位优先（`intents.ts`）**：`applyMoveGroup` 默认优先收集从吸附后目标直线直达（`lineWalkable`）的编队槽位，避免在障碍边缘自动将少数士兵分槽穿墙到障碍背面；仅当直达可用槽位不足人数（如狭长高台/弯道）时才以 `directionAt` 流场连通槽位补齐。

### 2. `MoveCommand` 近端（`<= 3` 格）面向来向面吸附与 O(1) 连通性判定（`intents.ts`）

- **双档吸附半径**：保留 `MoveIntent` 的 `INTENT_SNAP_RING = 32`，为 `MoveCommand` 启用 `COMMAND_SNAP_RING = 3`（覆盖建筑中心及岩石边缘 1–3 格误点，超出 `<= 3` 格的深岩核心点击仍严格拒绝 `invalid_target`）；`CLEARANCE_HEAVY` 在目标格本身属于 `1×1` 可通行窄缝时仍保持大范围重型锚点回退。
- **O(1) 连通分量校验与来向面偏好评分**：以 `pathing.reachable(..., cls, tier)` 替代 `snapReachable` 中反复 `acquireGoal / directionAt / releaseGoal` 触发流场计算的旧写法；评分函数 `((dx² + dy²) * 1024) + distSq(candCenter, groupCentroid)` 在同环/近环等距候选中优先选取朝向来军质心的一侧，令点击建筑中心自动吸附到部队面前一侧边缘。

### 3. 同向行军纵向后车让行与单侧超车滑步（`separate.ts`）

- **前车动态增重**：在同一阵营双移动单位（`actA === 1 && actB === 1`）且速度同向（`vA · vB > 0`）碰撞分离时，计算分离法线与合成前进方向余弦 `cosLong = (u · (vA + vB)) / ||vA + vB||`；当 `|cosLong| > 0.25` 时按 `tLong = (|cosLong| - 0.25) / 0.75` 对处于前方的单位 `wMass` 线性放大至最高 `3.5×`（`1 + 2.5 * tLong`），令后方快车或拥挤追尾单位承担约 78% 纵向退让，杜绝后车将前车顶飞或引发队列纵向抽动。
- **单侧切向超车**：当后车确有相对逼近分量（`(vA - vB) · u > 1e-4`）时，仅对后车施加 `OVERTAKE_WRAP_FACTOR = 0.35` 切向滑步绕行（优先延续后车既有横向速度倾向，零横向分量按实体 ID 奇偶打破对称），不对前车施加多余横向干扰。

## 后果

- **整队同侧绕障与宽阵列保持**：围绕大块障碍或双桥时，紧密集群全员严格锁定同一流场拓扑侧，既保留通道实际宽度又不为各分支重复开辟 `GoalField` 内存；动态新修建筑封路可在单帧内释放走廊链交由 Eikonal 重算。
- **玩家操作手感提升与热路径零分配**：点击建筑/墙角 3 格内自动贴到己方来向侧，深处障碍依旧拒止；`RouteChain`、有界回汇 BFS（729 格模块静态数组）与 `separate.ts` 均零热路径堆分配，并与现有 `Movement` + `Squads` 单调管道兼容。

## 相关

- [ADR 0006](0006-determinism.md)、[ADR 0027](0027-map-terrain-flowfield-movement.md)、[ADR 0052](0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)、[ADR 0053](0053-damped-asymmetric-avoidance-arrival-hysteresis-and-wall-margins.md)、[ADR 0054](0054-squad-leader-anchor-role-formations-and-cruise-sync.md)、[ADR 0055](0055-resumable-upwind-eikonal-and-component-reachability.md)
- [architecture.md §6.8](../design/architecture.md)
