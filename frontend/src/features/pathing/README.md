# pathing

## 职责
为各移动类别与净空分档提供寻路：按 `(cls, tier)` 槽位懒惰烘焙格子通行性、
连通分量 O(1) 可达性、按目标增量展开的距离/流向场（Eikonal），以及连续方向与
距离查询；同时保留 `dijkstra` 供物流图路由复用。单位移动结算在 movement，
本模块只提供查询。

## 公开接口
`sim/index.ts`:
- `createPathingModule(terrain, classCount)` → `{ module, api }`
- `PathingApi`：`acquireGoal` / `releaseGoal` / `goalRefCount` /
  `reachable` / `distanceAt` / `directionAt` / `smoothDirectionAt` /
  `invalidateCells`
- `DIR_ORDER`（固定邻序）、`UNREACHABLE`、`dijkstra`（供 logistics 图路由复用）
- 导出全表见 [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- 无实体组件、无网格层。目标表（id → cell/class/tier/refcount）经
  `builder.state` 序列化，状态键 `frontline_td:pathing.goals`；
  `tier = 0` 省略字段保持存档兼容。网格缓存、连通分量与距离场为派生数据，
  不序列化。

## 不变量
- 代价与队列为整数定点，Eikonal 更新只用确定性的 `Math.sqrt`；展开顺序固定
  （起点 + `DIR_ORDER`），保证确定性。
- `reachable` 只查连通分量，不展开距离场；`directionAt` /
  `smoothDirectionAt` 返回内部复用 scratch，调用方不得长期持有。
- 距离场与队列池化并随释放/失效回收；热路径零堆分配。
- `invalidateCells` 回收全部 Eikonal 距离场（按需重展）、重置受影响格的烘焙
  标志，并将连通分量标记为 `compValid = false` 懒惰失效（下次可达性查询时按需
  重算）；接线时经 `terrain.onBlockedChange` 自动触发。
- 状态载入时重置全部派生数据——地形覆盖层必须先于 pathing 载入
  （sim-registry 顺序）。

## 对应设计
- [architecture.md §6.8](../../../../docs/design/architecture.md#68-地形模型)
  （流场与净空分档）。
- [ADR 0010](../../../../docs/adr/0010-terrain-model-sector-flowfields.md)、
  [ADR 0052](../../../../docs/adr/0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)、
  [ADR 0055](../../../../docs/adr/0055-resumable-upwind-eikonal-and-component-reachability.md)、
  [ADR 0059](../../../../docs/adr/0059-damped-aperture-locomotion-mixed-cohesion-and-surround-arcs.md)。
