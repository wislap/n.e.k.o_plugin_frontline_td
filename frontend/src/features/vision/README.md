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
- `sim/index.ts`：`createVisionModule` 返回 `VisionLayer`（含
  `VisionApi` 的 `visible`/`visibleRect`；全知阵营恒真）；
  `unitVisionParts`/`structureVisionParts` 部件工厂（结构无
  Position，工厂直接烘入占地中心；工地也会挂 `Vision`，只是
  `vision.recompute` 运行时跳过带 `UnderConstruction` 的实体；
  废墟、蓝图不挂视野）。
- `rules/` 纯函数：`isCellVisible`、`hostileExcluders`
  （客户端共享：弹道、建造幽灵、禁建区覆盖）。
- `ui/`：`visionInspectorSubjects`（ADR 0062 检视器主题注册：
  memory 迷雾记忆幽灵）。
- `render/`：`visionSceneLayers`（ADR 0062 场景层：FogOfWar——
  无网格：把 vision.state 层逐格上传到 RGBA
  `DataTexture` 绿色通道，并按相机模式驱动共享 `FogUniforms`；
  地面材质经 `render/shaders.ts` 的 `ftdFogApply` 在编码后混合迷雾）、
  `MemoryLayer`（记忆结构暗框）。导出全表见
  [exports.md](../../../../docs/generated/exports.md) 与
  [contracts.md](../../../../docs/generated/contracts.md)。

## 拥有的组件
- `Vision { radius, x, y }`（视野源；spawn 烘入，归属本模块、
  无字段写者，ADR 0047）。
- `vision.state` 网格层（按阵营）。
- 序列化状态键 `frontline_td:vision`；全知开关来自
  `MatchSetup.factions[i].vision`（如 `omniscient`，导演阵营用）。

## 不变量
- 每 5 tick 在 `capture_fog` 阶段重算：先把 2 降为 1，再按每个
  视野源盖整数圆盘为 2；视野源位置取组件快照时的坐标。
- `vision.memory` 只记录"见过且当前不可见"的非己方结构；重新可见后
  由 structures 通道承担实况，记忆行不重复。
- 全知阵营（`MatchSetup.factions[i].vision`，如导演）`visible` 恒真。
- 已知限制：事件可见性仍为 `all`，隐藏格内的效果只在客户端过滤
  （非反作弊保证）。

## 对应设计
- [ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)（迷雾模型、
  记忆与过滤）；[ADR 0040](../../../../docs/adr/0040-entity-id-reuse-component-reads.md)
  （实体 ID 复用下的句柄校验）。
