# movement

## 职责
单位移动结算（ADR 0010）：沿寻路流场转向、均匀网格分离推挤、
可通行性积分。移动命令 `frontline_td:movement.move` 在此登记。

## 公开接口
- `sim/index.ts`: `createMovementModule(terrain, pathing) → SimModule`；
  `MoveCommand`（payload `{ units: handle[], x, y }`）；
  `moverComponents`（部件工厂，经 `app/` 注入 unit/结构部件）、
  `MoveSpeed`（目前唯一的修正值统计量，ADR 0013）；
  组件 `Position` / `Mover` / `MoveTarget`。
- `protocol.ts`：`MoveIntent` / `StopIntent`（AI 与小队驱动单位的
  正式路径，与 `MoveCommand` 共用同一结算函数）、
  `MoveOrdered` 事件。意图在 movement 相位开头按发出顺序结算，
  校验句柄存活与 `Mover`；目标格对该移动类不可通行时吸附到
  最近的可通行且可达格（出发生成螺旋，环 32），`MoveCommand`
  仍拒绝不可通行目标。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Position {x,y:f64}`、`Mover {speed,radius,cls}`、
  `MoveTarget {goal:u32,x,y,active:u8}` —— 只有本模块可写；
  `Mover` 经 `ownComponent` 声明归属（spawn 烘入，无字段写者，
  ADR 0047）。`Velocity` 为内部组件，不在公共导出。

## 不变量
- movement 相位四个系统固定顺序：intents（移动意图结算）→ steer →
  separate → integrate；cleanup 相位另有 release_dead（须先于
  combat.despawn，见 sim-registry 注释）。
- 移动命令先校验再改状态：按移动类别收集目标周围可通行且与目标
  连通的槽位（方环螺旋、半径 ≤ ⌈√n⌉+8，不足则循环复用），再按
  保形贪心分配（按距编队质心距离降序取最近未占槽位）。
- 槽位 8 格内且格子直线可走（DDA，逐步 stepCost ≥ 0）就直线驶向
  槽位，否则跟流场；到达判定 = 距槽位 ≤ 0.3，到达后 active=2 驻留
  （被分离推开时直线驶回槽位）；流场不可达则走 `stopUnit`：
  释放目标、`active=0` 停止。
- 分离推挤阈值 = rA + rB + 0.2（SEPARATION_GAP），用 2 格均匀桶、
  升序 id、固定邻桶序；重合时按 id 奇偶选轴；2-opt 槽位交换降低
  编队内互相穿插。
- 积分只允许可通行步，整步失败时先尝试仅 x、再仅 y；位置夹在地图内。
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
  （移动意图驱动）。
