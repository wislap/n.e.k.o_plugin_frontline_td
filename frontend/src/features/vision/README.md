# vision

## 职责
按阵营维护战争迷雾：视野源盖章出 `vision.state` 层（0 未见 / 1 记忆 /
2 可见），并把不在当前视野内的非己方结构记入 `vision.memory` 通道。
过滤一律走注入的 `VisibilityQuery`，本模块不进入被过滤的功能模块。

## 公开接口
- `content.ts`：单位与结构上的 `vision` 视野半径（格，默认 6 / 4）；
  `visionLandmark` 把结构在首个视野 tick 种入所有阵营的记忆
  （outpost、hive）。
- `protocol.ts`：`VISION_STATE_LAYER_ID`（`frontline_td:vision.state`
  按阵营分层）与 `VisionMemoryChannel`（`frontline_td:vision.memory`：
  记住的非己方结构，6 列：handles、kind、x、y、faction、state——
  废墟 faction 记 0；不含 structures 通道的 progressBp/hpBp）。
- `sim/index.ts`：`createVisionModule` 返回 `{ module, api: VisionApi }`
  （`visible`/`visibleRect`，全知阵营恒真）；`VisionLayer` 为独立
  `defineGridLayer` 导出；`unitVisionParts`/`structureVisionParts`
  部件工厂（结构虽经 `structureParts` 带有 `Position`，
  `structureVisionParts` 仍直接将 `{ radius, x, y }` 烘入 `Vision`；
  工地也会挂 `Vision`，但 `vision.recompute` 运行时跳过
  `UnderConstruction`；废墟、蓝图不挂视野）。
- `rules/` 纯函数：`isCellVisible`、`hostileExcluders`
  （客户端共享：弹道、建造幽灵、禁建区覆盖）。
- `ui/`：`visionInspectorSubjects`（ADR 0062 检视器主题注册：
  memory 迷雾记忆幽灵）、`visionMinimapRasters`/`visionMinimapMarks`
  （ADR 0062 小地图贡献：迷雾栅格、记忆幽灵标记）。
- `render/`：`visionSceneLayers`（ADR 0062 / ADR 0063 场景层：
  `FogOfWar` 把 `vision.state` 上传到 RGBA `DataTexture` 绿色通道并
  同步共享 `FogUniforms`，地面材质经 `render/shaders.ts` 的
  `ftdFogApply` 混合迷雾；`MemoryLayer` 绘制记忆结构暗框）。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Vision { radius, x, y }`（视野源；spawn 烘入，归属本模块、
  无字段写者，ADR 0047）。
- `vision.state` 网格层（按阵营）。
- 序列化状态键 `frontline_td:vision`；全知开关来自
  `MatchSetup.factions[i].vision`（如 `omniscient`，导演阵营用）。

## 不变量
- 按固定重算周期在 `capture_fog` 阶段刷新：先把上次当前可见格降级为
  已探索记忆格，再按活跃视野源盖出整数圆盘可见域；视野源位置优先取
  `Position` 快照坐标，缺 `Position` 时回退到 `Vision` 烘入坐标。
- 首个视野 tick 将带 `visionLandmark` 的结构（outpost / hive）在
  未目击前即种入各阵营 `vision.memory`；当被记忆占地重新进入当前
  视野时，先经句柄校验实体是否仍为存活结构，失效则逐出记忆，存活则由
  structures 通道承担实况、`vision.memory` 不重复输出。
- 渲染迷雾混合由 `ftdFogApply` 在 `EffectPass` 后处理之前的 Linear
  工作空间执行，并按相机 Dolly-Zoom 补偿距离雾效。
- 全知阵营（`MatchSetup.factions[i].vision`，如导演）`visible` 恒真。
- 已知限制：事件可见性仍为 `all`，隐藏格内的效果只在客户端过滤
  （非反作弊保证）。

## 对应设计
- [ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)（迷雾模型、
  记忆与过滤）、
  [ADR 0040](../../../../docs/adr/0040-entity-id-reuse-component-reads.md)
  （实体 ID 复用下的句柄校验）、
  [ADR 0047](../../../../docs/adr/0047-component-ownership-manifest.md)
  （组件归属清单）、
  [ADR 0062](../../../../docs/adr/0062-client-contribution-registry.md)
  （客户端贡献点注册）、
  [ADR 0063](../../../../docs/adr/0063-field-visual-pipeline-hud-and-camera-evolution.md)
  （Linear 迷雾管线与镜头演进）。
