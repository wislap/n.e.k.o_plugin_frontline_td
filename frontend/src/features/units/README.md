# units

## 职责
单位种类定义（内容 schema）与单位 sim：开局按确定性方形螺旋
在可通行格生成，逐 tick 输出密集单位快照通道。

## 公开接口
- `content.ts`：`unitSchema`、`UnitContent`（speed 装载时换算为
  格/tick；`vision` 视野半径；`visual { shape, scale }` 渲染参数，
  渲染层统一合批绘制机器人轮廓，按 `scale` 缩放）。
- `sim/index.ts`：`createUnitsModule(db, terrain, starts, unitParts?,
  readouts?)`；`DenseUnitsChannel`；`StartUnit`/`FactionStart`/
  `DenseUnits`；组件 `UnitKind`。
- `protocol.ts`：`SpawnIntent`/`UnitsSpawned`——生产等模块经意图
  出怪，负载自带 faction/kind/x/y/source（出口位置由调用方算，
  非本模块内建）；`units.spawn` 在 `capture_fog` 阶段结算并同 tick
  发出 `UnitsSpawned`，实体经 `flushStructural` 于下一 tick 进入查询。
- `render/`：`unitsSceneLayers`（`UnitsLayer` 使用统一程序化机器人几何体
  `buildRobotGeometry` 与 `MeshStandardMaterial` 主题材质合批渲染，
  附单位 HP 条；ADR 0062 / ADR 0063）。阵营配色在 `render/faction-colors`，
  跨特征位置插值器在 `client/interpolate`（selection 拾取与高亮共用
  `DenseUnitsChannel`）。
- `ui/`：`unitsInspectorSubjects`（ADR 0062 检视器主题注册：
  own_unit / hostile_unit / multi_own）、`unitsMinimapMarks`
  （ADR 0062 小地图标记贡献：单位色块与选中描边）。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `UnitKind { kind: u16 }`（内容索引；spawn 烘入，归属本模块、
  无字段写者，ADR 0047）。Position/Velocity/Mover 归 movement。

## 不变量
- 开局与运行期 `units.spawn` 按净空档螺旋找足迹：标准档占单格、重型档
  校验四格均通行且未占用；运行期同 tick 在 `capture_fog` 发出
  `UnitsSpawned`，实体经 `flushStructural` 于下一 tick 查询可见。
- 密集通道按实体 id 升序输出、数组等长；接受注入的
  `VisibilityQuery`（己方恒见，他阵营按所在格可见，ADR 0039）。
- `onStart` 放不下全部请求数量视为配置错误，直接抛错；运行期
  无可通行空格则跳过该次产出，不重试。

## 对应设计
- [architecture.md §4](../../../../docs/design/architecture.md#4-诉求)、
  [architecture.md §6](../../../../docs/design/architecture.md#6-架构)。
- [ADR 0022](../../../../docs/adr/0022-match-setup-content-ids-packs.md)、
  [ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)、
  [ADR 0047](../../../../docs/adr/0047-component-ownership-manifest.md)、
  [ADR 0052](../../../../docs/adr/0052-terrain-clearance-tiers-and-smooth-flow-gradients.md)、
  [ADR 0062](../../../../docs/adr/0062-client-contribution-registry.md)、
  [ADR 0063](../../../../docs/adr/0063-field-visual-pipeline-hud-and-camera-evolution.md)。
