# combat

## 职责
负责生命、命中与武器：目标获取与开火、伤害结算、死亡事件与实体
清理。交付方式只有 instant（ADR 0011），不建视线与高度加成。

## 公开接口
- `sim/index.ts`：`createCombatModule()` 返回 `CombatModule`（附加
  公共查询 `nearestHostile`/`inWeaponReach`/`weaponRange`）；
  `healthFraction`（bp，供物流档位与快照通道）。
- `protocol.ts`：`DamageIntent`（本模块回读）、`CombatShot`/
  `CombatDied` 事件（`all` 可见）、检查器契约类型。
- `content.ts`：`weaponSchema`（range/damage/cooldown/`cost`，
  loader 换成索引与 milli/tick）。
- `render/`：`BeamsLayer`（弹道瞬时线，经事件游标消费
  `combat.shot`）。
- 部件工厂 `unitParts`/`structureParts`/`roadSegmentParts`（Health
  满血、Targetable、Weapon）经 `app/` 注入。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Health`/`Weapon`（本模块写）；`Targetable { radius }`（spawn
  烘入、归属本模块、无字段写者，ADR 0047）。
- 检查器 `frontline_td:combat`（血量/武器/目标）。

## 不变量
- 开火系统每 tick 重建分桶网格；目标保留优先，否则取最近敌对
  （距离相同按 id）。桶内候选读字段前先 `ctx.has`（id 会回收，
  ADR 0040）。
- 射击需货槽余额 ≥ 弹药成本；开火发出 `DamageIntent`、
  `ConsumeIntent` 与 `combat.shot`。
- 伤害按（目标 id，意图顺序）结算，单一 `applyDamage` 管线；
  hp 首次 ≤0 发一次 `combat.died`。
- `combat.died` 在 cleanup 阶段先被 `movement.release_dead` 与
  `construction.free_dead` 读取，本模块 despawn 最后运行（顺序
  由模块注册决定）。
- 无友伤：目标必须 `ctx.isHostile`。

## 对应设计
- [ADR 0011](../../../../docs/adr/0011-projectile-effect-composition.md)、
  [ADR 0031](../../../../docs/adr/0031-combat-modifiers-inspect.md)、
  [ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)、
  [ADR 0040](../../../../docs/adr/0040-entity-id-reuse-component-reads.md)。
