# combat

## 职责
负责生命、命中与武器：目标获取与开火、伤害结算、死亡事件与实体
清理。交付方式只有 instant（ADR 0011），不建视线与高度加成。

## 公开接口
- `sim/index.ts`：`createCombatModule()` 返回 `CombatModule`（在
  `SimModule` 上附加公共查询）：
  `nearestHostile(ctx, faction, x, y, radius, filter?)`、
  `inWeaponReach(ctx, id)`（与开火判定同一公式 = 射程 + 目标半径，
  小队交战拆分用）、`weaponRange(ctx, id)`；
  `healthFraction(ctx, id)`（bp，供物流运力档位与快照通道）。
- `protocol.ts`：`DamageIntent`（`frontline_td:combat.damage`，
  `{target: handle, amount: milli}`，由本模块回读）、`CombatShot`
  /`CombatDied` 事件（均 `all` 可见）、`COMBAT_INSPECTOR_ID`
  （`frontline_td:combat`）与 `CombatInspection` 检查器契约类型。
- `content.ts`：`weaponSchema`（range 格、damage 单位、cooldown 秒、
  `cost?: {cargo, amount}`，loader 换成索引与 milli/tick）。
- `render/`：`BeamsLayer`（弹道瞬时线，经客户端事件游标消费
  `combat.shot`）。
- 部件工厂 `unitParts`/`structureParts`/`roadSegmentParts`（Health
  满血、Targetable、Weapon）经 `app/` 注入。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Health { hp, max }`（milli，本模块写）、`Weapon { range, damage,
  cooldown, readyAt, costCargo, costAmount, target }`（本模块写）；
  `target` 存实体句柄（0 = 无），`costCargo` 用 0xFFFF 表示免费。
- `Targetable { radius }`（spawn 时随部件烘入，归属本模块、
  无字段写者，ADR 0047）。
- 检查器 `frontline_td:combat`（血量/武器/目标）。

## 不变量
- 开火系统每 tick 重建统一分桶网格（4 格桶）；当前目标在合法且
  射程内（中心距 − 目标半径 ≤ range）则保留，否则取最近目标，
  距离相同按实体 id。桶内候选在读字段前先 `ctx.has` 校验——id
  会被回收。
- 射击需单个货槽余额 ≥ 弹药成本；开火发出 `DamageIntent`、
  `ConsumeIntent` 与 `combat.shot`，`readyAt = tick + cooldown`。
- 伤害按（目标实体 id，意图顺序）结算；流水线为单一函数
  `applyDamage`（base → hp，后续修正/护甲/护盾在此插入）；hp 首次
  ≤0 时发一次 `combat.died`。
- `combat.died` 在 cleanup 阶段先被 `movement.release_dead`（释放
  寻路目标）与 `construction.free_dead`（释放占地）读取，本模块的
  despawn 最后运行——结构操作队列保序，释放先于消失，实体 id
  复用顺序因此确定。
- 无友伤：目标必须 `ctx.isHostile`。

## 对应设计
- [ADR 0011](../../../../docs/adr/0011-projectile-effect-composition.md)
  （交付方式组合模型）。
- [ADR 0031](../../../../docs/adr/0031-combat-modifiers-inspect.md)
  （战斗、修正值与检视约定；修正值读取尚未接入）。
- [ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)（事件
  可见性限制）。
- [ADR 0040](../../../../docs/adr/0040-entity-id-reuse-component-reads.md)
  （id 回收下的 `ctx.has` 校验）。
