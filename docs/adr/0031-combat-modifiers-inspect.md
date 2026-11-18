# 0031. 战斗、修正值与检视约定

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-17
- 决策者：wislap
- 批次：M3 跨模块参考实现
- 领域：战斗

## 背景

[ADR 0011](0011-projectile-effect-composition.md) 定了组合效果模型
（M3 只有 instant 交付），[ADR 0013](0013-modifier-pipeline.md) 定了
修正值管线，architecture §13 留了"可解释性"一行。M3 落成目标
获取、开火结算、死亡清理与 `Simulation.inspect`，本文档记录实现
约定。

## 决策

### 阶段与查找

- 系统按意图 → 结算 → 清理三个阶段组织：开火系统在意图阶段选
  目标并发出 `DamageIntent` + `ConsumeIntent` + `combat.shot`；
  伤害按（目标实体 id，意图顺序）结算；`combat.died` 的读者
  （movement 释放寻路目标、construction 释放占地与道路项目）
  先于 combat 自己的移除系统运行——combat 模块最后注册，清理
  阶段按注册顺序执行。
- 目标查找用统一的分桶网格（4 格桶），每 tick 重建一次（桶表在
  模块级复用、逐 tick 原地清空）。

### 目标与开火

- 当前目标在仍然合法（有 `Targetable` + `InWorld`）且射程内
  （中心距 − 目标半径 ≤ range）则保留；否则取最近目标，距离
  相同按实体 id——确定性且防抖。无友伤：目标必须
  `ctx.isHostile`。
- 冷却走 `readyAt = tick + cooldown`（ADR 0021 的 readyAtTick
  约定），不自写计时器。
- 弹药/能量成本经物流机制：`Weapon.cost` 是单个货槽的
  `{cargo, amount}`（milli），开火要求某个货槽余额足额，满足后
  向自身发出 `ConsumeIntent`，由物流结算扣账——炮塔弹药和
  raider 激光能量走的是同一条路径。
- 目标半径：单位取单位半径，建筑取 footprint 半宽。
- `CombatDied` 每次死亡只发一次（hp 首次 ≤ 0）。
- `Health`/`Targetable`/`Weapon` 经注入部件工厂装配
  （`unitParts`/`structureParts`/`combatRoadParts`），实体成分由
  内容与 `app/` 决定，combat 不感知"种类"。

### 修正值 = 组件

- `defineModifier(id, stat, op)` 注册一个 `{value: i32}` 的
  `ComponentRef`：修正值就是挂在实体上的组件，所属模块
  `claimWriter` 后用常规组件操作增删写，序列化与销毁清理由
  组件机制保证，不需要第二套生命周期。
- `ctx.stat(stat, id, base)` 读有效值：加值项求和、基点乘项合成
  一个乘数，**钳制 ≥ 0**；数量类走 `floorDiv` 整数运算，几何类
  保留浮点。`ctx.modifiersOf(id)` 按（属性 id，来源 id）排序
  返回生效来源——排序固定保证确定性，也方便 UI 展示。
- 例：`EnergyLow`/`EnergyEmpty` 由物流按能量档位增删，移动与
  战斗经 `ctx.stat` 读到修正后的值。

### 检视（可解释性）

- `Simulation.inspect(observer, handle)`：各模块用
  `builder.inspector` 注册只读分节（回调内禁用会改状态的 ctx
  操作），内核汇总修正来源（`modifiersOf`）与各分节返回；UI 的
  实体详情面板直接渲染分节。inspect 不改变模拟状态——这回答了
  §13「可解释性」：修正来源、缺货原因、生产等待原因都能被玩家
  看到。

## 否决的方案

- 修正值存独立表/第二存储：多一套序列化与销毁同步代码，收益
  为零——组件机制已经全包。
- 开火即扣弹药（绕过物流结算）：破坏"消耗统一走意图 →
  结算"的口径，也让退款/优先级规则多一个例外。
- 视线与高度加成：M3 不做，ADR 0011 的组合模型留了扩展位置。

## 后果

- §13「可解释性」一行关闭。
- 目标保留 + 最近重选 + id 平局使群体目标分配稳定可复现。
- 遗留：非 instant 弹道、护甲/护盾插入 `applyDamage`、感染/控制
  类战斗效果。
