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
  pathing 借此挂 invalidateCells）。
- `content.ts`: `surfaceSchema`、`movementClassSchema`、`mapSchema`、
  `decodeMap`、`TerrainGrid`、`SurfaceContent`、`MapContent`、`MovementClassContent`。
- `rules/index.ts`: `heightStepPassable`、`spiralOffsets`（纯规则，客户端共享）。

## 拥有的组件
- 网格层 `frontline_td:terrain.height`（u8，全局）。
- 网格层 `frontline_td:terrain.surface`（u16，全局）。
- 网格层 `frontline_td:terrain.blocked`（u8，全局；capture_fog 系统按需写入）。
- 模块状态 `frontline_td:terrain.blocked_overlay`（覆盖层字节，序列化）。

## 不变量
- 8 邻居边规则：两格均可通行且高度相等，或 |Δh|=1 且较低一格为坡道；
  对角步还要求两条正交腿均可通行（禁止切角）。被阻挡的格子对所有
  移动类别不可通行，进出该格的边与对角腿一律拒绝。
- 步进成本为整数：正交 = 目标格成本，对角 = floorDiv(cost × 14, 10)。
- 高度与地表不可变；阻挡覆盖层可在任意 tick 边界修改，
  变化通过 onBlockedChange 通知 pathing 失效重算，并在下一个
  capture_fog 阶段镜像进 blocked 层。

## 对应设计
architecture.md §6（地形模型与扇区流场）、ADR 0010、ADR 0015。
