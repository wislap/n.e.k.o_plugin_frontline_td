# 0054. 小队虚拟领航锚点、混编职能分排与巡航控速

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-21
- 决策者：wislap
- 批次：S3 小队编队领航与混编协同
- 领域：模拟
- 部分取代：0034（小队升级为持久职能分排阵型槽位、虚拟领航锚点、隘口柔缩/展开与行军巡航同步，经 MoveIntent.slots 与 FormationGuideIntent 驱动，仍不直写移动组件）

## 背景

在 [ADR 0034](0034-squads.md) 与 [ADR 0053](0053-damped-asymmetric-avoidance-arrival-hysteresis-and-wall-margins.md) 落地后，单单位局部避让与净空分档已收敛，但小队级别的行军协同与混编战斗仍存在五类结构性缺口：

1. **落队/交战子集重发 `MoveIntent` 覆盖 0 号中心槽**：原 `MoveIntent` 仅携带单一目标格 `(x, y)`，`movement` 每次对传入单位子集重新执行 `collectSlots` + `assignSlots`。当小队仅对落队或未入射程的成员下发 `MoveIntent` 时，单个成员会被分配到螺旋 0 号中心格，与已驻留或正在开火的成员争抢同一坐标。
2. **远程与近战/重型混编无职能分排**：同一小队内的坦克/近战、步兵与远程/支援单位若共享无序螺旋槽位，经常出现脆皮远程顶在最前排、高半径重型单位挤占窄口中心、开火前排被后排推进撞偏等问题。
3. **直行流场缺少小队领航锚点与隘口伸缩**：纯按质心推进的小队在宽阔地带容易散成一团，而在穿过窄口或绕行障碍时又因固定队形宽幅卡死在门框两侧，缺少沿流场前瞻探测通道宽度并平滑压缩、出隘口后再展开的领航机制。
4. **行军速度不同步导致队形拉断**：快速轻型单位总是大幅领先慢速重型单位独自接敌，使混编小队无法以完整阵型同步进入交战。
5. **用修正值管线限速会与低电量减益错误叠加**：在 [ADR 0013](0013-modifier-pipeline.md) 与 [ADR 0025](0025-logistics-model.md) 中，修正值管线的 `mul_bp` 为同通道万分比叠加（如低电量 `EnergyLowModifier = -5000`）。若通过 `defineModifier(..., MoveSpeed, 'mul_bp')` 施加巡航降速，会在低电量时与 `-5000` 相加触发极端减速甚至锁死（且额外产生每单位动态 modifier 分配/清理开销）。

## 决策

### 1. `MoveIntent.slots` 显式槽位通道

- 扩展 `MoveIntent` 载荷为 `{ units: number[]; x: number; y: number; slots?: { x: number; y: number }[] }`。
- 当 `slots` 存在且与 `(cls, tier)` 子组内的每个成员形成 1:1 映射时，`movement` 的 `applyMoveGroup` 跳过 `collectSlots` 与 `assignSlots`，直接校验各显式槽位是否满足 `terrain.inBounds(Math.floor(s.x), Math.floor(s.y)) && terrain.passable(clearanceAnchorCell(s.x, tier), clearanceAnchorCell(s.y, tier), cls, tier)`；合法则直写 `(s.x, s.y)`，越界或不可通行则回退至组目标格中心 `clearanceAnchorCenter(x, tier)`。
- 省略 `slots` 时（包括所有玩家 `MoveCommand` 与传统意图调用），保持既有 `collectSlots` + `assignSlots` 行为 100% 不变。

### 2. 持久内部组件 `FormationGuide` 与 `FormationGuideIntent`

- 在 `movement/sim/components.ts` 新增永久内部组件 `FormationGuide { x: 'f64', y: 'f64', maxSpeed: 'f64', active: 'u8' }`（不从 `movement/sim/index.ts` 对外导出），随 `moverComponents` 一同写入每个可移动实体。
- 严格遵守单一写者原则（[ADR 0026](0026-kernel-implementation-conventions.md)）：只有 `movement` 模块持有 `FormationGuide` 写权限，小队模块通过新增意图 `FormationGuideIntent<{ units: number[]; waypoints?: { x: number; y: number; maxSpeed?: number }[]; active: boolean }>` 驱动，从不直写移动组件。
- 明确拒绝使用 `defineModifier(..., MoveSpeed, 'mul_bp')` 来实现巡航控速：巡航同步上限以标量 `FormationGuide.maxSpeed` 形式在 `steer` 中于 `ctx.stat(MoveSpeed, ...)` 与地形 `speedBpAt` 计算完毕后做独立上界夹紧 `maxSpeed = gCap > 0 && gCap < statSpeed ? gCap : statSpeed`，与 `EnergyLowModifier = -5000` 等修正值完全正交，且无堆分配。
- `frontline_td:movement.intents` 在同一 tick 内先结算 `MoveIntent` 与 `StopIntent`，最后结算 `FormationGuideIntent`，使小队同 tick 同时下发目标槽位与领航路径点时能够干净落盘。
- 热路径零分配优化：`steer` 在循环外提升 `guide.active`、`guide.x`、`guide.y`、`guide.maxSpeed` 视图引用；未受领航单位（`guideActive[id] === 0`）仅支付一次类型化数组读取，不触发额外计算。`steer` 在 `active === 1` 下优先判断距最终槽位 `<= DIRECT_DIST` 且 `lineWalkable` 的直达分支；否则若 `gActive` 且当前到领航点 `(gx, gy)` 距离平方落在 `(0.0625, DIRECT_DIST²]` 且 `lineWalkable`，则转向该瞬态领航点；其余情况无缝回退至 `pathing.smoothDirectionAt`。

### 3. 持久职能分排混编阵型

- 小队按稳定职责排序键 `range asc, radius desc, handle asc` 对成员进行持久排位：近射程大体积单位（坦克/前排）居前，中远射程与小体积输出/支援居后，并以稳定实体句柄兜底破平，消除每次刷新导致的排位抖动。
- 相邻槽位间距按成员碰撞半径动态计算为 `rA + rB + 0.35`，保证不同体积单位混编时既不相互推挤也不过度稀疏。
- 交战期间，已停下开火的前排成员所占槽位保持占用/预留状态，后续增援或调整站位的成员绕开这些已占格，避免索引-0 覆盖与前排被挤出射程。

### 4. 虚拟领航锚点与隘口柔缩/展开

- 沿流场连续方向 `smoothDirectionAt` 前瞻投射虚拟领航锚点（最大前瞻距离 `LEADER_MAX_LEAD = 4.0` 格），由锚点携带小队推进朝向构建瞬态编队参考系。
- 通过 `probeCorridorWidth` 探测前方通道有效可通行净宽，将编队横向缩放因子 `widthScale` 平滑限制在 `[0.25, 1.0]` 区间内，并沿走廊中心线做贴墙居中偏移；通过隘口进入开阔区后再平滑恢复 `widthScale → 1.0`，避免门框挂角与队列堵塞。

### 5. 行军巡航控速与即时释放

- **巡航控速同步**：小队推进期间，领航逻辑计算队列同步巡航速度并通过 `FormationGuide.maxSpeed` 下发给主阵成员，同时下限不低于成员自身最高速度的 `0.5 * maxSpeed`（避免极端拖慢）；对落后或掉队追赶的成员不施加 `maxSpeed` 限速（置 `0` 或未激活），允许其全速归队。
- **即时释放**：任何退出编队行军的状态——包括小队进入 `engaging` / `holding` / `idle`、收到 `FormationGuideIntent({ active: false })`、`MoveIntent` 重置、`StopIntent`、玩家覆盖指令 `MoveCommand`、到点进入 `holdUnit`（`active = 2`）、不可达停住 `stopUnit` 以及单位死亡 `release_dead`——均立即清空 `FormationGuide`（`active = 0`），恢复单位完整移动速度与自由控制。

## 后果

- **混编行军秩序与跨通道稳定性提升**：职能分排、动态间距与虚拟领航锚点使坦/步/远混编小队能以统一节奏通过窄口并在开阔地自动展开，同时消除子集重发意图时的中心格争抢。
- **移动基准与向后兼容保持不变**：当 `MoveIntent.slots` 省略且 `FormationGuide.active === 0` 时，传统 `MoveCommand` 与无槽位 `MoveIntent` 逻辑及热路径开销保持完全一致；永久组件 `FormationGuide` 的加入使 `moverComponents` 的序列化字段集合新增 4 个零初值字段，相关黄金哈希基线需在全批次联调时按新基线刷新。
- **严格符合确定性纯净区**：`movement/sim/` 与 `movement/protocol.ts` 仅使用 `Math.sqrt`、`Math.floor`、`Math.min`、`Math.max`、`Math.abs`，零新增堆分配。

## 相关

- [ADR 0013](0013-modifier-pipeline.md)、[ADR 0025](0025-logistics-model.md)、[ADR 0026](0026-kernel-implementation-conventions.md)、[ADR 0034](0034-squads.md)、[ADR 0052](0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)、[ADR 0053](0053-damped-asymmetric-avoidance-arrival-hysteresis-and-wall-margins.md)
- [architecture.md §6.8、§7.3](../design/architecture.md)
