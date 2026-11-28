# selection

## 职责
客户端侧的跨实体拾取、选择与高亮（ADR 0062）：把游标屏幕坐标解析
成检视主体（己方/敌方单位、结构、废墟、道路段、废料、迷雾记忆、
地形格），维护点选与框选语义，并把选中/悬停/钉选/拆除确认/范围环
画成角标线框与虚线圆环覆盖层（ADR 0063）。纯客户端功能，没有 sim——
状态都在 `client/` 的 selection/inspector/interaction store 里。

## 公开接口
- `ui/index.ts`：`selectionCanvasIntents`——`cursor.move`（悬停 +
  道路/拆除工具悬停，经 logistics/construction 的公开拾取器）、
  `cursor.leave`（清空地面坐标与悬停）、`select.click`、`select.box`
  画布意图处理器。内部 `pick-ray.ts` / `pick.ts` 提供两级拾取：
  `pickSubjectByRay` 先沿 3D 射线测试单位圆柱与结构/废墟 AABB，
  未命中再回落到 `pickSubjectAt` 地面点拾取（射线数学在 `client/picking`）。
- `render/index.ts`：仅导出 `selectionSceneLayers`
  （`SelectionHighlightLayer`，挂载在全部功能层之后，以 L 型角标
  `LineBuffer` 与 `DashRingMaterial` `InstancedMesh` 绘制选中/悬停/
  钉选/拆除确认及武器/服务/连接范围环）。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
无——纯客户端功能，不注册 sim 组件。

## 不变量
- 3D 体积射线拾取（`pickSubjectByRay`）在地面遮挡距离内按最近射线命中
  在单位与结构/废墟间抉择；未命中体素时回落 2D 地面拾取
  （`pickSubjectAt`），优先级固定为：单位（平局己方优先）→ 结构/废墟
  → 道路段/废料 → 迷雾记忆 → 地形格。
- 高亮不泄露未探索内容：cell 悬停框只在可见/已探索格上出现。

## 对应设计
- [ADR 0048](../../../../docs/adr/0048-interaction-modes-and-inspector-contract.md)（交互模式与
  检视契约）、
  [ADR 0060](../../../../docs/adr/0060-orbital-3d-camera-ray-anchored-controls-and-volume-picking.md)（3D 射线体积拾取）、
  [ADR 0062](../../../../docs/adr/0062-client-contribution-registry.md)（客户端贡献点注册）、
  [ADR 0063](../../../../docs/adr/0063-field-visual-pipeline-hud-and-camera-evolution.md)（高亮管线与镜头演进）。
