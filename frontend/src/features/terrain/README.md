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
  pathing 与 logistics 借此失效重算）。
- `protocol.ts`：三层网格层 ID 常量（height/surface/blocked）。
- `content.ts`: `surfaceSchema`、`movementClassSchema`、`mapSchema`、
  `decodeMap`、`TerrainGrid`、`SurfaceContent`、`MapContent`、
  `MovementClassContent`。
- `rules/index.ts`: `heightStepPassable`、`spiralOffsets`（纯规则，
  客户端共享）。
- `render/`：`TerrainMesh`/`buildTerrainGeometry`（贴合高度的地形
  网格，vision 的 `FogLayer` 复用同一几何）。导出全表见
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
- 高度与地表不可变；阻挡覆盖层可在任意 tick 边界修改，
  变化通过 onBlockedChange 通知 pathing 与 logistics 失效重算，并在
  下一个 capture_fog 阶段镜像进 blocked 层。

## 对应设计
- [architecture.md §6.8](../../../../docs/design/architecture.md)
  （地形模型与扇区流场）。
- [ADR 0010](../../../../docs/adr/0010-terrain-model-sector-flowfields.md)
  （模型）、[ADR 0027](../../../../docs/adr/0027-map-terrain-flowfield-movement.md)
  （地图/移动约定）、[ADR 0028](../../../../docs/adr/0028-rendering-camera-picking.md)
  （地形渲染）。
