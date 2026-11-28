# combat

## 职责
负责生命、命中与武器：目标获取与开火、伤害结算、死亡事件与实体
清理。交付方式只有 instant（ADR 0011），不建视线与高度加成。

## 公开接口
- `sim/index.ts`：`createCombatModule()` 返回 `CombatModule`（附加
  公共查询 `nearestHostile`/`inWeaponReach`/`weaponRange`）；导出
  `Health`、`healthFraction`（bp，供物流档位与快照通道）及部件工厂
  `unitParts`/`structureParts`/`roadSegmentParts`（`Health` 满血、
  `Targetable`、`Weapon`，经 `app/` 注入）。
- `protocol.ts`：`DamageIntent`（本模块回读）、`CombatShot`/
  `CombatDied` 事件（`all` 可见）、检查器契约类型。
- `content.ts`：`weaponSchema`（range/damage/cooldown/可选 `cost`，
  loader 换成索引与 milli/tick）。
- `render/`：`combatSceneLayers`（`BeamsLayer`：弹道瞬时线，
  经事件游标消费 `combat.shot`；ADR 0062 场景层注册）。
- `ui/`：`CombatSection`（ADR 0062：检视器共享战斗小节，
  血量/装填/弹药）。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Health`/`Weapon`（本模块写）；`Targetable { radius }`（spawn
  烘入、归属本模块、无字段写者，ADR 0047）。
- 检查器 `frontline_td:combat`（血量/武器/目标）。

## 不变量
- `combat.fire` 查询带 `OPERATIONAL_EXCLUDE`，且每 tick 在
  `combat_intent` 重建分桶网格；目标保留优先，否则取最近敌对
  （距离相同按 id）。`orders` 阶段调用 `nearestHostile`/
  `inWeaponReach` 时读取的是上一 tick 的分桶，读字段前必须用
  `ctx.has(...)` 校验回收 ID（ADR 0040 / ADR 0045）。
- 无消耗武器无需 `CargoStore` 即可开火；有消耗武器需单格货槽余额
  ≥ 弹药成本；开火发出 `DamageIntent`、可选 `ConsumeIntent` 与
  `CombatShot`。`BeamsLayer` 仅当两端点均在观察者视野外时才隐藏
  弹道（ADR 0039）。
- 伤害按（目标 id，意图顺序）结算，单一 `applyDamage` 管线；
  hp 首次 ≤0 发一次 `CombatDied`。
- `CombatDied` 在 cleanup 阶段先被 `movement.release_dead` 与
  `construction.free_dead` 读取，本模块 despawn 最后运行（顺序
  由模块注册决定）。
- 无友伤：目标必须 `ctx.isHostile`。

## 对应设计
- [ADR 0011](../../../../docs/adr/0011-projectile-effect-composition.md)、
  [ADR 0031](../../../../docs/adr/0031-combat-modifiers-inspect.md)、
  [ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)、
  [ADR 0040](../../../../docs/adr/0040-entity-id-reuse-component-reads.md)、
  [ADR 0045](../../../../docs/adr/0045-second-review-conventions.md)、
  [ADR 0047](../../../../docs/adr/0047-component-ownership-manifest.md)、
  [ADR 0062](../../../../docs/adr/0062-client-contribution-registry.md)。
