# terrain

## 职责
解析并持有地图地形数据：地表类型、高度、坡道与动态阻挡覆盖层
（建筑等占格）。可通行性由本模块统一并入 passable / stepCost，
支持两档净空查询；覆盖层经 builder.state 序列化并镜像进 blocked
网格层。

## 公开接口
- `sim/index.ts`：`createTerrainModule(grid, surfaces)` →
  `{ module, api }`；`createTerrainApi` → `TerrainApi`。
- `TerrainApi`：通行/代价查询（可选 `tier` 净空参数）、
  `setBlocked`（仅在实际变化的格子上回调）、`onBlockedChange`
  （pathing 与 logistics 借此失效重算）。
- `protocol.ts`：三层网格层 ID 常量（height/surface/blocked）。
- `content.ts`：surface/movementClass/map schema 与 `decodeMap`。
- `rules/index.ts`：`heightStepPassable`、`spiralOffsets`、净空分档
  规则（`CLEARANCE_*`、`clearanceTierForRadius`、anchor 工具；纯
  规则，客户端共享）。
- `render/`：`terrainSceneLayers`（TerrainMesh + ScatterLayer，
  ADR 0062 场景层注册）与 `buildTerrainGeometry`。
- `ui/`：`terrainInspectorSubjects`（ADR 0062 检视器主题注册：
  cell / cell_unexplored 地形格检视）、`terrainMinimapRasters`
  （ADR 0062 小地图栅格贡献：基础地形着色）；`render/` 另导出
  `readTerrainHeights`（GameCanvas 经 app 注入的高度读取）。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- 网格层 `frontline_td:terrain.height`（u8）、
  `frontline_td:terrain.surface`（u16）、
  `frontline_td:terrain.blocked`（u8，capture_fog 系统写入）。
- 模块状态 `frontline_td:terrain.blocked_overlay`（序列化）。

## 不变量
- 8 邻居边规则：等高可通，或 |Δh|=1 且较低格为坡道；对角步要求
  两条正交腿均可通行。阻挡格对所有移动类别不可通行。
- 步进成本为整数；对角为 floorDiv(cost × 14, 10)。
- 净空两档：标准档 1×1、重型档 2×2（按半径分档）；重型要求四格
  均在界内且内部边均可通行，子步代价取最大。
- 高度与地表不可变；覆盖层可在 tick 边界修改，变化经
  `onBlockedChange` 通知失效，并在下一个 capture_fog 镜像进
  blocked 层。

## 对应设计
- [architecture.md §6.8](../../../../docs/design/architecture.md)。
- [ADR 0010](../../../../docs/adr/0010-terrain-model-sector-flowfields.md)、
  [ADR 0027](../../../../docs/adr/0027-map-terrain-flowfield-movement.md)、
  [ADR 0052](../../../../docs/adr/0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)。
