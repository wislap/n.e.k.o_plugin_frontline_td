# pathing

## 职责
基于按需可恢复的迎风 Eikonal 求解器与连通分量缓存（ADR 0055、ADR 0052）为各移动类别与
净空分档（`1×1` 标准档 `tier = 0` / `2×2` 重型档 `tier = 1`）提供寻路：按 `(cls, tier)`
槽位懒惰烘焙格子通行性与入格代价、无向连通分量 `O(1)` 可达性判定、基于 Dial 环形桶
队列的增量距离/流向场，以及全图无缝 `2×2` 对偶双线性连续流向梯度 `smoothDirectionAt`
与连续距离查询 `distanceAt`。单位移动的结算在 movement，本模块只提供距离、可达性与方向查询。

## 公开接口
`sim/index.ts`:
- `createPathingModule(terrain: TerrainApi, classCount)` → `{ module, api }`
- `PathingApi`：`acquireGoal(x, y, cls, tier?)` / `releaseGoal(id)` /
  `goalRefCount(id)` / `reachable(sx, sy, gx, gy, cls, tier?)` /
  `distanceAt(goalId, px, py)` / `directionAt(goalId, x, y)` /
  `smoothDirectionAt(goalId, px, py)` / `invalidateCells(cells)`
- `DIR_ORDER`（固定邻序）、`UNREACHABLE`、`dijkstra`（供 logistics 等复用）
- 导出全表见 [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- 无实体组件、无网格层。目标表（id → cell/class/tier/refcount）通过
  `builder.state` 序列化，状态键 `frontline_td:pathing.goals`；`tier === 0` 时
  省略 `tier` 字段以保持存档格式兼容。`SlotCache`、连通分量与 `GoalField` 距离/流场缓存
  为派生数据，不序列化。

## 不变量
- 内部定点数代价比例固定 `COST_SCALE = 32`（标准地面格步进成本 `GROUND_COST_SCALED = 320`）；
  全部代价、队列游标与 Eikonal 求解均为整数运算（仅迎风二次方程与向量归一化使用确定性
  `Math.sqrt` / `Math.SQRT2`）；Dial 环形桶队列最小 2048 桶，以 `head`/`tail` $O(1)$ FIFO
  顺序出入队，配合固定起点与 `DIR_ORDER` 展开保证确定性；目标与流场映射使用扁平数组
  `goalSlots` / `fieldSlots` 避免热路径对象分配。
- 网格缓存按 `(cls, tier)` 槽位（`tier * classCount + cls`）懒惰创建：单格在首次访问时
  烘焙 `baked`、`dirMask`、`enterCost` 并更新 `maxStepScaled`（`tier = 0` 按格惰性缓存
  固有属性 `(metaCost, metaHeight, metaRamp)` 与 64 槽 `surfCost`，每类地形仅探测一次
  `terrain.stepCost`）；`ensureComponents` 仅在首次 `reachable` 查询时按双向合法
  4 正交邻域跑扁平 BFS 生成 `compId`。
- `reachable(sx, sy, gx, gy, cls, tier?)` 对双端坐标取 `Math.floor` 并经 `sameComponent`
  查询，不分配或展开 `GoalField`；`costAtCell` 仅在 `compValid` 已就绪时用同分量剪枝，其余
  情况直接按需调用 `expandUntil` 恢复波前。
- `GoalField` 与 `FrontierQueue` 各自池化最多 16 个实例：队列清空（`openCount === 0`）即刻
  回收 `queue`，`releaseGoal` / `invalidateCells` / `load` 时回收 `GoalField`。
- 目标格（`c === 0`）的 8 邻域采用欧氏斜向种子消除 FMM 点源奇异性；非目标格迎风二次更新
  施加 `safeQuad = Math.max(quad, Math.max(ux, uy) + 1)` 强制严格 Lyapunov 单调性。
- 离散方向 `directionAt` 要求候选邻格严格满足 `uNext < here`，按 `DIR_ORDER`
  （N,E,S,W,NE,SE,SW,NW）取 `uNext + step * COST_SCALE` 最小者并缓存于 `dirPacked`。
- `smoothDirectionAt(goalId, px, py)` 在全图范围无缝执行四段式零堆分配连续方向计算（ADR 0059 增加 Stage 2b 贴墙单侧迎风合法梯度回退，以 `quadFlags` 惰性缓存校验位）：
  1. 全图 `2×2` 对偶双线性梯度（先对四角调用 `costAtCell` 结算，保证冷/热缓存结果一致，要求四角可达且四边与双对角双向可通行）；
  2. 全图安全四向对称中心差分（先结算四正交邻格，要求四向邻步合法且合力步进可通行）；
  2b. 贴墙单侧迎风合法梯度回退（Stage 2 遇墙缺边时，仅沿合法可步进正交半边做单侧迎风斜率求和，再经合力可通行与正方向门控）；
  3. 归一化离散 `d0` 兜底；前两/三段均受正方向门控 `gx * d0x + gy * d0y > 0` 约束。
- `distanceAt(goalId, px, py)` 在 Stage 1 `2×2` 四边形有效时返回双线性插值后的连续格距
  （除以 `GROUND_COST_SCALED`），否则回退为 `costAtCell / GROUND_COST_SCALED`（不可达返回 `null`）。
- `directionAt` 与 `smoothDirectionAt` 各自复用独立的内部 scratch 对象，互不干扰，
  调用方不得长期持有返回值。
- `invalidateCells` 回收全部派生 `GoalField`（保留激活目标 ID 与引用计数），并将每个已实例化
  `SlotCache` 的 `compValid` 置为 `false`、按 `tier = 0` 外扩 `{-1..1}` / `tier = 1` 外扩
  `{-2..1}` 重置受影响格的 `baked` 标志。接线时经 `terrain.onBlockedChange` 注册，阻挡变化
  自动失效重算。
- 状态载入时（restore）重置全部 `SlotCache` 与派生 `GoalField`——地形阻挡覆盖层先于
  pathing 载入（sim-registry 中 terrain 必须排在 pathing 之前）。

## 对应设计
- [architecture.md §6.8](../../../../docs/design/architecture.md)
  （流场寻路）。
- [ADR 0010](../../../../docs/adr/0010-terrain-model-sector-flowfields.md)
  （模型）、[ADR 0027](../../../../docs/adr/0027-map-terrain-flowfield-movement.md)
  （确定性约束）、[ADR 0052](../../../../docs/adr/0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)
  （地形净空分档与连续流场梯度）、[ADR 0055](../../../../docs/adr/0055-resumable-upwind-eikonal-and-component-reachability.md)
  （可恢复迎风 Eikonal 求解器与连通分量可达性）、[ADR 0059](../../../../docs/adr/0059-damped-aperture-locomotion-mixed-cohesion-and-surround-arcs.md)
  （Stage 2b 贴墙单侧迎风梯度平滑）。
