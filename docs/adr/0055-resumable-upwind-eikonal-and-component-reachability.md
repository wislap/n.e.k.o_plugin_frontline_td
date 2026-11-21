# 0055. 可恢复迎风 Eikonal 求解器与连通分量可达性

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-21
- 决策者：wislap
- 批次：P1 寻路与运动 V2 重构
- 领域：地形
- 部分取代：0010（以按需暂停/恢复的迎风 Eikonal 连续距离场、Dial 环形桶队列与懒惰连通分量缓存取代 16×16 扇区门户图与局部 Dijkstra）
- 部分取代：0027（分区流场与门户近似实现改为全图无缝迎风 Eikonal 求解与 O(1) 连通分量可达性判定）
- 部分取代：0052（保留两档净空与三段式连续流向梯度契约，并将双线性插值与中心差分从扇区内限制升级为全图无缝跨区查询）

## 背景

在 [ADR 0010](0010-terrain-model-sector-flowfields.md)、[ADR 0027](0027-map-terrain-flowfield-movement.md) 与 [ADR 0052](0052-terrain-clearance-tiers-and-smooth-flow-gradients.md) 建立的 `16×16` 扇区门户流场架构下，随着流场与小队领航对精度与查询开销的要求提升，旧方案暴露出四类结构性瓶颈：

1. **门户中点近似绕路**：每个扇区边界连续段仅取单个中点作为门户节点，跨多扇区路径存在结构性迂回，且扇区内 `smoothDirectionAt` 在扇区边界处被迫截断并退化为离散方向。
2. **栅格距离与八向阶梯误差**：传统 8 邻域 Dijkstra 仅给出折线栅格距离，等势面呈八边形而非欧氏圆，需要靠扇区内局部平滑掩盖锯齿，仍会在非正交方向与跨区交界处产生方向跳变。
3. **可达性探针触发整图/扇区流场计算**：移动与小队探针频繁判断两点是否连通时往往先 `acquireGoal` 再查 `directionAt`，不得不为不可达或临时目标构建门户距与扇区积分场；`invalidateCells` 时也需重建全图门户节点编号。
4. **热路径短生命周期对象分配**：门户边表、局部 Dijkstra 堆与每扇区 `SectorField` 数组在目标切换和建筑拆建时产生频繁分配与 GC 压力。

为此引入基于按 `(cls, tier)` 懒惰烘焙网格缓存、无向连通分量 BFS 与可暂停/可恢复迎风 Eikonal 求解器（Dial 环形桶队列 + 池化 `GoalField`）的 V2 寻路内核。

## 决策

### 1. 按 `(cls, tier)` 懒惰烘焙缓存与连通分量可达性（`grid-cache.ts`）

- **槽位划分与定点数尺度**：每个 `(cls, tier)` 槽位（`slot = tier * classCount + cls`）按需实例化 `SlotCache`，统一使用 `COST_SCALE = 32`（标准地面格步进成本 `10 × 32 = GROUND_COST_SCALED = 320`）。
- **懒惰单格烘焙 `ensureCellBaked`**：使用 `baked: Uint8Array`（`0=未烘焙 / 1=不可通行 / 2=可通行`）、`dirMask: Uint8Array`（按 `DIR_ORDER` 8 位掩码缓存合法出步）与 `enterCost: Int32Array`（按 `COST_SCALE` 缩放的入格正交步成本），并维护 `maxStepScaled` 上界（默认 `30 * COST_SCALE = 960`）。`CLEARANCE_STANDARD` 按格惰性缓存固有属性 `(metaCost, metaHeight, metaRamp)` 并配合 `surfCost: Int16Array`（64 槽地形代价缓存）与 `heightStepPassable` 计算正交/斜向可通行性，将全图 `terrain.stepCost` 探测降至每类地形一次；`CLEARANCE_HEAVY` 结合 4 子格精确评估 `terrain.stepCost`。
- **懒惰无向连通分量与 `reachable`**：`SlotCache` 维护 `compId: Int32Array`、`compValid` 与复用 `bfsQueue: Int32Array`。`ensureComponents()` 仅在首次需要时按双向合法 4 正交邻域运行扁平数组 BFS；`PathingApi.reachable(sx, sy, gx, gy, cls, tier?)` 对坐标取 `Math.floor` 后在 `O(1)` 内判定是否属于同一非零连通分量，不再触发 Eikonal 扩散。
- **局部失效范围**：`invalidate(cells)` 置 `compValid = false`，并将 `baked[idx]` 重置为 `0`：`CLEARANCE_STANDARD` 外扩 `dx, dy ∈ {-1, 0, 1}`，`CLEARANCE_HEAVY` 外扩 `dx, dy ∈ {-2, -1, 0, 1}`，精确覆盖 `2×2` 足迹及斜向切角邻格。

### 2. 可恢复迎风 Eikonal 求解器与对象池（`eikonal.ts`）

- **Dial 环形桶队列 `FrontierQueue`**：采用 `head`/`tail` 双向链表连接的 2 的幂环形桶（`ringSize >= Math.max(2048, maxStepScaled * 2 + 128)`，将桶数组控制在一级缓存内）；桶内以 $O(1)$ FIFO 尾插与弹出，依靠固定起点与 `DIR_ORDER` 展开顺序保证同代价出队顺序完全确定；当 `cost - cur >= ringSize` 时倍增 `ringSize` 并重分桶。
- **`GoalField` 与队列双池化**：分别池化最多 16 个 `GoalField` 与 16 个 `FrontierQueue`。当队列清空（`openCount === 0`）时立即设 `exhausted = true` 并即时归还 `queue`；`releaseGoal`、缓存重置与 `invalidateCells` 时归还 `GoalField`（及其非空 `queue`）。
- **目标点源奇异性消除**：当弹出目标格（`c === 0`）时，对其 8 邻域直接按欧氏步权弛豫：正交邻格取 `stepInto * COST_SCALE`，斜向邻格取 `Math.max(1, (wDiagBase * COST_SCALE * Math.SQRT2 + 0.5) | 0)`（其中 `wDiagBase` 在双正交腿合法时取两者最大值，否则取 `stepInto * (10 / 14)`），消除经典 FMM 点源初始八角误差。
- **迎风二次更新与严格 Lyapunov 单调性**：对非目标格的 4 个未定型正交邻格，各自取最优已定型 X 邻格 `(ux, wx)` 与 Y 邻格 `(uy, wy)`；当双轴均已定型、对应斜向步合法且 `|ux - uy| < max(wx, wy)` 时，求解迎风 Eikonal 二次方程 `quad = (0.5 * (ux + uy + Math.sqrt(2 * wMax * wMax - diff * diff)) + 0.5) | 0`，并施加 `safeQuad = Math.max(quad, Math.max(ux, uy) + 1)` 保证 `u` 沿最优下行路径严格单调递增；主展开循环内联队列指针与边界/烘焙检查以减少函数调用开销。
- **按需暂停与恢复**：`expandUntil(..., targetCell)` 仅推进到 `state[targetCell] === 2`（定型）或队列耗尽即暂停，后续对更远格子的查询从当前 `FrontierQueue` 断点继续展开。

### 3. 全图无缝流场查询与连续距离接口（`module.ts`）

- **扁平槽位与 `costAtCell` 极速路径**：目标与距离场索引采用密集扁平数组 `goalSlots` / `fieldSlots` 并消除每次平滑查询的临时包装对象；`costAtCell` 在边界检查后第一时间检验 `field.state[idx] === 2` 并直接返回 `u[idx]`。若未定型且 `compValid` 已就绪，则先经 `sameComponent(x, y, gx, gy)` 在 $O(1)$ 内剪枝不可达查询（避免为普通可达流场强制触发全图 `ensureComponents()` 冷扫）；否则按需调用 `expandUntil` 恢复波前（不可达目标一旦队列耗尽即置 `exhausted = true`，后续查询同为 $O(1)$）。
- **离散方向 `directionAt`**：要求候选邻格满足严格 Lyapunov 下降（`uNext < here`），按 `DIR_ORDER` 最小化 `uNext + step * COST_SCALE` 并缓存在 `dirPacked: Uint8Array` 中，杜绝环路与死锁。
- **全图无缝 `smoothDirectionAt` 与 `distanceAt`**：取消旧扇区边界限制，Stage 1 在全图范围计算 `2×2` 对偶双线性插值与负梯度（先对四角调用 `costAtCell` 确保冷/热缓存结果一致，并在 `quadFlags` 惰性缓存 `STAGE1_QUAD_OK`），Stage 2 在全图范围执行安全正交中心差分（缓存 `STAGE2_CARD_OK`），Stage 3 回退至归一化离散方向 `d0`。新增 `distanceAt(goalId, px, py)` 在 Stage 1 有效时双线性插值连续距离并除以 `GROUND_COST_SCALED`，否则回退至 `costAtCell / GROUND_COST_SCALED`。
- **纯净区与存档兼容性**：`pathing/sim/` 严格仅使用 `+ - * /` 与 `Math.sqrt`、`Math.SQRT2`、`Math.round`、`Math.floor`、`Math.min`、`Math.max`、`Math.abs`；`frontline_td:pathing.goals` 状态格式保持 `{ nextId, freeIds, entries }`（`tier === 0` 省略 `tier`）不变，派生缓存于 `load` / `invalidateCells` 时重置而非序列化。

## 后果

- **全图欧氏精度与跨区平滑**：彻底移除 `16×16` 扇区门户近似与扇区边界梯度截断，单位在跨区、斜向及绕障时获得连续一致的梯度与子格距离估计。
- **不可达查询零扩散开销**：`reachable` 与 `costAtCell` 的连通分量门控避免了为不可达目标空跑整图展开，且不破坏现有调用方在 `PathingApi` 上的流场语义。
- **确定性与低分配约束延续**：Dial 环形桶按格索引升序破平、Eikonal 严格整型算术与 `GoalField`/`FrontierQueue` 池化满足零非确定性数学函数与低 GC 要求；仅使用 `Math.sqrt` 与 `Math.SQRT2`，仍受 ESLint 纯净区门禁保护。

## 相关

- [ADR 0006](0006-determinism.md)、[ADR 0010](0010-terrain-model-sector-flowfields.md)、[ADR 0027](0027-map-terrain-flowfield-movement.md)、[ADR 0052](0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)
- [architecture.md §6.8、§9](../design/architecture.md)
