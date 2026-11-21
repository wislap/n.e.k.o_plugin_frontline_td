# 0053. 阻尼非对称避让、到达迟滞与墙体边距

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-21
- 决策者：wislap
- 批次：S2 阻尼避让与到达迟滞
- 领域：模拟
- 部分取代：0027（转向接入连续流向梯度 smoothDirectionAt 并引入到达减速带与守位迟滞死区；分离改为双斜率过阻尼排斥、r²×状态非对称让路、友军/对向切向绕行与单 tick 推挤限幅；积分增加按净空分档的平面墙距与凸角圆弧夹紧；移动编组与出兵按 (cls, tier) 分档）

## 背景

在 [ADR 0027](0027-map-terrain-flowfield-movement.md) 的初版移动实现基础上，大规模编队行军、交战卡位与重型单位贴墙运动暴露出四类核心缺陷：

1. **无上限单 tick 重叠推挤诱发高速弹跳**：分离系统原按固定 `0.5 * overlap` 一次性全额推开，密集挤兑时单 tick 位移可远超单位自身 `maxSpeed`，导致集群剧烈抖动、弹飞与穿插。
2. **`ARRIVAL_DIST = 0.3` 阶跃断点与 `SEPARATION_GAP = 0.2` 互相打架**：单位一旦被挤出 `0.3` 格外即刻以全速切回站位、撞入邻近单位后再被弹回，形成无休止的原地呼吸振荡。
3. **对称 `0.5 / 0.5` 让路卡死前排与窄道对向行军**：静止单位、守位单位与行军单位均分推力，导致重型单位与交战前排被轻型友军挤偏，且友军同向/对向迎面相遇时缺少切向绕行分量而原地顶牛。
4. **缺少连续墙体边距与重型 `tier = 1` 消费接通**：积分系统原仅在跨越格线时通过 `canStep` 拦截，单位圆体仍可贴边切入岩石/悬崖或卡死在凸角斜角；同时 `lineWalkable`、编队站位、`MoveCommand` / `MoveIntent` 目标解析及 `units` 出兵尚未接入 [ADR 0052](0052-terrain-clearance-tiers-and-smooth-flow-gradients.md) 定义的 `(cls, tier)` 与 `smoothDirectionAt` 连续梯度。

## 决策

### 1. 转向接入 `smoothDirectionAt`、到达减速带与守位迟滞死区

- **连续流向梯度消费**：`steer` 在无法直线直达（`dist > DIRECT_DIST` 或 `!lineWalkable(terrain, cls, px, py, tx, ty, tier)`）时改调 `pathing.smoothDirectionAt(goal, px, py)` 获取扇区内连续流向单位向量，消除 8 向折线抖动。
- **到达减速带（`SLOWDOWN_DIST = 0.85`）**：当单位接近站位（`dist < SLOWDOWN_DIST`）且可直线直达或处于到达末端时，速度随 `dist / SLOWDOWN_DIST` 平滑衰减，避免以全速冲过目标点引发过冲回拉。
- **双阈值到达迟滞死区**：将原单一阈值 `ARRIVAL_DIST = 0.3` 拆分为入位阈值 `ARRIVAL_ENTER_DIST = 0.18` 与守位回拉死区阈值 `HOLD_DEADBAND_DIST = 0.36`：
  - `active === 1`（行军中）进入 `dist <= ARRIVAL_ENTER_DIST` 后释放流场引用并切入 `active = 2`（守位）。
  - `active === 2`（守位中）仅当被外力挤出 `dist > HOLD_DEADBAND_DIST` 时才触发回位转向，且在 `(ARRIVAL_ENTER_DIST, HOLD_DEADBAND_DIST]` 滞回带内保持静止，彻底断开与分离间隙的耦合振荡。

### 2. 双斜率过阻尼分离、非对称权重与切向绕行

- **双斜率过阻尼排斥**：将分离缓冲间隙收紧为 `SEPARATION_GAP = 0.08`：
  - 缓冲带软排斥（`0 < overlap <= SEPARATION_GAP`）：采用低刚度 `SOFT_STIFFNESS = 0.25` 柔和消解轻度挤压；
  - 硬核重叠加压（`overlap > SEPARATION_GAP`）：核心穿透部分采用高刚度 `CORE_STIFFNESS = 0.65`（总推力为 `SOFT_STIFFNESS * min(overlap, SEPARATION_GAP) + CORE_STIFFNESS * max(0, overlap - SEPARATION_GAP)`），实现既不软塌也不弹跳的过阻尼响应。
- **基于 $r^2 \times \text{stateFactor}$ 的非对称让路权重**：
  - 同阵营按移动状态赋予状态因子：`moving = 2.5`、`stopped = 1.8`、`holding = 0.6`，令行军单元、停驻单位与已就位守位单元保持清晰让行次序；推挤占比按各自等效质量 $w = r^2 \times \text{stateFactor}$ 反比分配（权重越高越稳固：重型单位凭 $r^2$ 主导稳固，`moving = 2.5` 保持推进，已守位 `holding = 0.6` 温和侧让通行，避免挡死过道友军）。
  - 敌对阵营之间不读取对方意图态，采用纯几何权重 $w = r^2$。
- **友军与对向切向绕行（`WRAP_FACTOR = 0.60`）**：当两单位存在速度相对冲或同向挡道趋势时，在法向分离推力之外叠加正交切向绕行分量（系数 `WRAP_FACTOR = 0.60`），引导同向超车与窄道交错让行，避免对称死锁。
- **单 tick 推挤矢量限幅**：对每个单位累加后的分离矢量实施模长上限夹紧：`maxPush = Math.max(0.06, speed * 1.15)`，保证任何拥挤场景下都不会出现单 tick 超过合理步长的瞬移或弹性反冲。

### 3. 按净空分档的平面墙距与凸角圆弧夹紧（`clampFootprintMargin`）

在积分阶段以统一纯函数 `clampFootprintMargin` 替代仅依赖格线 `canStep` 的被动截断，确保运动半径与地形硬边界之间始终维持连续净空：

- **分档最大边距**：
  - `tier = 0`（标准单位）：`margin = Math.min(r * 0.75, 0.30)`；
  - `tier = 1`（重型 `2×2` 单位）：`margin = Math.min(r * 0.85, 0.75)`。
- **平面墙体 / 动态阻挡 / 悬崖边距夹紧**：针对单位足迹所在锚点格邻接的不可通行边（岩石、建筑动态阻挡或无坡道的悬崖高差），将连续位置沿法向夹紧至距离墙面至少 `margin` 处。
- **凸角圆弧夹紧**：当正交两侧皆通而斜向对角格不可通行（或重型足迹角邻格受阻）形成凸角顶点时，以该顶点为圆心按半径 `margin` 做确定性圆弧投影外推（仅使用 `Math.sqrt`），消除贴角行走时的卡角顿挫与视觉穿模。

### 4. `(cls, tier)` 分档编组、目标解析与 `2×2` 重型出兵

- **`lineWalkable(..., tier = CLEARANCE_STANDARD)`**：起点与终点经 `clearanceAnchorCell(..., tier)` 映射至对应档位锚点格，并在 Amanatides–Woo DDA 步进中向 `terrain.stepCost(..., cls, tier)` 透传 `tier`。
- **`collectSlots` / `formationDesired` / `assignSlots(..., tier = CLEARANCE_STANDARD)`**：
  - `step = clearanceFootprintSize(tier)`，`maxRing = Math.ceil(Math.sqrt(n)) * step + SLOT_RING_MARGIN`；
  - 仅收集满足 `terrain.passable(x, y, cls, tier) && connected(x, y)` 的锚点，且当 `step > 1` 时跳过与已选站位 Chebyshev 距离小于 `step` 的重叠锚点（`slots.length === 0` 时才兜底 `{ x: tx, y: ty }`）；
  - 站位中心统一通过 `clearanceAnchorCenter(c, tier)` 映射（`tier = 0` 为 `c + 0.5`，`tier = 1` 为 `c + 1`）。
- **`intents.ts` 按 `(cls, tier)` 分组与 `resolveTierTarget`**：
  - `MoveCommand` 与 `MoveIntent` 均按 `(cls, tier)` 划分单位子组。
  - `resolveTierTarget(..., allowSnap)` 对 `tier = 0` 检查 `terrain.passable(x, y, cls, 0)`（失败时仅 `allowSnap` 走 `snapReachable`）；对 `tier = 1` 先探测覆盖目标格 `(x, y)` 的 4 个重型锚点 `(x - ox, y - oy)`（`(ox, oy) ∈ {(0,0), (1,0), (0,1), (1,1)}`），命中首个 `passable(..., 1)` 即采纳，否则当 `allowSnap || terrain.passable(x, y, cls, 0)` 时调用 `snapReachable(..., CLEARANCE_HEAVY, ...)`，在点击可通行窄缝时就近吸附到可达 `2×2` 位置、而在点击岩石时保留 `'invalid_target'` 拒绝。
  - `MoveCommand` 严格先校验全部 `(cls, tier)` 子组再修改状态；`applyMoveGroup` 向 `acquireGoal`、`collectSlots`、`assignSlots` 与兜底点透传 `tier`。
- **`units` 按 `2×2` 足迹出生与占用检查**：`onStart` 与 `units.spawn` 按 `tier = clearanceTierForRadius(unit.radius)`、`size = clearanceFootprintSize(tier)` 检查 `terrain.passable(x, y, cls, tier)` 及 `size × size` 占用格空闲状态，标记全部 `size × size` 占格后生成于 `(clearanceAnchorCenter(x, tier), clearanceAnchorCenter(y, tier))`；`units.spawn` 扫描既有实体占用格时同步对 `CLEARANCE_HEAVY` 实体标记完整 `2×2` 锚点区，同时严格保持 `tier = 0` 在 `(x + 0.5, y + 0.5)` 的既有行为。

## 后果

- **移动振荡与穿模显著改善**：过阻尼双斜率排斥、到达减速带、迟滞死区与分档墙体边距共同消除了守位呼吸抖动、对向死锁与贴墙/凸角穿模。
- **重型单位全链路贯通**：从地形净空、流场寻路、出兵占位到编队移动指令全路径支持 `tier = 1`（`2×2`），且严格遵循 `movement/sim/` 与 `units/sim/` 的 ESLint 确定性纯净区限制（仅使用 `Math.sqrt`、`Math.floor`、`Math.ceil`、`Math.min`、`Math.max`、`Math.abs`、`Math.sign`）。
- **黄金哈希预期刷新**：由于转向接入连续流向梯度、分离改为阻尼非对称避让以及新增到达减速带与墙体边距，既有移动确定性测试与整局冒烟测试（match-smoke）的黄金状态哈希需按本批次新基线同步刷新。

## 相关

- [ADR 0027](0027-map-terrain-flowfield-movement.md)、[ADR 0052](0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)
- [architecture.md §6.8、§7.3](../design/architecture.md)
