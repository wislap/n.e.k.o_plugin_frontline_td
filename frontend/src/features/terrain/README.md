# terrain

## 职责
解析并持有地图地形数据：地表类型、高度、坡道，并持有动态阻挡
覆盖层（建筑等占格）：可通行性仍是地形的公开概念，阻挡由本模块统一
并入 passable / stepCost。覆盖层经 builder.state 序列化，并在变化时
镜像到 blocked 网格层。

## 公开接口
- `sim/index.ts`: `createTerrainModule(grid, surfaces)` → `{ module, api }`；
  `createTerrainApi(grid, surfaces)` → `TerrainApi`（查询 + 阻挡接口）。
- `TerrainApi`：`blocked(x, y)`、`setBlocked(cells, value)`（仅在实际
  变化的格子上同步回调监听）、`onBlockedChange(listener)`（接线期注册，
  pathing 与 logistics 借此失效重算）；`passable`、`staticPassable` 与
  `stepCost` 支持可选尾部净空分档参数 `tier?: ClearanceTier`（默认
  `CLEARANCE_STANDARD = 0`）。
- `protocol.ts`：三层网格层 ID 常量（height/surface/blocked）。
- `content.ts`: `surfaceSchema`、`movementClassSchema`、`mapSchema`、
  `decodeMap`、`TerrainGrid`、`SurfaceContent`、`MapContent`、
  `MovementClassContent`。
- `rules/index.ts`: `heightStepPassable`、`spiralOffsets` 以及两档净空规则
  （`CLEARANCE_STANDARD`、`CLEARANCE_HEAVY`、`CLEARANCE_TIERS`、
  `STANDARD_RADIUS_MAX`、`ClearanceTier`、`clearanceTierForRadius`、
  `clearanceFootprintSize`、`clearanceAnchorCell`、`clearanceAnchorCenter`；
  纯规则，客户端共享）。
- `render/`：`TerrainMesh`/`buildTerrainGeometry`（含基于 `fwidth` 的自适应
  地形网格着色器及高程/悬崖/坡道明暗对比；vision 的 `FogLayer` 复用同一几何，
  并在卸载时 `.dispose()`）。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- 网格层 `frontline_td:terrain.height`（u8，全局）。
- 网格层 `frontline_td:terrain.surface`（u16，全局）。
- 网格层 `frontline_td:terrain.blocked`（u8，全局；capture_fog 系统
  按需写入）。
- 模块状态 `frontline_td:terrain.blocked_overlay`（覆盖层字节，
  序列化）。

## 不变量
- 8 邻居边规则：两格均可通行且高度相等，或 |Δh|=1 且较低一格为坡道；
  对角步还要求两条正交腿均可通行（禁止切角）。被阻挡的格子对所有
  移动类别不可通行，进出该格的边与对角腿一律拒绝。
- 步进成本为整数：正交 = 目标格成本，对角 = floorDiv(cost × 14, 10)。
- 两档净空分档：`tier = 0`（`CLEARANCE_STANDARD`，`r <= 0.45`）对应 `1×1`
  单格足迹，中心 `(x + 0.5, y + 0.5)`，保持既有零分配快速路径；`tier = 1`
  （`CLEARANCE_HEAVY`，`r > 0.45`）以左上角 `(x, y)` 为锚点覆盖
  `{x, x+1}×{y, y+1}` 四个格子，中心 `(x + 1.0, y + 1.0)`，要求 4 格均在界内
  且内部 4 条正交边均满足 `edgePassable`（`staticPassable` 使用
  `staticEdgePassable`，禁止跨骑悬崖与单格坡道），`stepCost` 要求起止锚点
  及对角过渡锚点均可通行，并取 4 条 `tier = 0` 子步整数代价的最大值。
- 高度与地表不可变；阻挡覆盖层可在任意 tick 边界修改，
  变化通过 onBlockedChange 通知 pathing 与 logistics 失效重算，并在
  下一个 capture_fog 阶段镜像进 blocked 层。

## 对应设计
- [architecture.md §6.8](../../../../docs/design/architecture.md)
  （地形模型与扇区流场）。
- [ADR 0010](../../../../docs/adr/0010-terrain-model-sector-flowfields.md)
  （模型）、[ADR 0027](../../../../docs/adr/0027-map-terrain-flowfield-movement.md)
  （地图/移动约定）、[ADR 0028](../../../../docs/adr/0028-rendering-camera-picking.md)
  （地形渲染）、[ADR 0050](../../../../docs/adr/0050-tactical-sandbox-rendering-and-gpu-lifecycle.md)
  （自适应 `fwidth` 网格着色器、高程/悬崖/坡道对比与资源释放）、
  [ADR 0052](../../../../docs/adr/0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)
  （两档净空与连续流场方向梯度）。
