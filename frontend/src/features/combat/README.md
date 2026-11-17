# combat

## 职责
负责生命、命中与武器：目标获取与开火、伤害结算、死亡事件与实体
清理。M3 只有 instant 交付方式（ADR 0011），不建视线与高度加成。

## 公开接口
- `sim/index.ts`：`createCombatModule()`、`healthFraction(ctx, id)`
  （bp，供物流运力档位与快照通道）、`unitParts`/`structureParts`
  （Health 满血、Targetable、Weapon）、`Health`/`Targetable`/`Weapon`
  组件。
- `protocol.ts`：`DamageIntent`（`frontline_td:combat.damage`，
  `{target: handle, amount: milli}`，由本模块回读）、`CombatShot`
  /`CombatDied` 事件（均 `all` 可见）。
- `content.ts`：`weaponSchema`（range 格、damage 单位、cooldown 秒、
  `cost?: {cargo, amount}`，loader 换成索引与 milli/tick）。

## 拥有的组件
- `Health { hp, max }`（milli）、`Targetable { radius }`、
  `Weapon { range, damage, cooldown, readyAt, costCargo, costAmount,
  target }`；`target` 存实体句柄（0 = 无），`costCargo` 用 0xFFFF
  表示免费。

## 不变量
- 开火系统每 tick 重建统一分桶网格（4 格桶）；当前目标在合法且
  射程内（中心距 − 目标半径 ≤ range）则保留，否则取最近目标，
  距离相同按实体 id。
- 射击需单个货槽余额 ≥ 弹药成本；开火发出 `DamageIntent`、
  `ConsumeIntent` 与 `combat.shot`，`readyAt = tick + cooldown`。
- 伤害按（目标实体 id，意图顺序）结算；流水线为单一函数
  `applyDamage`（base → hp，后续修正/护甲/护盾在此插入）；hp 首次
  ≤0 时发一次 `combat.died`。
- `combat.died` 在 cleanup 阶段先被 movement（释放寻路目标）与
  construction（释放占地）读取，combat 的 despawn 系统随模块最后
  注册因此最后运行。
- 无友伤：目标必须 `ctx.isHostile`。

## 对应设计章节
- `.plans/m3.md` 的 M3-C；docs/adr/0011（交付方式）、0008（伤害管线）。
