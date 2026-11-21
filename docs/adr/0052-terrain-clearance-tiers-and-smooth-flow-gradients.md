# 0052. 地形净空分档与连续流场方向梯度

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-21
- 决策者：wislap
- 批次：S1 地形净空与连续流场
- 领域：地形
- 部分取代：0010（补齐按移动类别 × 净空分档 1×1 标准档 / 2×2 重型档的门户流场，并在离散 8 向流场之上新增扇区内对偶双线性连续流向梯度查询 smoothDirectionAt）

## 背景

[ADR 0010](0010-terrain-model-sector-flowfields.md) 确立了“移动类别 × 体积等级”的分区流场设计基线，但早期实现（[ADR 0027](0027-map-terrain-flowfield-movement.md)）仅按 `1×1` 单格净空构建寻路图，且 `SectorField` 只向移动系统暴露离散 8 方向向量，带来两类问题：

1. **大体型单位穿窄缝与悬崖跨骑风险**：半径 `r > 0.45` 的重型单位在仅按 `1×1` 格子评估的流场上会被引导进入 1 格宽窄巷、单格坡道或贴墙角切过，出现视觉穿模或靠局部推挤硬卡在墙体/悬崖边沿的现象。
2. **网格离散 8 向阶梯抖动**：直接读取格中心离散 8 向向量使单位在开阔扇区内呈 45°/90° 折线行进，在流场切换边界处容易出现方向跳变。

为此需要落地按净空分档（`tier`）扩展的地形与门户流场契约，以及基于扇区集成代价场的连续梯度方向查询，同时严格保持既有 `tier = 0` 的确定性与黄金哈希不变。

## 决策

### 1. 两档净空模型与 `2×2` 足迹规则

在 `terrain/rules/clearance.ts` 中定义两档净空（`CLEARANCE_TIERS = 2`）：

- **标准档（`CLEARANCE_STANDARD = 0`）**：适用于 `r <= 0.45`（`STANDARD_RADIUS_MAX = 0.45`）的单位；占格尺寸 `1×1`，锚点格 `(x, y)` 即自身所在格（`Math.floor(worldCoord)`），中心位于 `(x + 0.5, y + 0.5)`。行为与既有 `TerrainApi` 完全一致。
- **重型档（`CLEARANCE_HEAVY = 1`）**：适用于 `0.45 < r <= 0.95` 的单位；占格尺寸 `2×2`，由左上角锚点 `(x, y)` 覆盖 `{x, x + 1} × {y, y + 1}` 四格，世界坐标映射为 `Math.floor(worldCoord - 0.5)`，足迹几何中心位于 `(x + 1.0, y + 1.0)`。
- **内部正交边悬崖跨骑禁止**：`tier = 1` 下 `passable(x, y, cls, 1)` 与 `staticPassable(x, y, cls, 1)` 除要求 `inBounds(x, y) && inBounds(x + 1, y + 1)` 且四格地表均可通行（`passable` 同时检查未受动态阻挡）外，还必须满足足迹内部 4 条正交边 `(x,y)<->(x+1,y)`、`(x,y)<->(x,y+1)`、`(x+1,y)<->(x+1,y+1)`、`(x,y+1)<->(x+1,y+1)` 均满足 `edgePassable` / `staticEdgePassable`，彻底禁止 `2×2` 足迹跨骑悬崖或单格宽坡道。
- **步进成本取子格最大值**：`stepCost(ax, ay, bx, by, cls, 1)` 要求起点与终点均满足 `passable(..., 1)`，对角步还要求两条正交过渡锚点 `passable(bx, ay, cls, 1)` 与 `passable(ax, by, cls, 1)` 可通行；对 `(ox, oy) ∈ {0, 1}²` 的 4 条 `tier = 0` 子步分别求 `stepCost0(ax + ox, ay + oy, bx + ox, by + oy, cls)`，任一子步返回 `-1` 则整体拒绝，否则取 4 项整数代价的最大值（`Math.max`），过程零堆分配。
- **动态阻挡失效范围外扩**：当格子 `(cx, cy)` 发生阻挡状态变化时，影响的重型锚点集合覆盖 `(cx - 1..cx, cy - 1..cy)` 共 `2×2` 范围内的锚点格，失效通知据此扩散到受影响的扇区。

### 2. `(cls, tier)` 惰性流场图与对偶双线性连续梯度

- **`(cls, tier)` 惰性 `ClassGraph` 实例化**：门户图与流场缓存按 `(cls, tier)` 键控并按需惰性创建 `ClassGraph`，避免在仅存在标准单位的地图/波次中预先构建重型图。
- **`SectorField.cost: Int32Array` 保留**：`SectorField` 在生成离散 8 向矢量场的同时保留每个格子到目标的集成代价 `cost: Int32Array`，为梯度求导提供直接数据源。
- **三段式连续流向查询 `smoothDirectionAt(goalId, px, py)`**：
  1. **扇区内 `2×2` 对偶双线性梯度**：将连续坐标 `(px, py)` 映射到锚点中心对偶网格，若周围 `2×2` 采样点均位于同一扇区且具备有效集成代价，则对 `cost` 做双线性插值并求负梯度 `(gx, gy)`；
  2. **安全四向中心差分**：在部分邻格缺失或不可达时退化为仅依赖同扇区有效正交邻格的安全中心差分；
  3. **离散 `d0` 兜底与一致性门控**：靠近障碍物、悬崖或扇区边界时，若梯度无效或未通过正方向门控 `gx * d0.dx + gy * d0.dy > 0`，则直接回退到归一化的离散 8 向矢量 `d0`；全部归一化仅使用确定性 `Math.sqrt`（严禁 `Math.hypot`、`Math.atan2` 等禁用数学函数）。

## 后果

- **分层落地的明确边界**：本批先在 `terrain` 模块落地净空规则与 `TerrainApi` 签名扩展，并在 `pathing` 完成 `(cls, tier)` 图与 `smoothDirectionAt` 供给；`movement` 与 `squads` 对 `tier = 1` 及 `smoothDirectionAt` 的消费将在后续批次 S2–S3 接入。
- **零回归保持既有确定性**：`TerrainApi` 的 `tier` 默认保持 `CLEARANCE_STANDARD = 0` 快速路径，且 `frontline_td:pathing.goals` 在 `tier === 0` 时省略 `tier` 字段，确保既有全部 `tier = 0` 场景与黄金哈希完全不变。
- **纯模拟数学约束延续**：`terrain/rules`、`terrain/sim` 与 `pathing/sim` 继续受 ESLint 纯净区门禁约束，仅使用 `Math.sqrt`、`Math.floor`、`Math.abs`、`Math.min`、`Math.max` 与 `core` 定点数辅助函数。

## 相关

- [ADR 0010](0010-terrain-model-sector-flowfields.md)、[ADR 0027](0027-map-terrain-flowfield-movement.md)
- [architecture.md §3.4、§6.8](../design/architecture.md)
