# movement

## 职责
单位移动结算：按净空分档（1×1 / 2×2）沿寻路方向与走廊链转向、
均匀网格分离推挤、带通行校验的积分。小队巡航限速与方向惯性在
这里结算。移动命令 `frontline_td:movement.move` 在此登记。

## 公开接口
- `sim/index.ts`：`createMovementModule(terrain, pathing)`；
  `MoveCommand`；`moverComponents`（部件工厂，经 `app/` 注入）、
  `MoveSpeed`（目前唯一的修正值统计量，ADR 0013）；组件
  `Position` / `Mover` / `MoveTarget`。
- `protocol.ts`：`MoveIntent`（可带显式 `slots`）/`StopIntent`/
  `FormationGuideIntent`（小队标量速度上限）/`MoveOrdered` 事件。
  AI 与小队只能经这些意图驱动单位，意图与 `MoveCommand` 共用同一
  结算函数；`MoveIntent` 对不可通行目标做面向来向的可达格吸附，
  `MoveCommand` 对深处不可达目标拒绝 `invalid_target`。
- 导出全表见 [exports.md](../../../../docs/generated/exports.md)
  与 [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Position` / `MoveTarget` / `Velocity` / `FormationGuide` /
  `RouteFollow`：仅本模块写；后三个为内部组件。
- `Mover`：spawn 烘入，`ownComponent` 声明归属、无字段写者
  （ADR 0047）。
- 状态键 `frontline_td:movement.routes`（走廊链与阻挡持有集合）。

## 不变量
- movement 相位固定顺序：intents → steer → separate → integrate；
  cleanup 的 release_dead 须先于 combat.despawn。
- 命令与意图先完整校验再改状态；非法句柄不影响其余单位。
- 只有 `active=1` 的单位持有共享目标引用；所有释放点统一走
  `releaseHeldGoal`；hold/stop/release_dead 同时清 `FormationGuide`、
  `RouteFollow` 与 `stall`。
- 流场不可达走 `stopUnit`（释放目标、`active=0`）；到达释放目标并
  `active=2` 守位，被推离死区外才回拉。
- 重型（2×2）与标准单位分档结算；混编 `MoveIntent` 优先共用重型档
  目标防分道，标准成员在重型流场到不了的位置回落到标准档流场。
- `FormationGuide` 的限速只做标量上限，不走 `MoveSpeed` 修正值通道。
- 热路径零堆分配；遵守纯度区规则（无随机、时间与超越函数）。

## 对应设计
- [architecture.md §6.8](../../../../docs/design/architecture.md#68-地形模型)
  （流场与移动结算）。
- [ADR 0010](../../../../docs/adr/0010-terrain-model-sector-flowfields.md)、
  [ADR 0013](../../../../docs/adr/0013-modifier-pipeline.md)、
  [ADR 0047](../../../../docs/adr/0047-component-ownership-manifest.md)、
  [ADR 0052](../../../../docs/adr/0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)、
  [ADR 0053](../../../../docs/adr/0053-damped-asymmetric-avoidance-arrival-hysteresis-and-wall-margins.md)、
  [ADR 0056](../../../../docs/adr/0056-watershed-proof-corridor-chains-command-snap-and-rear-yielding.md)、
  [ADR 0059](../../../../docs/adr/0059-damped-aperture-locomotion-mixed-cohesion-and-surround-arcs.md)。
