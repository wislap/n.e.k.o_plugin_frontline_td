# pathing

## 职责
基于扇区流场（sector flowfield，ADR 0010）为各移动类别提供寻路：
扇区边界提取门户（portal）、扇区内边表、目标距离查询与按扇区惰性
计算的流向场。M2 仅为寻路服务，不做单位移动。

## 公开接口
`sim/index.ts`:
- `createPathingModule(terrain: TerrainApi, classCount)` → `{ module, api }`
- `PathingApi`：`acquireGoal(x, y, cls)` / `releaseGoal(id)` /
  `goalRefCount(id)` / `directionAt(goalId, x, y)` / `invalidateCells(cells)`
- `Direction`、`SECTOR_SIZE`、`UNREACHABLE`、`dijkstra`

## 拥有的组件
- 无实体组件、无网格层。目标表（id → cell/class/refcount）通过
  `builder.state` 序列化；门户图与流场缓存为派生数据，不序列化。

## 不变量
- 扇区边长固定 16 格；门户是边界上最大可通行邻格对连续段，取中段对。
- 成本全部为整数；Dijkstra 堆键为 (cost, index)，保证确定性；
  `dijkstra` 接受可选 `maxCost` 上界，超出即停止展开。
- 方向选择只考虑可通行的步（stepCost >= 0），按固定邻序
  N,E,S,W,NE,SE,SW,NW 取「邻格距离 + 步进成本」最小者。
- `directionAt` 返回内部复用的 scratch 对象，调用方不得长期持有。
- `invalidateCells` 重算受影响扇区及其 4 邻居的门户与边表，并清空
  所有派生缓存；接线时经 `terrain.onBlockedChange` 注册，阻挡变化
  自动失效重算。
- 状态载入时（restore）会重建全部类别的图与节点索引并清空缓存——
  因为地形阻挡覆盖层先于 pathing 载入（sim-registry 中 terrain 必须
  排在 pathing 之前）。

## 对应设计章节
architecture.md §6（扇区流场）、ADR 0010。
