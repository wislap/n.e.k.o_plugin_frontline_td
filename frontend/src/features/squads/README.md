# squads

## 职责
编队指挥：把移动单位编成 squad，在 `orders` 阶段按
`(tick + id) % 10 === 0` 错峰运行 AI，只通过 movement 的
Move/StopIntent 驱动成员，从不直写 `MoveTarget`。

## 公开接口
- `protocol.ts`：命令 `squads.create / assign / disband /
  set_strength / order(guard|advance) / gather`，事件
  `SquadsLaunched`，以及快照通道 `SquadsChannel`（己方全量，
  敌方公开视图：集结点、launchTick、目标与存储路径）。
- `sim/index.ts`：`createSquadsModule(deps)`。
- `render/`：`ThreatsLayer`/`bannerThreat`（敌方小队预警横幅）；
  `ui/`：`SquadPanel`。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `SquadMember { squad }`（内部组件，本模块写）。
- 模块状态 `Map<squadId, Squad>` + 单调计数器，随存档序列化，
  状态键 `frontline_td:squads`。
- Squad 字段：id、tag、faction、有序成员句柄、strength、order、
  phase、engage 目标、retarget、lastGoal（≥2 格漂移才换目标）、
  可选 route。

## 不变量
- `create`/`assign` 只校验句柄存活、同阵营、带 `Mover` 且
  `speed > 0`，不限"同类单位"；单位被 assign 前先退出原小队；
  玩家直接下达的 MoveCommand 会把该成员移出小队（读
  `MoveOrdered`）。
- 空小队在下一次更新时删除；集结中小队保留到 launchTick。
- 警戒（guard）：半径内锁定敌对目标后追击，目标跑出
  radius + 4（leash）则放弃并返回；到达 advance 目标点自动转
  guard（半径 6）。
- 交战拆分：武器射程内有敌的成员停火站桩（StopIntent），其余
  继续推进；`REGOAL_DRIFT` 仅在 engaging 状态生效（≥2 格目标
  漂移才换目标）。
- 带预设路线的推进（routed advance：`order = advance` 且存在
  `route`）：集结（gather）命令下达时用 pathing 下降沿存储路线，
  上限 `ROUTE_MAX_CELLS = 512` 格（route 存 (x, y) 扁平坐标对，
  长度上限 1024）。
- 补给：`sim/energy.ts` 的 `meanEnergyBp`（跳过无 `CargoStore`
  的成员——id 会被回收，ADR 0040）算出平均能量 < 3000 bp 时
  撤向最近的己方覆盖格（物流 `covered`），≥ 8000 bp 后返回原
  命令；全员无电池返回 null，永不进 resupplying。
- 集结发射不可被补给阻塞：到 `launchTick` 先转 advance 并发
  `SquadsLaunched`。
- 敌方小队通道视图接受注入的 `VisibilityQuery`：质心格可见、
  或指令为集结/带路线推进时才出现（威胁情报保留，ADR 0039）。
- 增援：`units.spawned` 的新单位补进缺口最大
  （strength − 成员数）的小队，平局取最小 id。
- advance 目标不可达时改打最近的可达敌对建筑（查询排除废墟，
  ADR 0038/0040），摧毁后重新评估。
- idle 订单的小队不触发走失成员召回（尚无目标可回）。

## 对应设计
- [ADR 0023](../../../../docs/adr/0023-grid-layers-groups-commands-rng-runtime-limits.md)
  （编组约定；嵌套编组不做）、
  [ADR 0034](../../../../docs/adr/0034-squads.md)（移动意图驱动）、
  [ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)（敌方
  视图过滤）、[ADR 0040](../../../../docs/adr/0040-entity-id-reuse-component-reads.md)
  （句柄校验）。
- [game_design.md §4.7](../../../../docs/design/game_design.md)
  （小队玩法）。
