# 0059. 阻尼速度惯性、混编统一流域、空间孔径缩列与弧形包抄

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-21
- 决策者：wislap
- 批次：P5 寻路与集群运动融合重构
- 领域：模拟
- 部分取代：0052（在 `smoothDirectionAt` Stage 1/2 失败时增加 Stage 2b 贴墙单侧迎风合法梯度回退，保留亚格安全门控）
- 部分取代：0053（`integrate` 实际位移回写 `Velocity` 并对 `steer` 航向引入保留标量速率的惯性滤波；新增 `MoveTarget.stall` 3 tick 接触传染本地停驻与 `blockedByHolder` 存档往返）
- 部分取代：0054（交战包抄改用 `projectSurroundArcSlots` 15 射线射程扇弧落位与同射程带 2-opt 解交叉，替代向敌心投影成块）
- 部分取代：0056（`MoveIntent` 轻重混编优先共享重型可达 `GoalField` 消除 1 格窄缝分道拆队；引入 1.5 格弧长 C¹ 平滑空间孔径脊柱与 `[3.8, 8.0]` 终端平滑渐隐替代离散路门硬切换）
- 部分取代：0058（将 `squadGoalTier` 混编小队默认净空统一提升至 `CLEARANCE_HEAVY`，仅对跨墙离群标准成员懒惰探测 `CLEARANCE_STANDARD`；桥前反向宽度漏斗斜率由 `1.25` 改为 `0.7`）

## 背景

[ADR 0056](0056-watershed-proof-corridor-chains-command-snap-and-rear-yielding.md)–[0058](0058-real-map-locomotion-hardening-and-squad-cleanup.md) 解决了实图卡死与跨崖分裂后，通过新建的多场景轨迹对比评估台（`eval/locomotion/`）暴露出四项核心运动学短板：

1. **混编小队窄缝分道拆队（S8 `Gap = 9.06` 格）**：`squadGoalTier` 与 `MoveIntent` 按 `(cls, tier)` 各自申请不同净空的 `GoalField`，标准单位绕近钻 1 格窄缝而 2×2 重型绕远走 3 格宽道，导致同一混合编队在中途彻头彻尾分头行动。
2. **每帧无记忆转向与排斥正交冲突**：`integrate` 未将实际跨步位移回写 `Velocity`，而 `steer` 每 tick 无条件覆写全速目标向量；一拍 `separate` 横向让行、下一拍 `steer` 立刻抹零重新硬顶，造成高密度瓶颈区高频 `>60°` 急转锯齿与动态改道踩踏。
3. **贴墙梯度退化与离散路门折角**：2 格窄弯贴墙格中心差分跨越墙体直接失效回落到 8 向离散网格，且 `RouteFollow` 的 `3.0` 格离散切换与 `8.0` 格硬切断会在入弯/出阵前触发瞬时方向跳变。
4. **交战后排顶撞与占位死磕**：遇敌展开把射程外后排向敌心投影成块；同时被已停稳友军挡住槽位的单位缺少局部“传染停驻”，会在阵型后排长时间挤压抖动。

基于评估台对 3 套正交原型（`H1` 阻尼惯性、`H2` 9 射线局部预测、`H3` 虚拟脊柱）的 8 场景 + 2000 单位压测对拍，`H2` 局部射线在高密群体下 CPU 开销飙升且近战绕圈慢，而 `H3` 的时间维强制 `minSpeed` 领航板会与小队层 `FormationGuide` 叠加踩刹车拖慢收口。因此决定采纳 **H1 阻尼底座 + 无强制压速的 H3 纯空间孔径缩列 + 终端平滑渐隐** 融合方案。

## 决策

### 1. 共享地基：贴墙梯度、统一流域与弧形包抄（`F-1` / `F-2` / `F-3`）

- **`pathing` Stage 2b 贴墙单侧迎风平滑（`pathing/sim/smooth.ts`）**：当 Stage 1 双线性与 Stage 2 对称中心差分失效时，仅对 `passable && stepCost >= 0` 的单侧合法正交邻格评估迎风势能斜率，并经合成步合法性与严格下降门控输出贴墙连续切向。
- **混编统一流域（`squads/sim/transit.ts`、`movement/sim/{target-resolve,intents,module}.ts`）**：混编小队与 `MoveIntent` 优先按整体连通性求取统一 `CLEARANCE_HEAVY`（重型 2×2 足迹覆盖）目标锚点与 `GoalField`，使可随重装同行的标准单位共享同一条重型主干道与 `RouteChain`；各成员仅在显式槽位校验与近身步进时按自身 `uTier` 验证格点，跨墙隔离的标准孤立单位才懒惰回落 `CLEARANCE_STANDARD`。
- **遇敌扇弧包抄（`squads/sim/{formation,orders}.ts`）**：交战推进阶段调用 `projectSurroundArcSlots`，围绕目标按来向法线两侧交替扩展预计算 15 射线扇弧（近战贴圈半径 `0.85`，远程按射程内缩），再对同射程差 `<= 1.5` 成员执行 2-opt 解交叉，使后排顺滑包向两翼而非顶推前排。

### 2. 运动学阻尼、传染停驻与存档一致（`movement/sim/{components,intents,separate,module}.ts`）

- **真实位移速度回写与方向保持惯性**：`integrate` 将实际合法平移 `(finalX - px, finalY - py)` 写回 `Velocity`；`steer` 将单位方向朝期望切向平滑混合（`alpha = 0.48`，近槽位 `dist < 1.2` 取 `0.72`，`>90°` 大角折返施加 `0.28` 右偏礼让、`alpha = 0.45` 与 `0.75` 折返减速），同时在正常前向运动时**严格保持 `effSpeed` 标量不被衰减**以兼容 `FormationGuide` 精确控速契约。
- **接触传染停驻与状态持久化**：`separate` 探测被同阵营持有槽位者（`active === 2`）近距前方挡路且目标相距 `<= 4.8` 格的单位并记录 `blockedByHolder`；`steer` 统计连续 3 tick 实速低于 `0.35 * effSpeed`（写入 `MoveTarget.stall: 'u8'`）后将其就地安顿为 `active = 2`。`blockedByHolder` 经 `saveBlocked/loadBlocked` 随 `frontline_td:movement.routes` 状态键一并序列化，确保途中存档/读档确定性。

### 3. 纯空间 C¹ 孔径缩列脊柱与终端平滑渐隐（`movement/sim/{aperture-spine,route-chain,route-store,module}.ts`）

- **1.5 格弧长 C¹ 孔径烘焙**：`assignClusterRoutes` 按 `TRACE_SUBSTEP = 0.5`、`GATE_STEP_DIST = 1.5` 采样带 `arc` 参数的 `RouteGate`（逆向漏斗斜率 `0.7`/门）；对每个门前瞻 `[arc, arc + 4.5]` 走廊最窄半宽计算目标孔径 `aperture ∈ [0.22, 1.0]` 并做两轮 `[0.25, 0.5, 0.25]` 邻域平滑。
- **零压速 V 型楔形随动与外翼接近判定**：`steerApertureSpine` 在 `[k, k+10]` 保留动态阻挡自愈检查，按自身门距或车道点接近（`dist <= 2.25` 格）平滑前推路门下标（防止锐弯外翼滞留），按 `lookAhead = 2.1 - |lane| * (1 - curAp) * 0.75` 前瞻采样插值车道点，并与走廊中心线切向按横向误差动态融合（经 `0.6` 格 `canStep` 守门）；彻底不施加链级人工降速。
- **`[3.8, 8.0]` 终端平滑渐隐**：`dist <= 8.0` 且直线可行时，随距离从 `8.0` 到 `3.8` 线性把 `RouteFollow` 输出混合到目标槽位直连向量，并在 `dist <= 3.8` 后释放走廊链直接收口。

## 后果

- **核心效果**：8 大极限评估场景全员 `100%` 到达；`S8` 混编拆队彻底消除（`MaxGap` 从 `9.06` 降至 `1.80`，`Turn>60°` 从 `267` 次降至 `6` 次）；`proto_01` 真实地图（`S2`）`Turn>60°` 从 `174` 次降至 `49` 次（`-72%`）、过桥通量升至 `30.0/100t`；`S4` 对穿收敛 `20t` / 抖动 `9.1°`；`S6` 最快 `23t` 达到 80% 集火。2000 单位 perf 全帧 `1.344 ms`（`662.8 ticks/s`）。
- **测试与契约验证**：更新 `movement/sim/determinism.test.ts` 与 `eval/match-smoke.scenario.test.ts` 黄金哈希；新增 `movement/sim/locomotion-fusion.test.ts` 与 `formation.test.ts` 包抄回归测试，全量 `npm run verify`（含 90s 途中存档还原一致与全包构建产物大小门禁）通过。

## 相关

- [architecture.md §6.8](../design/architecture.md)
- [ADR 0052](0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)、[ADR 0053](0053-damped-asymmetric-avoidance-arrival-hysteresis-and-wall-margins.md)、[ADR 0054](0054-squad-leader-anchor-role-formations-and-cruise-sync.md)、[ADR 0056](0056-watershed-proof-corridor-chains-command-snap-and-rear-yielding.md)、[ADR 0057](0057-geodesic-distance-cruise-pacing-and-immediate-squad-orders.md)、[ADR 0058](0058-real-map-locomotion-hardening-and-squad-cleanup.md)
