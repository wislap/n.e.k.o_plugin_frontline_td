<!-- 自动生成，勿手改：npm run gen:index -->

# 模拟契约清单

阶段顺序：command → director → orders → movement → combat_intent → resolve → cleanup → logistics → construction → capture_fog

## 模块

### `frontline_td:terrain`

| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |
|---|---|---|---|---|---|
| `frontline_td:terrain.mirror_blocked` | capture_fog | 1 | 0 | — | — |

- 模块状态：`frontline_td:terrain.blocked_overlay`

### `frontline_td:pathing`

无系统。

- 模块状态：`frontline_td:pathing.goals`

### `frontline_td:movement`

| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |
|---|---|---|---|---|---|
| `frontline_td:movement.intents` | movement | 1 | 0 | `frontline_td:movement.formation_guide`、`frontline_td:movement.move`、`frontline_td:movement.stop` | — |
| `frontline_td:movement.steer` | movement | 1 | 0 | — | — |
| `frontline_td:movement.separate` | movement | 1 | 0 | — | — |
| `frontline_td:movement.integrate` | movement | 1 | 0 | — | — |
| `frontline_td:movement.release_dead` | cleanup | 1 | 0 | `frontline_td:combat.died` | — |

- 命令：`frontline_td:movement.move`（发出：`frontline_td:movement.ordered`）

### `frontline_td:logistics`

| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |
|---|---|---|---|---|---|
| `frontline_td:logistics.resolve` | logistics | 1 | 0 | `frontline_td:logistics.consume`、`frontline_td:logistics.deposit` | — |
| `frontline_td:logistics.allocate` | logistics | 20 | 0 | — | — |
| `frontline_td:logistics.mirror_roads` | capture_fog | 1 | 0 | — | — |

- 命令：`frontline_td:logistics.set_priorities`

- 快照通道：`frontline_td:logistics.network`

- 模块状态：`frontline_td:logistics.roads`、`frontline_td:logistics.state`

- 检查器：`frontline_td:logistics`

### `frontline_td:construction`

| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |
|---|---|---|---|---|---|
| `frontline_td:construction.tick_state` | command | 1 | 0 | — | — |
| `frontline_td:construction.free_dead` | cleanup | 1 | 0 | `frontline_td:combat.died` | — |
| `frontline_td:construction.progress` | construction | 1 | 0 | — | `frontline_td:construction.completed` |
| `frontline_td:construction.activate` | construction | 20 | 0 | — | — |
| `frontline_td:construction.salvage_gc` | construction | 20 | 0 | — | — |
| `frontline_td:construction.capture_rebuild` | construction | 1 | 0 | `frontline_td:capture.completed` | — |
| `frontline_td:construction.road_progress` | construction | 1 | 0 | — | — |

- 命令：`frontline_td:construction.activate`、`frontline_td:construction.cancel`、`frontline_td:construction.place`、`frontline_td:construction.upgrade_links`

- 快照通道：`frontline_td:construction.roadworks`、`frontline_td:construction.salvage`、`frontline_td:construction.structures`

- 模块状态：`frontline_td:construction.reservations`、`frontline_td:construction.road_projects`

- 检查器：`frontline_td:construction`

### `frontline_td:units`

| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |
|---|---|---|---|---|---|
| `frontline_td:units.spawn` | capture_fog | 1 | 0 | `frontline_td:units.spawn` | `frontline_td:units.spawned` |

- 快照通道：`frontline_td:units.dense`

### `frontline_td:production`

| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |
|---|---|---|---|---|---|
| `frontline_td:production.craft` | construction | 1 | 0 | — | `frontline_td:logistics.consume`、`frontline_td:logistics.deposit`、`frontline_td:units.spawn` |

- 检查器：`frontline_td:production`

### `frontline_td:combat`

| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |
|---|---|---|---|---|---|
| `frontline_td:combat.fire` | combat_intent | 1 | 0 | — | `frontline_td:combat.damage`、`frontline_td:combat.shot`、`frontline_td:logistics.consume` |
| `frontline_td:combat.resolve` | resolve | 1 | 0 | `frontline_td:combat.damage` | `frontline_td:combat.died` |
| `frontline_td:combat.despawn` | cleanup | 1 | 0 | `frontline_td:combat.died` | — |

- 检查器：`frontline_td:combat`

### `frontline_td:squads`

| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |
|---|---|---|---|---|---|
| `frontline_td:squads.update` | orders | 1 | 0 | `frontline_td:movement.ordered`、`frontline_td:units.spawned` | `frontline_td:movement.formation_guide`、`frontline_td:movement.move`、`frontline_td:movement.stop`、`frontline_td:squads.launched` |

- 命令：`frontline_td:squads.assign`、`frontline_td:squads.create`、`frontline_td:squads.disband`、`frontline_td:squads.gather`、`frontline_td:squads.order`、`frontline_td:squads.set_strength`

- 快照通道：`frontline_td:squads.squads`

- 模块状态：`frontline_td:squads`

### `frontline_td:capture`

| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |
|---|---|---|---|---|---|
| `frontline_td:capture.progress` | capture_fog | 1 | 0 | — | `frontline_td:capture.completed` |

- 快照通道：`frontline_td:capture.points`

### `frontline_td:vision`

| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |
|---|---|---|---|---|---|
| `frontline_td:vision.recompute` | capture_fog | 5 | 0 | — | — |

- 快照通道：`frontline_td:vision.memory`

- 模块状态：`frontline_td:vision`

### `frontline_td:assault.victory`

| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |
|---|---|---|---|---|---|
| `frontline_td:assault.victory.check` | capture_fog | 20 | 0 | — | `frontline_td:assault.eliminated`、`frontline_td:assault.ended` |

- 快照通道：`frontline_td:assault.state`

- 模块状态：`frontline_td:assault.victory`

### `frontline_td:assault.probes`

| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |
|---|---|---|---|---|---|
| `frontline_td:assault.probes.waves` | cleanup | 1 | 0 | `frontline_td:squads.launched` | — |

- 模块状态：`frontline_td:assault.probes`

- 探针：`frontline_td:assault.hivehp.f1`、`frontline_td:assault.hivehp.f2`、`frontline_td:assault.stock.f1.ammo`、`frontline_td:assault.stock.f1.energy`、`frontline_td:assault.stock.f1.material`、`frontline_td:assault.stock.f1.ore`、`frontline_td:assault.stock.f2.ammo`、`frontline_td:assault.stock.f2.energy`、`frontline_td:assault.stock.f2.material`、`frontline_td:assault.stock.f2.ore`、`frontline_td:assault.structures.f1`、`frontline_td:assault.structures.f2`、`frontline_td:assault.units.f1`、`frontline_td:assault.units.f2`、`frontline_td:assault.waves.f1`、`frontline_td:assault.waves.f2`

### `kernel`

无系统。

- 探针：`frontline_td:kernel.entities`、`frontline_td:kernel.tick`

## 组件

| 组件 | 字段 | 所属 | 写者 |
|---|---|---|---|
| `frontline_td:blueprint` | kind: u16、x: u16、y: u16、activated: u8、orderTick: u32 | frontline_td:construction | frontline_td:construction |
| `frontline_td:capture` | owner: u16、progress: u32、done: u8、kind: u16、x: u16、y: u16、leader: u16、contested: u8 | frontline_td:capture | frontline_td:capture |
| `frontline_td:combat.health` | hp: i32、max: i32 | frontline_td:combat | frontline_td:combat |
| `frontline_td:combat.targetable` | radius: f64 | frontline_td:combat | — |
| `frontline_td:combat.weapon` | range: f64、damage: i32、cooldown: u32、readyAt: u32、costCargo: u16、costAmount: i32、target: f64 | frontline_td:combat | frontline_td:combat |
| `frontline_td:construction_progress` | progress: u32、total: u32、mode: u8 | frontline_td:construction | frontline_td:construction |
| `frontline_td:core` | — | frontline_td:construction | frontline_td:construction |
| `frontline_td:faction` | id: u16 | kernel | kernel |
| `frontline_td:in_world` | — | kernel | kernel |
| `frontline_td:logistics.cargo_store` | cargo0: u16、cap0: i32、amt0: i32、cls0: u8、flags0: u8、since0: u32、rate0: i32、unmet0: u8、cargo1: u16、cap1: i32、amt1: i32、cls1: u8、flags1: u8、since1: u32、rate1: i32、unmet1: u8、cargo2: u16、cap2: i32、amt2: i32、cls2: u8、flags2: u8、since2: u32、rate2: i32、unmet2: u8、cargo3: u16、cap3: i32、amt3: i32、cls3: u8、flags3: u8、since3: u32、rate3: i32、unmet3: u8、bottleneck: f64 | frontline_td:logistics | frontline_td:logistics |
| `frontline_td:logistics.energy_empty` | value: i32 | frontline_td:logistics | frontline_td:logistics |
| `frontline_td:logistics.energy_low` | value: i32 | frontline_td:logistics | frontline_td:logistics |
| `frontline_td:logistics.fixed_attach` | node: u32、gen: u32、lastMile: i32 | frontline_td:logistics | — |
| `frontline_td:logistics.interceptor` | strengthBp: i32 | frontline_td:logistics | — |
| `frontline_td:logistics.node` | connect: i32、service: f64、vehicles: u16、warehouse: u8、w: u8、h: u8 | frontline_td:logistics | — |
| `frontline_td:logistics.site` | kind: u16 | frontline_td:logistics | frontline_td:logistics |
| `frontline_td:movement.formation_guide` | x: f64、y: f64、maxSpeed: f64、active: u8 | frontline_td:movement | frontline_td:movement |
| `frontline_td:movement.move_target` | goal: u32、x: f64、y: f64、active: u8 | frontline_td:movement | frontline_td:movement |
| `frontline_td:movement.mover` | speed: f64、radius: f64、cls: u8 | frontline_td:movement | — |
| `frontline_td:movement.position` | x: f64、y: f64 | frontline_td:movement | frontline_td:movement |
| `frontline_td:movement.velocity` | x: f64、y: f64 | frontline_td:movement | frontline_td:movement |
| `frontline_td:production.producer` | kind: u16、progress: u32、cycle: u8 | frontline_td:production | frontline_td:production |
| `frontline_td:road_segment` | project: u32 | frontline_td:construction | — |
| `frontline_td:ruin` | — | frontline_td:construction | — |
| `frontline_td:salvage` | — | frontline_td:construction | — |
| `frontline_td:squads.member` | squad: u16 | frontline_td:squads | frontline_td:squads |
| `frontline_td:structure` | kind: u16、x: u16、y: u16 | frontline_td:construction | frontline_td:construction |
| `frontline_td:under_construction` | — | kernel | frontline_td:construction |
| `frontline_td:units.kind` | kind: u16 | frontline_td:units | — |
| `frontline_td:vision` | radius: u16、x: f64、y: f64 | frontline_td:vision | — |

## 网格层

| 层 | 类型 | 按阵营 | 写者 |
|---|---|---|---|
| `frontline_td:logistics.road` | u8 | 否 | frontline_td:logistics |
| `frontline_td:logistics.service` | u8 | 是 | frontline_td:logistics |
| `frontline_td:terrain.blocked` | u8 | 否 | frontline_td:terrain |
| `frontline_td:terrain.height` | u8 | 否 | frontline_td:terrain |
| `frontline_td:terrain.surface` | u16 | 否 | frontline_td:terrain |
| `frontline_td:vision.state` | u8 | 是 | frontline_td:vision |

## 消息

| 类型 | 种类 | 可见性 |
|---|---|---|
| `frontline_td:assault.eliminated` | event | all |
| `frontline_td:assault.ended` | event | all |
| `frontline_td:capture.completed` | event | all |
| `frontline_td:combat.damage` | intent | — |
| `frontline_td:combat.died` | event | all |
| `frontline_td:combat.shot` | event | all |
| `frontline_td:construction.activate` | command | — |
| `frontline_td:construction.cancel` | command | — |
| `frontline_td:construction.completed` | event | issuer |
| `frontline_td:construction.place` | command | — |
| `frontline_td:construction.upgrade_links` | command | — |
| `frontline_td:kernel.command_rejected` | event | issuer |
| `frontline_td:logistics.consume` | intent | — |
| `frontline_td:logistics.deposit` | intent | — |
| `frontline_td:logistics.set_priorities` | command | — |
| `frontline_td:movement.formation_guide` | intent | — |
| `frontline_td:movement.move` | command | — |
| `frontline_td:movement.move` | intent | — |
| `frontline_td:movement.ordered` | event | all |
| `frontline_td:movement.stop` | intent | — |
| `frontline_td:squads.assign` | command | — |
| `frontline_td:squads.create` | command | — |
| `frontline_td:squads.disband` | command | — |
| `frontline_td:squads.gather` | command | — |
| `frontline_td:squads.launched` | event | all |
| `frontline_td:squads.order` | command | — |
| `frontline_td:squads.set_strength` | command | — |
| `frontline_td:units.spawn` | intent | — |
| `frontline_td:units.spawned` | event | all |
