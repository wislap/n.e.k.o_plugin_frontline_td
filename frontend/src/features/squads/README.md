# squads

## 职责
编队指挥：把移动单位编成 squad，在 `orders` 阶段错峰运行 AI，
维护持久阵型槽位与巡航控速。成员驱动只通过 movement 的
`MoveIntent`（含显式 `slots`）/`StopIntent`/`FormationGuideIntent`，
从不直写 `MoveTarget` 或 `FormationGuide`。

## 公开接口
- `protocol.ts`：命令 `squads.create / assign / disband /
  set_strength / order(guard|advance) / gather`，事件
  `SquadsLaunched`，快照通道 `SquadsChannel`（己方全量，敌方公开
  视图：集结点、launchTick、目标与存储路径）。
- `sim/index.ts`：`createSquadsModule(deps)`。
- `render/`：`squadsSceneLayers`（ThreatsLayer：敌方小队预警，
  卸载时释放 GPU 资源；ADR 0062 场景层注册）；
  `ui/`：`squadsHudPanels`（ADR 0062 HUD 面板注册：SquadPanel 仅指挥
  模式、ThreatBanner 敌方小队预警横幅）、`squadsMinimapMarks`
  （ADR 0062 小地图标记贡献：敌方小队威胁路径与脉冲菱形）。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `SquadMember { squad }`（内部组件，本模块写）。
- 模块状态 `Map<squadId, Squad>` + 单调计数器，随存档序列化，
  状态键 `frontline_td:squads`。

## 不变量
- `create`/`assign` 只校验句柄存活、同阵营、带 `Mover` 且
  `speed > 0`，不限同类单位；assign 前先退出原小队；玩家直接
  MoveCommand 把成员移出小队（读 `MoveOrdered`）。
- 空小队下次更新删除；集结中小队保留到 launchTick，发射不受
  补给阻塞并发 `SquadsLaunched`。
- guard：锁定半径内敌对目标后追击，超出牵引范围则放弃返回；
  到达 advance 目标点自动转 guard。
- 交战拆分：射程内有敌的成员停火（StopIntent），其余推进；
  目标漂移重取只在 engaging 生效。
- routed advance：gather 时按 pathing 下降沿存预设路线，上限
  `ROUTE_MAX_CELLS` 格；advance 目标不可达时转打最近可达敌对
  建筑（排除废墟），摧毁后重新评估。
- 补给：成员平均能量低于阈值撤向己方覆盖格，回到高位再复原
  命令；全员无电池永不进 resupplying。idle 订单不触发走失召回。
- 增援：新出生单位补进缺编最大的同阵营小队，平局取最小 id。
- 敌方通道视图经 `VisibilityQuery` 过滤：质心可见或为集结/路线
  推进才出现（ADR 0039）。
- 混编小队统一用重型档求目标与控速（防分道），纯标准小队用
  标准档；`SquadsOrder`/`SquadsGather` 置 `immediate` 次拍即动。
- 槽位持久：同目标只对缺失/早停成员增量补发，预留已定槽位
  占地；减员超过阈值或目标变更才整体重建。

## 对应设计
- [ADR 0023](../../../../docs/adr/0023-grid-layers-groups-commands-rng-runtime-limits.md)、
  [ADR 0034](../../../../docs/adr/0034-squads.md)、
  [ADR 0054](../../../../docs/adr/0054-squad-leader-anchor-role-formations-and-cruise-sync.md)、
  [ADR 0057](../../../../docs/adr/0057-geodesic-distance-cruise-pacing-and-immediate-squad-orders.md)、
  [ADR 0059](../../../../docs/adr/0059-damped-aperture-locomotion-mixed-cohesion-and-surround-arcs.md)、
  [ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)、
  [ADR 0040](../../../../docs/adr/0040-entity-id-reuse-component-reads.md)。
- [game_design.md §4.7](../../../../docs/design/game_design.md)
  （小队玩法）。
