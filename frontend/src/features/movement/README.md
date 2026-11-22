# movement

## 职责
单位移动结算（ADR 0010 / ADR 0052 / ADR 0053 / ADR 0054 / ADR 0055 / ADR 0056 / ADR 0057 / ADR 0058 / ADR 0059）：沿寻路连续流向梯度与 C¹ 空间孔径平滑脊柱走廊链转向、结合小队标量巡航限速与保持标量速率的方向惯性滤波、
阻尼非对称与同向纵向后车让行均匀网格分离推挤（含 3-tick 接触传染本地到达）、按净空分档的实位移回写积分，以及混合编队统一流域与显式槽位。
移动命令 `frontline_td:movement.move` 在此登记。

## 公开接口
- `sim/index.ts`: `createMovementModule(terrain, pathing) → SimModule`；
  `MoveCommand`（payload `{ units: handle[], x, y }`）；
  `moverComponents`（部件工厂，经 `app/` 注入 unit/结构部件）、
  `MoveSpeed`（目前唯一的修正值统计量，ADR 0013）；
  组件 `Position` / `Mover` / `MoveTarget`。
- `protocol.ts`：`MoveIntent`（支持可选 `slots?: { x, y }[]` 显式槽位）/
  `StopIntent` / `FormationGuideIntent`（小队标量巡航速度上限 `maxSpeeds`；
  AI 与小队驱动单位的正式路径，与 `MoveCommand` 共用同一结算函数）、
  `MoveOrdered` 事件。意图在 movement 相位开头按发出顺序结算（`MoveIntent` 与
  `StopIntent` 先结算，随后结算 `FormationGuideIntent`），校验句柄存活与 `Mover`；
  按 `(cls, tier)` 分组解析目标：`tier = 1`（`2×2` 重型）先探测覆盖目标格的
  4 个重型锚点；目标格不可通行时 `MoveIntent` 经 O(1) `pathing.reachable`
  吸附到 `INTENT_SNAP_RING = 32` 内最近且偏向来向面的可达格（结构中心目标），
  `MoveCommand` 对 `COMMAND_SNAP_RING = 3` 格内障碍或建筑边角同样吸附到面向来军侧的可达格
  （`tier = 1` 对 `1×1` 可通行窄缝仍保留大环重型回退；而 `MoveIntent` 在轻重混编时经 `resolveUnifiedIntentGroups` 优先把重型及重型可达标准单位合入统一 `tier = 1` 目标池防分道），深处不可达目标则拒绝 `'invalid_target'`。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Position {x,y:f64}`、`MoveTarget {goal:u32,x,y,active:u8,stall:u8}`（本模块写）；
  `Velocity {x,y:f64}`、`FormationGuide {maxSpeed:f64,active:u8}` 与
  `RouteFollow {chain:u32,gate:u16,lane:f64,active:u8}` 为内部组件，仅本模块写、不在公共导出
  （走廊链存储与 `blockedByHolder` 集合通过 `frontline_td:movement.routes` 状态键序列化，零额外流场分配）。
- `Mover {speed,radius,cls}`：spawn 烘入，经 `ownComponent` 声明归属本模块、
  无字段写者（ADR 0047）。

## 不变量
- movement 相位四个系统固定顺序：intents（移动意图结算：`MoveIntent` /
  `StopIntent` → `FormationGuideIntent`）→ steer → separate → integrate；
  cleanup 相位另有 release_dead（须先于 combat.despawn，见 sim-registry 注释）。
- 移动命令先校验再改状态：按 `(cls, tier)` 分组（`radius > 0.45` 为
  `CLEARANCE_HEAVY = 1`、`2×2` 足迹）；若 `MoveIntent` 携带 `slots` 且与
  当前子组存在 1:1 映射，跳过螺旋搜槽直接按成员自身净空 `uTier` 校验合法性（非法槽位回退至组目标锚点中心）；
  否则优先收集距目标锚点直线可达（`lineWalkable`，按真实亚格锚点连续 Amanatides–Woo DDA 射线步进）且与目标连通的同侧槽位（方环螺旋、半径 ≤
  `⌈√n⌉ · step + 8`），仅在直达槽位不足人数时由 `directionAt` 连通槽位补齐（仍不足则循环复用），再按保形贪心与 2-opt 分配到
  `clearanceAnchorCenter(c, tier)`。写完槽位后由 `assignClusterRoutes` 对多成员子组按
  `distSq <= 81`（9 格）且可行走直线划定空间簇，开阔直通或近距离（`<= 8` 格）跳过，其余簇沿
  唯一共享 `tgtGoal` 提取 1.5 格弧长 C¹ 空间孔径走廊链（采样步长 `0.5`、门距 `1.5`、最大半宽 `4.5`、`<= 4.5` 格终止、`buildWideGate` 要求新门中心与 `prevGate` 直线直通、拐弯处自动补门、桥前反向漏斗 `min(cur, nxt + 0.7)` 并将前瞻 `[arc, arc+4.5]` 最窄半宽两轮 `[0.25, 0.5, 0.25]` 平滑写入 `aperture ∈ [0.22, 1.0]`）并归一化写入 `lane ∈ [-1, 1]`。
- 转向、空间孔径脊柱、惯性阻尼与传染到达（ADR 0052 / ADR 0053 / ADR 0054 / ADR 0056 / ADR 0057 / ADR 0058 / ADR 0059）：槽位
  `<= 3.8` 格且同档位格子直线可走（`lineWalkable(..., tier)`）时直线驶向槽位并释放 `RouteFollow`；`dist ∈ (3.8, 8.0]` 且存在活跃 `RouteFollow` 时将脊柱切向线性渐隐过渡到槽位直连向量；`RouteFollow.active === 1`
  经 `steerApertureSpine` 按 `[k, k+10]` 动态阻挡校验、车道接近距离（`<= 2.25` 格）与 V 型契形前瞻（`lookAhead = 2.1 - |lane| * (1 - curAp) * 0.75`）融合插值车道路点与脊柱切向（不强压链级速度；标准成员若在重型流场空区则懒惰回落 `tier = 0` 流场）。巡航速度上限 `gCap` 仅在
  `FormationGuide.active === 1` 且 `0 < gCap < statSpeed` 时夹紧标量 `maxSpeed`，
  不经 `MoveSpeed` 修正值通道以避免与 `EnergyLowModifier` 叠加（ADR 0054 / ADR 0057）；`steer` 将速度方向与上拍 `integrate` 回写的实际位移矢量做惯性混合（`alpha = 0.48`，近点 `0.72`，`>90°` 折返施加 `0.28` 右偏让行、`alpha = 0.45` 与 `0.75` 折返减速）而保持前向 `effSpeed`；距目标 `<= 3.6` 且被同阵营已持槽位者前向阻挡连续 `stall >= 3` tick 时原地传染安顿为 `active = 2`。
  `MoveIntent`、`StopIntent`、`MoveCommand`、到点守位 `holdUnit`、
  不可达停住 `stopUnit` 与死亡 `release_dead` 均清空 `FormationGuide`、`RouteFollow` 与 `MoveTarget.stall`。
  接近槽位且距目标 `< SLOWDOWN_DIST = 0.85` 时进入平滑减速带；距槽位 ≤
  `ARRIVAL_ENTER_DIST = 0.18` 时释放流场引用并切入 `active = 2` 守位；
  守位仅在被推离超过 `HOLD_DEADBAND_DIST = 0.36` 时平滑回拉，滞回带
  `(0.18, 0.36]` 内保持静止；流场不可达则走 `stopUnit`（释放目标、`active = 0`）。
- 阻尼非对称分离、同向后车让行与持有者阻挡探测（ADR 0053 / ADR 0056 / ADR 0059）：缓冲间隙 `SEPARATION_GAP = 0.08`（接触传染阈值 `0.16`），采用双斜率
  过阻尼推力（缓冲带刚度 `0.25`、穿透核心刚度 `0.65`）；2 格均匀桶、
  升序 id、固定邻桶序，重合时按 id 奇偶选轴；同阵营按 `r² × stateWeight`
  （moving `2.5`、stopped `1.8`、holding `0.6`）反比让路，敌对阵营按 `r²`；
  同阵营双行进单位速度同向（`vA·vB > 0`）且纵向投影 `|cosLong| > 0.25` 时，前车质量权重
  最高放大 `FRONT_MOVER_MAX_MULT = 3.5×` 使后车承担主要纵向退让，且相对逼近时仅对后车施加
  `OVERTAKE_WRAP_FACTOR = 0.35` 单侧超车切向滑步；对向相遇与动对静叠加 `WRAP_FACTOR = 0.60` 切向绕行分量；单 tick 累加
  推力按 `max(0.06, speed * 1.15)` 限幅。
- 积分与墙体边距（ADR 0053 / ADR 0059）：速度为零走快速跳过并清零实际速度；非零步按 `(cls, tier)`
  执行 `canStep`（整步失败先尝试仅 x、再仅 y），随后经 `clampFootprintMargin`
  （标准 `min(r * 0.75, 0.30)`、重型 `min(r * 0.85, 0.75)`）夹紧封闭正交
  墙面与凸角圆弧，夹紧边界并将 `(finalX - px, finalY - py)` 回写 `Velocity`；`movement/sim/` 全路径严格遵守纯数学与
  热路径零堆分配约束。
- 只有 `active=1` 的单位持有共享目标引用，到达驻留时已释放；所有
  释放点统一走 `releaseHeldGoal`，不自行判断 `active≠0`（ADR 0045）。

## 对应设计
- [architecture.md §6.8](../../../../docs/design/architecture.md)
  （流场与移动结算）。
- [ADR 0010](../../../../docs/adr/0010-terrain-model-sector-flowfields.md)
  （模型）、[ADR 0013](../../../../docs/adr/0013-modifier-pipeline.md)
  （MoveSpeed 修正值）、[ADR 0020](../../../../docs/adr/0020-numeric-time-capacity-conventions.md)
  （整数约定）、[ADR 0027](../../../../docs/adr/0027-map-terrain-flowfield-movement.md)
  （先校验后改动）、[ADR 0034](../../../../docs/adr/0034-squads.md)
  （移动意图驱动）、[ADR 0052](../../../../docs/adr/0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)
  （地形净空分档与连续流向梯度）、[ADR 0053](../../../../docs/adr/0053-damped-asymmetric-avoidance-arrival-hysteresis-and-wall-margins.md)
  （阻尼非对称避让、到达迟滞与墙体边距）、[ADR 0054](../../../../docs/adr/0054-squad-leader-anchor-role-formations-and-cruise-sync.md)
  （混编职能分排与巡航控速）、[ADR 0055](../../../../docs/adr/0055-resumable-upwind-eikonal-and-component-reachability.md)
  （可恢复迎风 Eikonal 与可达性）、[ADR 0056](../../../../docs/adr/0056-watershed-proof-corridor-chains-command-snap-and-rear-yielding.md)
  （空间聚类宽门走廊链、`MoveCommand` 近端吸附与纵向后车让行）、[ADR 0057](../../../../docs/adr/0057-geodesic-distance-cruise-pacing-and-immediate-squad-orders.md)
  （连续测地距巡航控速与纯标量 `FormationGuide`）、[ADR 0058](../../../../docs/adr/0058-real-map-locomotion-hardening-and-squad-cleanup.md)
  （实图寻路硬化、亚格连续 DDA 与走廊/实例隔离收口）、[ADR 0059](../../../../docs/adr/0059-damped-aperture-locomotion-mixed-cohesion-and-surround-arcs.md)
  （速度惯性阻尼、传染停驻、混编统一流域与 C¹ 空间孔径脊柱）。
