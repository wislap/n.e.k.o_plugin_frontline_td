# 0057. 基于连续测地距截尾中位数的巡航控速与小队指令首拍瞬发

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-21
- 决策者：wislap
- 批次：P3 寻路与运动 V2 重构
- 领域：模拟
- 部分取代：0034（小队 `advance` 可达性探针改为 $O(1)$ 连通分量查询，且 `SquadsOrder` / `SquadsGather` 下令次 tick 立即生效）
- 部分取代：0054（移除 2D 虚拟领航锚点与路径点转向覆盖，简化 `FormationGuide` 为标量巡航限速并改用 1D 连续测地距截尾中位数控速）

## 背景

在 [ADR 0055](0055-resumable-upwind-eikonal-and-component-reachability.md) 与 [ADR 0056](0056-watershed-proof-corridor-chains-command-snap-and-rear-yielding.md) 落地后，底层移动已由全图连续 Eikonal 流场、共享宽门走廊链与 `729` 槽局部有界重入闭环负责地形拓扑导航。原 [ADR 0054](0054-squad-leader-anchor-role-formations-and-cruise-sync.md) 遗留的 2D 虚拟领航路径点（`FormationGuide { x, y, maxSpeed, active }` 与 `advanceLeaderAnchor` / `probeCorridorWidth`）暴露出三类多余耦合与边界缺陷：

1. **2D 领航锚点墙角挂钩与双层转向冲突**：`advanceLeaderAnchor` 每 10 tick 沿平滑场积分步进再投影路径点，在斜墙或双通道分叉处仍可能把路点投到狭窄边缘或跨墙侧，与 `RouteFollow` 走廊链竞争转向权。
2. **质心离群拖累全队与错峰首拍延迟**：旧巡航同步以欧氏质心为中心，1–2 个隔墙走失单位即可误判离群或拖慢整队巡航；同时 `SquadsOrder` / `SquadsGather` 受 `(tick + squad.id) % 10 === 0` 错峰门控，玩家或导演下令后最高延迟 10 tick（0.5 秒）才开始起步。
3. **周期探针额外分配流场**：`orders.ts` 的 `advance` 分支每隔 10 tick 通过 `acquireProbeWithFallback` 短暂申请并释放 `GoalField` 仅为了判断目标是否仍可达。

## 决策

### 1. 纯标量 `FormationGuide`（`movement/protocol.ts`、`components.ts`、`intents.ts`、`module.ts`）

- 将 `FormationGuide` 精简为 `{ maxSpeed: 'f64', active: 'u8' }`，将 `FormationGuideIntent` 精简为 `{ units: number[]; maxSpeeds?: number[]; active: boolean }`，彻底移除 `x / y` 2D 路径点字段及 `steer` 内两处 `gActive` 路径点转向覆盖分支。
- `steer` 的空间导航完全统一到单调管线：`DIRECT_DIST` 直线直达 / 有界重入 → `RouteFollow` 宽门走廊链 → Eikonal `pathing.smoothDirectionAt`；`FormationGuide` 仅在行军阶段充当标量 `maxSpeed` 上界钳位（`0 < gCap < statSpeed`）。

### 2. 1D Eikonal 连续测地距截尾中位数巡航控速（`squads/sim/{formation.ts,transit.ts,state.ts}`）

- **站位标量定义**：对每个存在有效 `d_i = pathing.distanceAt(probe.goalId, m.x, m.y)` 的行军成员，结合职能持久槽位纵深偏移 `slot.fwd`（ADR 0054 前排/重装为正、后排/远程为负）定义 1D 阵位指标 $s_i = d_i + \text{fwd}_i$（较小表示沿测地线更靠近目标）。
- **抗离群截尾中位数与基准巡航速度**：`computeGeodesicPacing(samples, STRAY_DIST)` 按 `s_i` 升序排列后取中位数 `sMed`，过滤 `|s_i - sMed| <= STRAY_DIST`（10 格）的在队成员 `inBand`（隔墙被困或掉队超过 10 测地格的离群者自动剔除）；当 `inBand.length >= 5` 时两端各截去 20%（`floor(n * 0.2)`）极端值后再取算术均值 `sRef`，以 `inBand` 最小正速度与 `0.5 * vMax` 的较大值作队列基准巡航速 `vCruise`。
- **前压后追放行**：`computeGeodesicCruiseCap` 对距中位数 `> STRAY_DIST` 或落后 `sRef` 超过 `0.75` 格的成员返回 `0`（不限速全速追赶）；仅当 `speed > vCruise * 1.02` 或领先 `ahead = sRef - s_i > 0.65` 时平滑钳位至 `base * max(0.55, 1 - (ahead - 0.65) * 0.15)`。`SquadAnchor` 同步精简为 `{ x, y, hx, hy, halfWidth }`，仅作增援补位时的阵型方向参考。

### 3. O(1) 可达性判定与指令首拍瞬发（`transit.ts`、`orders.ts`、`commands.ts`、`update.ts`）

- 新增 `pickPassableRef` 与 `isGoalReachableWithFallback`：若质心落入障碍格则退避至首个合法成员位置，优先通过 $O(1)$ 连通分量 `pathing.reachable`（支持 Heavy → Standard 回退）判定可达性；`advance` 分支不再每拍申请/释放探针流场，`acquireReachableProbe` 亦先以 `pathing.reachable` 短路不可达目标。
- `Squad` 新增可选持久化字段 `immediate?: boolean`，在 `SquadsOrder` 与 `SquadsGather` 置 `true`；`installSquadsUpdate` 在下个 `orders` 拍消费并清除 `immediate` 立即执行 `updateSquad`，彻底消除 0–9 tick 起步输入延迟，同时保留既有 `(tick + squad.id) % 10 === 0` 错峰周期巡检。

## 后果

- **全地形统一导航与零错峰滞后**：移动转向彻底无 2D 领航路点撕裂风险，点击下令次 tick 全队齐步出发；隔墙单兵掉队不再拉慢主力，混编前排仍保持领跑站位与队形整齐度。
- **零额外流场可达性开销**：小队定期航路体检降为常数时间位读取，且 `FormationGuide` 减少 16 字节/实体内存占用。

## 相关

- [ADR 0034](0034-squads.md)、[ADR 0052](0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)、[ADR 0054](0054-squad-leader-anchor-role-formations-and-cruise-sync.md)、[ADR 0055](0055-resumable-upwind-eikonal-and-component-reachability.md)、[ADR 0056](0056-watershed-proof-corridor-chains-command-snap-and-rear-yielding.md)
- [architecture.md §6.8](../design/architecture.md)
