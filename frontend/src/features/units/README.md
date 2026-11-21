# units

## 职责
单位种类定义（内容 schema）与单位 sim：开局状态按确定性方形螺旋
在可通行格生成，逐 tick 输出密集单位快照通道。

## 公开接口
- `content.ts`: `unitSchema`、`UnitContent`（speed 为格/秒，装载时换算为
  格/tick）；`vision` 视野半径（默认 6）；`visual { shape, scale }`
  渲染参数（cylinder|cone|box|sphere，默认 cylinder ×1，渲染层按
  shape 索引取实例网格，不按内容 ID 分支）。
- `sim/index.ts`: `createUnitsModule(db, terrain, starts, unitParts?,
  readouts?)`；`DenseUnitsChannel`（`frontline_td:units.dense`）；
  `StartUnit` / `FactionStart` / `DenseUnits`；组件 `UnitKind`。
- `protocol.ts`：`SpawnIntent` / `UnitsSpawned`——生产等模块经意图
  出怪，负载自带 faction/kind/x/y/source；生成点由意图指定
  （"结构下缘中心"是 production 侧计算的出口位置，不是本模块内建
  逻辑），运行时找不到可通行空格则静默跳过该次产出，`onStart`
  期放不下全部请求数量视为配置错误直接抛错。
- `render/`：`UnitsLayer`（按 shape 的实例网格；支持 `lowThresholdBp` 低电/空电
  视觉指示 pip 与底盘变暗/着色，及卸载 `.dispose()`）、`factionColorHex`。
  导出全表见 [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `UnitKind { kind: u16 }`（内容索引；spawn 烘入，归属本模块、
  无字段写者，ADR 0047）。Position/Velocity/Mover 归 movement 所有。

## 不变量
- 开局与运行期 spawn 按方形螺旋顺序查找足迹：`tier = 0`（`r ≤ 0.45`）占 `1×1`
  单格、生成于 `(x + 0.5, y + 0.5)`；`tier = 1`（`r > 0.45`）按 `size × size = 2×2`
  校验 `terrain.passable(x, y, cls, tier)` 且四格均未占用、生成于
  `clearanceAnchorCenter`（ADR 0052 / ADR 0053）。
- 密集通道按实体 id 升序输出，数组等长；接受注入的
  `VisibilityQuery`（迷雾：己方恒见，他阵营按所在格可见，
  ADR 0039）。
- `onStart` 放不下全部请求数量视为配置错误，直接抛错；运行期
  spawn 意图无可通行空格时跳过本次产出，不重试。

## 对应设计
- [architecture.md §4/§6](../../../../docs/design/architecture.md)。
- [ADR 0022](../../../../docs/adr/0022-match-setup-content-ids-packs.md)
  （内容 ID）、[ADR 0028](../../../../docs/adr/0028-rendering-camera-picking.md)
  （渲染实例）、[ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)
  （通道过滤）、[ADR 0050](../../../../docs/adr/0050-tactical-sandbox-rendering-and-gpu-lifecycle.md)
  （低/空电量视觉指示标牌、底盘暗化与 GPU 资源生命周期）、
  [ADR 0052](../../../../docs/adr/0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)
  （两档地形净空）、[ADR 0053](../../../../docs/adr/0053-damped-asymmetric-avoidance-arrival-hysteresis-and-wall-margins.md)
  （重型足迹出兵占格）。
