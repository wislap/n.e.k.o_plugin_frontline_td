# units

## 职责
单位种类定义（内容 schema）与单位 sim：开局状态按确定性方形螺旋
在可通行格生成，逐 tick 输出密集单位快照通道。

## 公开接口
- `content.ts`: `unitSchema`、`UnitContent`（speed 为格/秒，装载时换算为
  格/tick）。
- `sim/index.ts`: `createUnitsModule(db, terrain, starts)`；
  `DenseUnitsChannel`（`frontline_td:units.dense`）；
  `StartUnit` / `FactionStart` / `DenseUnits`；组件 `UnitKind`。

## 拥有的组件
- `UnitKind { kind: u16 }`（内容索引）。Position/Velocity/Mover 归
  movement 所有。

## 不变量
- 开局单位按方形螺旋顺序放置，一格一个，只落在可通行且未占用的格。
- 密集通道按实体 id 升序输出，数组等长；M2 阶段全部可见（迷雾在 M5）。
- 放不下全部请求数量视为配置错误，直接抛错。

## 对应设计章节
architecture.md §4/§6、ADR 0022。
