# selection

## 职责
客户端侧的跨实体拾取、选择与高亮（ADR 0062）：把游标屏幕坐标解析
成检视主体（己方/敌方单位、结构、废墟、道路段、废料、迷雾记忆、
地形格），维护点选与框选语义，并把选中/悬停/钉选/拆除确认/射程圈
画成 LineSegments 覆盖层。纯客户端功能，没有 sim——状态都在
`client/` 的 selection/inspector/interaction store 里。

## 公开接口
- `ui/index.ts`：`selectionCanvasIntents`——`cursor.move`（悬停 +
  道路/拆除工具悬停，经 logistics/construction 的公开拾取器）、
  `select.click`、`select.box` 画布意图处理器。内部 `pick.ts` /
  `pick-ray.ts` 提供地面点与 3D 射线两级拾取（射线先打单位圆柱/
  结构 AABB，miss 后回落地面点；射线数学在 `client/picking`）。
- `render/index.ts`：`selectionSceneLayers`（高亮覆盖层，挂载在全部
  功能层之后）；`collectSelectionHighlights` 为纯收集函数，测试直接
  验证迷雾安全与射程圈半径。

## 拥有的组件
无——纯客户端功能，不注册 sim 组件。

## 不变量
- 拾取优先级：近距单位（平局己方优先）→ 结构/废墟 → 道路段/废料
  → 迷雾记忆 → 地形格；射线拾取在地面命中点之后截断，近处地形遮挡
  远处实体。
- 高亮不泄露未探索内容：cell 悬停框只在可见/已探索格上出现。

## 对应设计
- [ADR 0048](../../../../docs/adr/0048-interaction-modes-and-inspector-contract.md)（交互模式与
  检视契约）、[ADR 0062](../../../../docs/adr/0062-client-contribution-registry.md)（客户端贡献点注册）。
