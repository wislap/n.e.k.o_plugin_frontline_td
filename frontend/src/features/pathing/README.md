# pathing

## 职责
基于扇区流场（sector flowfield，ADR 0010、ADR 0052）为各移动类别与净空分档
（`1×1` 标准档 `tier = 0` / `2×2` 重型档 `tier = 1`）提供寻路：扇区边界提取
门户（portal）、扇区内边表、目标距离查询、按扇区惰性计算的离散流向与集成代价场，
以及扇区内对偶双线性连续流向梯度查询 `smoothDirectionAt`。单位移动的结算在
movement，本模块只提供方向查询。

## 公开接口
`sim/index.ts`:
- `createPathingModule(terrain: TerrainApi, classCount)` → `{ module, api }`
- `PathingApi`：`acquireGoal(x, y, cls, tier?)` / `releaseGoal(id)` /
  `goalRefCount(id)` / `directionAt(goalId, x, y)` /
  `smoothDirectionAt(goalId, px, py)` / `invalidateCells(cells)`
- `DIR_ORDER`（固定邻序）、`UNREACHABLE`、`dijkstra`
- 导出全表见 [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- 无实体组件、无网格层。目标表（id → cell/class/tier/refcount）通过
  `builder.state` 序列化，状态键 `frontline_td:pathing.goals`；`tier === 0` 时
  省略 `tier` 字段以保持与既有黄金哈希完全兼容。门户图与流场缓存为派生数据，
  不序列化。

## 不变量
- 扇区边长固定 16 格；门户是边界上可通行邻格对的连续段，按段取中点对；成本全部为
  整数；Dijkstra 堆键为 `(cost, index)`，保证确定性；`dijkstra` 接受可选
  `maxCost` 上界，超出即停止展开。
- 图缓存按 `(cls, tier)` 槽位键控（`tier * classCount + cls`）：`tier = 0` 在初始化
  与载入时急切构建，`tier = 1` 按需惰性构建；所有内部步进评估均透传 `tier` 至
  `terrain.stepCost(..., cls, tier)`。
- 离散方向选择只考虑可通行的步（`stepCost >= 0`），按 `DIR_ORDER`
  （N,E,S,W,NE,SE,SW,NW）取「邻格距离 + 步进成本」最小者。
- `SectorField` 同时保留 `dx`、`dy` 与集成代价 `cost: Int32Array`；
  `smoothDirectionAt(goalId, px, py)` 按三段式零堆分配计算连续单位方向：
  1. 扇区内 `2×2` 对偶双线性梯度（要求四角同扇区、可达且四边与双对角双向可通行）；
  2. 同扇区安全四向中心差分（要求四向邻步合法且合力步进可通行）；
  3. 归一化离散 `d0` 兜底；前两段均受正方向门控 `gx * d0x + gy * d0y > 0` 约束，
     全部归一化仅使用确定性 `Math.sqrt`。
- `directionAt` 与 `smoothDirectionAt` 各自复用独立的内部 scratch 对象，互不干扰，
  调用方不得长期持有返回值。
- `invalidateCells` 重算所有已实例化 `(cls, tier)` 槽位中受影响扇区及其邻居的门户与
  边表，并清空派生缓存；`tier = 1` 时将每个变更格向 `(x - ox, y - oy)`
  （`ox, oy ∈ {0, 1}`）外扩后再标记扇区，确保角点阻挡（如 `(16, 16)`）能同步失效
  对角扇区的 `2×2` 锚点（如 `(15, 15)`）。接线时经 `terrain.onBlockedChange` 注册，
  阻挡变化自动失效重算。
- 状态载入时（restore）会重建标准档图并重置惰性槽位与派生缓存——因为地形阻挡
  覆盖层先于 pathing 载入（sim-registry 中 terrain 必须排在 pathing 之前）。

## 对应设计
- [architecture.md §6.8](../../../../docs/design/architecture.md)
  （扇区流场）。
- [ADR 0010](../../../../docs/adr/0010-terrain-model-sector-flowfields.md)
  （模型）、[ADR 0027](../../../../docs/adr/0027-map-terrain-flowfield-movement.md)
  （确定性约束）、[ADR 0052](../../../../docs/adr/0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)
  （地形净空分档与连续流场梯度）。
