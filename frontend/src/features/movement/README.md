# movement

## 职责
单位移动结算（ADR 0010 / ADR 0052 / ADR 0053 / ADR 0054）：沿寻路连续流向梯度或小队瞬态领航锚点转向、
阻尼非对称均匀网格分离推挤、按净空分档的可通行性与墙体边距积分，以及显式槽位与巡航速度上限同步。
移动命令 `frontline_td:movement.move` 在此登记。

## 公开接口
- `sim/index.ts`: `createMovementModule(terrain, pathing) → SimModule`；
  `MoveCommand`（payload `{ units: handle[], x, y }`）；
  `moverComponents`（部件工厂，经 `app/` 注入 unit/结构部件）、
  `MoveSpeed`（目前唯一的修正值统计量，ADR 0013）；
  组件 `Position` / `Mover` / `MoveTarget`。
- `protocol.ts`：`MoveIntent`（支持可选 `slots?: { x, y }[]` 显式槽位）/
  `StopIntent` / `FormationGuideIntent`（小队领航瞬态路径点与巡航速度上限；
  AI 与小队驱动单位的正式路径，与 `MoveCommand` 共用同一结算函数）、
  `MoveOrdered` 事件。意图在 movement 相位开头按发出顺序结算（`MoveIntent` 与
  `StopIntent` 先结算，随后结算 `FormationGuideIntent`），校验句柄存活与 `Mover`；
  按 `(cls, tier)` 分组解析目标：`tier = 1`（`2×2` 重型）先探测覆盖目标格的
  4 个重型锚点；目标格不可通行时 `MoveIntent` 吸附到最近可通行且可达格
  （出发生成螺旋，环 32），`MoveCommand` 对可通行但 `2×2` 放不下的
  窄缝也可就近吸附到重型可达格，仅对不可通行目标格拒绝。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Position {x,y:f64}`、`MoveTarget {goal:u32,x,y,active:u8}`（本模块写）；
  `Velocity {x,y:f64}` 与 `FormationGuide {x,y,maxSpeed:f64,active:u8}`
  为内部组件，仅本模块写、不在公共导出。
- `Mover {speed,radius,cls}`：spawn 烘入，经 `ownComponent` 声明归属本模块、
  无字段写者（ADR 0047）。

## 不变量
- movement 相位四个系统固定顺序：intents（移动意图结算：`MoveIntent` /
  `StopIntent` → `FormationGuideIntent`）→ steer → separate → integrate；
  cleanup 相位另有 release_dead（须先于 combat.despawn，见 sim-registry 注释）。
- 移动命令先校验再改状态：按 `(cls, tier)` 分组（`radius > 0.45` 为
  `CLEARANCE_HEAVY = 1`、`2×2` 足迹）；若 `MoveIntent` 携带 `slots` 且与
  当前子组存在 1:1 映射，跳过螺旋搜槽直接逐一校验 `inBounds` 与
  `terrain.passable(..., cls, tier)`（非法槽位回退至组目标锚点中心）；
  否则按移动类别与净空分档收集目标周围可通行（重型按足迹步长去重）且与目标连通的槽位（方环螺旋、半径 ≤
  `⌈√n⌉ · step + 8`，不足则循环复用），再按保形贪心与 2-opt 分配到
  `clearanceAnchorCenter(c, tier)`。
- 转向、瞬态领航与到达迟滞（ADR 0052 / ADR 0053 / ADR 0054）：槽位
  `DIRECT_DIST = 8` 格内且同档位格子直线可走（`lineWalkable(..., tier)`，
  DDA 逐步 `stepCost >= 0`）时优先直线驶向槽位；否则若 `FormationGuide.active === 1`
  且领航点距当前位置平方距离处于 `(0.0625, DIRECT_DIST²]` 且 `lineWalkable`，
  则先朝领航点转向并跳过靠近槽位减速；否则消费连续流向梯度
  `pathing.smoothDirectionAt(goal, px, py)`。巡航速度上限 `gCap` 仅在
  `FormationGuide.active === 1` 且 `0 < gCap < statSpeed` 时夹紧 `maxSpeed`，
  不经 `MoveSpeed` 修正值通道以避免与 `EnergyLowModifier` 叠加（ADR 0054）；
  `MoveIntent`、`StopIntent`、`MoveCommand`、到点守位 `holdUnit`、
  不可达停住 `stopUnit` 与死亡 `release_dead` 均清空 `FormationGuide`。
  接近槽位且距目标 `< SLOWDOWN_DIST = 0.85` 时进入平滑减速带；距槽位 ≤
  `ARRIVAL_ENTER_DIST = 0.18` 时释放流场引用并切入 `active = 2` 守位；
  守位仅在被推离超过 `HOLD_DEADBAND_DIST = 0.36` 时平滑回拉，滞回带
  `(0.18, 0.36]` 内保持静止；流场不可达则走 `stopUnit`（释放目标、`active = 0`）。
- 阻尼非对称分离（ADR 0053）：缓冲间隙 `SEPARATION_GAP = 0.08`，采用双斜率
  过阻尼推力（缓冲带刚度 `0.25`、穿透核心刚度 `0.65`）；2 格均匀桶、
  升序 id、固定邻桶序，重合时按 id 奇偶选轴；同阵营按 `r² × stateWeight`
  （moving `2.5`、stopped `1.8`、holding `0.6`）反比让路，敌对阵营按 `r²`；
  对向相遇与同向超车叠加 `WRAP_FACTOR = 0.60` 切向绕行分量；单 tick 累加
  推力按 `max(0.06, speed * 1.15)` 限幅。
- 积分与墙体边距（ADR 0053）：速度为零走快速跳过；非零步按 `(cls, tier)`
  执行 `canStep`（整步失败先尝试仅 x、再仅 y），随后经 `clampFootprintMargin`
  （标准 `min(r * 0.75, 0.30)`、重型 `min(r * 0.85, 0.75)`）夹紧封闭正交
  墙面与凸角圆弧，再夹在地图边界内；`movement/sim/` 全路径严格遵守纯数学与
  热路径零堆分配约束。
- 只有 `active=1` 的单位持有共享目标引用，到达驻留时已释放；所有
  释放点统一走 `releaseHeldGoal`，不自行判断 `active≠0`（ADR 0045）。

## 对应设计
- [architecture.md §6.8](../../../../docs/design/architecture.md)
  （流场与移动结算）。
- [ADR 0010](../../../../docs/adr/0010-terrain-model-sector-flowfields.md)
  （扇区流场模型）、[ADR 0013](../../../../docs/adr/0013-modifier-pipeline.md)
  （MoveSpeed 修正值）、[ADR 0020](../../../../docs/adr/0020-numeric-time-capacity-conventions.md)
  （整数约定）、[ADR 0027](../../../../docs/adr/0027-map-terrain-flowfield-movement.md)
  （先校验后改动）、[ADR 0034](../../../../docs/adr/0034-squads.md)
  （移动意图驱动）、[ADR 0052](../../../../docs/adr/0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)
  （地形净空分档与连续流向梯度）、[ADR 0053](../../../../docs/adr/0053-damped-asymmetric-avoidance-arrival-hysteresis-and-wall-margins.md)
  （阻尼非对称避让、到达迟滞与墙体边距）、[ADR 0054](../../../../docs/adr/0054-squad-leader-anchor-role-formations-and-cruise-sync.md)
  （小队虚拟领航锚点、混编职能分排与巡航控速）。
