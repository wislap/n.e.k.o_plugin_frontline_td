# 0063. 晴野（Field）视觉管线、8 槽位胶囊 HUD、Dolly-Zoom 镜头与客户端契约收口

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-28
- 决策者：wislap
- 批次：视觉与前端架构收口
- 领域：UI
- 部分取代：0003（新增运行时依赖 `@react-three/postprocessing`、`postprocessing`、`n8ao`）
- 部分取代：0007（新增 `ui-not-to-render`、`no-cross-feature-render`、`no-three-reachable-outside-render` 依赖门禁，并纳管 `src/dev/`）
- 部分取代：0018（补记三个后期处理依赖的许可证核查：MIT / Zlib / ISC）
- 部分取代：0028（引入后期处理库；`world.ts` 迁入 `client/`；3D 地表改用高度色阶与植被散射；3D↔2D 升级为 Dolly-Zoom 变焦过渡；右键选中小队成员走 `squads.order`）
- 部分取代：0039（删除客户端 `FogLayer` 双层实例网格，改为 `FogOfWar` 数据纹理与着色器内联 `ftdFogApply`）
- 部分取代：0042（`verify:static` 新增 `check:styles` 并与 `verify` 一并改为 `run-parallel.ts` 并发执行）
- 部分取代：0048（`PinnableSubject` 新增 `multi_own`；`C`/`Delete` 支持切换退出拆除工具且按可取消建筑/路段分流；`useSnapshot` 改为基于 `client.subscribe` 的事件驱动首尾节流合并器）
- 部分取代：0049（淘汰三模式变色切角终端，统一为晴野固定信号黄无框胶囊主题；`HudShell` 扩至 8 槽位新增右侧 `RightRail` 并重排各面板槽位；`KeyGuideRail` 默认收起）
- 部分取代：0050（建筑与单位升级为倒角 `MeshStandardMaterial` 与地基垫片/统一机器人网格；物流覆盖平面改为 `CoverUniforms` 着色器内联合成）
- 部分取代：0051（从 Y-lift 栈移除迷雾与物流覆盖网格；`RoadToolLayer` 抬至 `0.090`、`CaptureLayer` 进度弧 `0.070`；过渡近裁面放宽为 `perspectiveTransitionClipPlanes`）
- 部分取代：0060（默认观战俯仰/距离调为 `50°`/`26`；焦点高度改用预计算盒式模糊 `CameraElevationField` 与缩放门控；地形外裙改为程序化缓丘 `buildOutskirtsGeometry`；指北针迁入右侧 `RightRail`；屋顶徽章朝向实为 `+camera.rotation.y`）
- 部分取代：0062（落地契约校正：`{ ctx }` 包装属性、`ui/inspector` 的 `InspectorSubjectDef`、`ui/minimap` 的 `MinimapRasterDef`/`MinimapMarkDef`、第 5 类 `CanvasIntentHandlerDef` 与 4 段 `SCENE_ORDER`）

## 背景

在 [ADR 0048](0048-interaction-modes-and-inspector-contract.md)–[0051](0051-scene-culling-depth-precision-and-decal-stack.md)、[0060](0060-orbital-3d-camera-ray-anchored-controls-and-volume-picking.md) 与 [0062](0062-client-contribution-registry.md) 之后，客户端连续完成了视觉语言统一（晴野 PBR 昼光管线与无框胶囊 HUD）、Dolly-Zoom 视角过渡、着色器内联迷雾/覆盖合成、事件驱动快照订阅以及贡献点注册落地，同时工程门禁补齐了样式与跨层依赖检查。为保持既有 ADR 正文不可变（[ADR 0061](0061-doc-abstraction-and-tuning-records.md)），本文统一收口上述已落地机制、契约调整、依赖许可证与历史勘误。

## 决策

### 1. 晴野（Field）视觉管线、着色器内联合成与 Y-lift 栈收口

- **后期处理依赖与许可证核查**：引入 `@react-three/postprocessing@3.2.2`（MIT）、`postprocessing@6.39.6`（Zlib）与 `n8ao@2.0.2`（ISC），封装在 `src/render/theme/`（`PostEffects.tsx`、`SceneLighting.tsx`、`ThemeBackground.tsx`、`visual.ts`）。`EffectComposer` 配合 `NoToneMapping` 在线性工作空间输出；检测到真实软件光栅器（SwiftShader / llvmpipe）且非截图采集模式时自动跳过 `N8AOPostPass` 与 `Bloom`。
- **地表、外裙与植被散射**：`TerrainMesh` 采用 `MeshStandardMaterial` 注入高度色阶、悬崖斜率混色、自适应格线与 2D 弱化通道 `uInfo2D`；地图外缘改为程序化噪波缓丘 `buildOutskirtsGeometry` 衔接远景地平雾。`ScatterLayer` 按确定性整数哈希生成草簇与碎石实例，并在进入 2D 战术信息视图时随 `uInfo2D` 平滑消隐。
- **倒角 PBR 建筑、地基垫片与机器人单位**：`StructuresLayer` 采用 `RoundedBoxGeometry` 倒角复合轮廓、`createThemedStructureMaterial`（按 `aSlot` 分槽着色及表面细节贴花）与 `createPadMaterial` 石墨地基垫片；屋顶徽章与状态标牌每帧以 `+camera.rotation.y` 同步旋转。`UnitsLayer` 统一使用 `buildRobotGeometry` 倒角机器人网格与 `createThemedUnitMaterial`。
- **着色器内联迷雾与物流覆盖**：删除独立 `FogLayer` 双层实例网格，改为 `FogOfWar` 维护 `DataTexture` 与共享 `FogUniforms`，在地面/道路片段着色器中内联 `ftdFogApply`；删除 `LogisticsOverlay` 的独立服务覆盖平面网格，改为写入单字节 `RedFormat` `DataTexture` 与 `CoverUniforms`，由地形与道路着色器内联 `ftdCoverApply` 绘制。
- **Y-lift 栈与过渡裁面**：从地表 Y-lift 栈移除迷雾与物流覆盖平面；`RoadToolLayer` 抬至 `0.090`，`CaptureLayer` 底座保持 `0.060`、进度弧抬至 `0.070`。Dolly-Zoom 过渡期间透视近裁面使用 `perspectiveTransitionClipPlanes`（上限放宽至 `200`，保持低于天空球半径 `380`）。

### 2. 8 槽位胶囊 HUD、交互细节与事件驱动快照

- **单一晴野皮肤与样式门禁**：`src/ui/styles/tokens.css` 淘汰三模式变色切角终端，统一为深岩灰半透明卡片、固定信号黄（`--mode-accent: #ffe600`）、10px 面板圆角与无框胶囊/圆形按钮。`package.json` 的 `verify:static` 新增 `check:styles`（`tooling/check-styles.ts`）禁止 `*.module.css` 出现色值字面量，且 `verify:static` 与 `verify` 均改为 `tooling/run-parallel.ts` 并发调度。
- **8 槽位布局与 `RightRail`**：`HudShell` 扩展为 8 槽位，新增 `middleRight` 承载 `RightRail`（聚合视角切换、视角锁定、归北指北针、全屏、物流覆盖与快捷键开关）；`Minimap` 迁入 `topLeft`；`KeyGuideRail`（`middleLeft`）默认收起（`keymapHelpOpen = false`）。
- **交互、拆除分流与事件驱动快照**：`PinnableSubject` 新增 `{ kind: 'multi_own'; count: number }`；`F2` 建造模式下按 `C` / `Delete` 在无选中目标时可来回切换进出 `demolish` 工具，有选中时按 `classifyCancelSelection` 区分可立即取消目标与需二次确认的运营建筑/路段。`useSnapshot`（`subscribeSnapshotClock`）改为基于 `client.subscribe` 的首尾节流合并器，暂停期间零定时器、零回调。

### 3. Dolly-Zoom 镜头、焦点高程场与坐标归位

- **默认观战参数与 Dolly-Zoom 过渡**：默认观战俯角与视距调为 `50°` / `26`；3D↔2D 切换在保持 `yaw` 不变的前提下，通过 `dollyZoomFovDeg` 对 `tan(fov/2)` 线性插值并配合 `perspectiveDistAtPitch` 同步缩放视距，使透视与正交视跨平滑衔接。
- **预计算焦点高程场与小队指令**：`world.ts` 迁入 `src/client/world.ts`；3D 观战焦点 Y 由双遍盒式模糊预计算的 `CameraElevationField`（`getCameraElevationField` / `sampleCameraElevation`）经 `spectateFocusElevation` 缩放门控驱动，中远距锚定基准高度、近距贴合平滑地表。`F1` 下右键选中小队成员统一派发 `frontline_td:squads.order` 命令。

### 4. 依赖门禁与贡献点注册契约收口

- **依赖门禁补全（`dependency-cruiser.config.ts`）**：新增 `ui-not-to-render`（UI 与模式不得引用渲染层）、`no-cross-feature-render`（功能渲染层禁止跨功能直连）与 `no-three-reachable-outside-render`（禁止在渲染与装配层之外传递依赖 `three` / `@react-three`），同时将 `src/dev/` 纳入 `client-not-to-sim`（禁止引用 `sim/`/`kernel/`/`runtime/`），并将 `dev/`、`host/`、`i18n/` 一并纳入 `shell-not-to-features`（跨功能 i18n 键覆盖测试迁至 `app/i18n-keys.test.ts`）。
- **贡献点契约校正（[ADR 0062](0062-client-contribution-registry.md) 落地对齐）**：场景层与 HUD 面板组件统一接收 `{ ctx }` 包装属性（`SceneLayerProps` / `HudPanelProps`）；检视器契约在 `ui/inspector/registry.ts` 命名为 `InspectorSubjectDef`（`createInspectorPanel` 消费）；小地图贡献拆分为 `ui/minimap/contributions.ts` 中的 `MinimapRasterDef` 与 `MinimapMarkDef`；增设第 5 类画布意图处理器 `CanvasIntentHandlerDef`（`client/canvas-input.ts`）；`SCENE_ORDER` 落地为 `ground` / `entities` / `overlay` / `fog` 4 段。

### 5. 存量 ADR 历史勘误（不改旧文正文）

- **[ADR 0043](0043-review-remediation.md) 第 84 行**：文末记“契约组件清单回到 `Faction` + `InWorld` 两个”，实际 `frontend/src/kernel/contracts.ts` 中的契约组件为 `Faction`、`InWorld` 与 `UnderConstruction` 三项。
- **[ADR 0055](0055-resumable-upwind-eikonal-and-component-reachability.md) 第 52 行**：后果一节记“Dial 环形桶按格索引升序破平”，实际 `frontend/src/features/pathing/sim/eikonal.ts` 中的 `FrontierQueue` 与同文第 35 行一致，采用 FIFO 尾插（`insertOpen`）与头弹（`expandUntil`）保证同代价出队顺序。

## 后果

- 渲染视觉、HUD 布局、视角过渡与贡献点契约全部完成工程收口，相关结构约束由 `depcruise`、`eslint` 与 `check:styles` 自动守门。
- 新增的三个后期处理依赖（MIT / Zlib / ISC）均与本项目 MIT 许可证兼容，无 copyleft 传染风险。
- 全部变动限定在客户端与工程工具链，模拟层、`kernel/` 与确定性状态哈希保持零侵入。
- 通过独立勘误小节记录存量 ADR 细节偏差，维护了历史 ADR 正文不可变原则（[ADR 0001](0001-adr-process-and-docs.md)、[ADR 0061](0061-doc-abstraction-and-tuning-records.md)）。

## 相关

- [ADR 0001](0001-adr-process-and-docs.md)、[ADR 0003](0003-tech-stack.md)、[ADR 0007](0007-feature-first-layout-dependency-rules.md)、[ADR 0018](0018-licenses.md)、[ADR 0028](0028-rendering-camera-picking.md)、[ADR 0039](0039-vision-fog-of-war.md)、[ADR 0042](0042-verification-segmentation-parallel-ci.md)、[ADR 0043](0043-review-remediation.md)、[ADR 0048](0048-interaction-modes-and-inspector-contract.md)、[ADR 0049](0049-hud-design-system-and-layout.md)、[ADR 0050](0050-tactical-sandbox-rendering-and-gpu-lifecycle.md)、[ADR 0051](0051-scene-culling-depth-precision-and-decal-stack.md)、[ADR 0055](0055-resumable-upwind-eikonal-and-component-reachability.md)、[ADR 0060](0060-orbital-3d-camera-ray-anchored-controls-and-volume-picking.md)、[ADR 0061](0061-doc-abstraction-and-tuning-records.md)、[ADR 0062](0062-client-contribution-registry.md)
- [architecture.md](../design/architecture.md)
