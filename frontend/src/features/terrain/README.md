# terrain

## 职责
解析并持有地图地形数据：地表类型、高度、坡道。M2 中地形为静态，
在 onStart 时把高度与地表写入两个全局网格层供客户端渲染与其他模块读取。

## 公开接口
- `sim/index.ts`: `createTerrainModule(grid, surfaces)` → `{ module, api }`；
  `createTerrainApi(grid, surfaces)` → `TerrainApi`（纯只读查询）。
- `content.ts`: `surfaceSchema`、`movementClassSchema`、`mapSchema`、
  `decodeMap`、`TerrainGrid`、`SurfaceContent`、`MapContent`、`MovementClassContent`。
- `rules/index.ts`: `heightStepPassable`（边规则，客户端渲染共享）。

## 拥有的组件
- 网格层 `frontline_td:terrain.height`（u8，全局）。
- 网格层 `frontline_td:terrain.surface`（u16，全局）。

## 不变量
- 8 邻居边规则：两格均可通行且高度相等，或 |Δh|=1 且较低一格为坡道；
  对角步还要求两条正交腿均可通行（禁止切角）。
- 步进成本为整数：正交 = 目标格成本，对角 = floorDiv(cost × 14, 10)。
- 地形在 M2 内不可变；层数据只在 onStart 写一次。

## 对应设计章节
architecture.md §6（地形模型与扇区流场）、ADR 0010、ADR 0015。
