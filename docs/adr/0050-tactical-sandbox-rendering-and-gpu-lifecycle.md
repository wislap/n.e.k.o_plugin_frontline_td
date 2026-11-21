# 0050. 电子沙盘程序化建筑渲染、战术圈层反馈与 WebGL 资源生命周期

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-20
- 决策者：wislap
- 批次：F4 电子沙盘渲染与 GPU 治理
- 领域：UI

## 背景

[ADR 0028](0028-rendering-camera-picking.md) 与 M3–M5 灰盒渲染层虽然跑通了单场景双视角切换、实例化建筑/单位绘制与基础物流覆盖层，但随着 [ADR 0048](0048-interaction-modes-and-inspector-contract.md) 与 [ADR 0049](0049-hud-design-system-and-layout.md) 将交互模式与战术 HUD 升级为正式前端，沙盘画面仍存在五类信息可读性与 GPU 治理缺口：

1. **建筑轮廓同质化与俯视辨识度不足**：所有建筑均以单一 `<boxGeometry>` 配合阵营色绘制，2D 正交战术视角下仅靠尺寸与颜色难以区分主基地、车站、补给站、矿机、电厂、弹药厂、炮塔、机器人工厂与前哨站，同时缺少外部零资源约束下的屋顶战术图标（`architecture.md §5` 禁止运行时下载资源）。
2. **工地待机阻塞与单位续航状态不直观**：`StructuresLayer` 原以同一套半透明材质混绘 `STATE_BLUEPRINT` 与 `STATE_WAITING`（只要场上存在任意蓝图/等待建筑即全局同步脉冲），无法区分“刚下单规划中”与“因阻塞/缺料停滞等待”；同时 `UnitsLayer` 尚未把 [ADR 0025](0025-logistics-model.md) 的单位电池低电/耗尽状态直接投射为战场视觉标牌。
3. **选中/悬停空间语义缺失与节点预览半残**：玩家选中或悬停单位、炮塔与物流节点时，地面缺少统一的战术角标框、武器射程圈及物流连接/服务范围圈；`GhostPreview` 仅绘制了连接距离圈与预测虚线，尚未按 [ADR 0025 §可读性](0025-logistics-model.md#可读性) 要求同时展示服务距离圈与程序化建筑轮廓。
4. **地形高程与网格读格精度不足**：2D 战术视图下的逐格浅棋盘格在拉远或 3D 斜视时容易产生锯齿与混叠，且高地层级、悬崖立面与坡道斜面的明暗层次尚不足以在快速扫图时一眼判别可通行性。
5. **覆盖层容量硬上限、热循环分配与 WebGL 显存泄漏**：`LogisticsOverlay` 为每个服务覆盖格实例化一块 `planeGeometry`（受 `COVER_CAP = 8192` 硬上限限制），`HpBars.useFrame` 每帧为每个受伤实体 `new THREE.Vector3()`，且各渲染层缺少统一完整的 `.dispose()` 生命周期清理，在重开局或能力扩容重建时持续累积 GPU 几何体、材质与纹理对象。

## 决策

### 1. `visual.silhouette` / `visual.glyph` 内容字段与程序化网格 / 离线屋顶图标

在严守“零外部模型/纹理资产、纯程序化离线生成、不进入模拟状态与确定性哈希”的前提下，将建筑外观元数据纳入内容管线：

- **内容 Schema 与解析（`src/features/construction/content.ts`、`src/content/resolve-structures.ts`、`src/content/frontline_td/structures.ts`）**：
  - 导出 `STRUCTURE_SILHOUETTES`（11 种：`block`、`hq_citadel`、`rail_hub`、`twin_depot`、`octagon_fort`、`drill_rig`、`reactor_pair`、`foundry_press`、`turret_mount`、`gantry_bay`、`bio_spire`）与 `STRUCTURE_GLYPHS`（`none` 及 10 种激活图标：`core_star`、`relay_arrows`、`supply_cross`、`fort_shield`、`drill_tri`、`power_bolt`、`ammo_diamond`、`reticle`、`gantry_bot`、`bio_hazard`）。
  - 在 `structureBaseFields.visual` 中以 `s.optional(...)` 声明 `silhouette` 与 `glyph`，保证既有 `{ visual: { height: 1 } }` 测试夹具继续合法；`resolveStructures` 将缺省值解析为 `'block'` 与 `'none'`。同时修正 `ResolvedNodeProfile` 过时注释（明确 `connect` 为 `cells × 10` 代价单位、`service` 单位为 `cells`），并为本体包全部 10 种建筑标注专属轮廓与屋顶图标。
- **纯函数多部件复合几何体（`src/features/construction/render/structure-geometries.ts`）**：
  - `buildSilhouetteGeometryData(silhouette)` 为每种轮廓构造包络在 `x, z ∈ [-0.5, 0.5]`、底面锚定 `y = 0`、顶高 `y <= 1.0` 的外法线逆时针（CCW）复合网格，附带中性灰度顶点色（`0.60..1.15`，基座偏暗、塔冠偏亮），使 `MeshLambertMaterial({ vertexColors: true })` 能与 `instanceColor` 阵营色直接相乘叠影。
  - 导出 `createSilhouetteGeometries()` 与 `disposeSilhouetteGeometries()`，供 `StructuresLayer` 与 `GhostPreview` 共享复用并集中释放（`MemoryLayer` 继续保留轻量化暗色方盒迷雾残影）。
- **离线 `CanvasTexture` 屋顶战术图标（`src/features/construction/render/structure-glyphs.ts`）**：
  - 导出 `ACTIVE_STRUCTURE_GLYPHS`、`createGlyphMaterials()` 与 `disposeGlyphMaterials()`，在初始化阶段通过浏览器 Canvas 2D API 离屏绘制 `64×64` 八角暗底徽章（`rgba(6, 10, 18, 0.78)` + 细外框线 + 高对比 `#ffffff` 矢量符号），生成 `CanvasTexture` 与 `MeshBasicMaterial({ map, transparent: true, opacity: 0.88, depthWrite: false })` 贴于建筑顶部，兼顾 2D 俯视辨识度与 100% 离线打包约束。

### 2. 建筑建造态/等待态视觉分离与单位电量指示标牌

- **分离 `STATE_BLUEPRINT` 与 `STATE_WAITING`（`StructuresLayer`）**：
  - 将蓝图拆分为独立渲染通路：`STATE_BLUEPRINT` 保持稳定半透明青蓝/阵营底色，清晰传达“已下单待施工”；`STATE_WAITING`（因禁建区/阻挡或调度阻塞未能开工）使用独立预警脉冲材质与警示色频闪，避免因单个等待工地导致全场正常蓝图同步闪烁。
- **单位电量低/空视觉指示标牌（`UnitsLayer`）**：
  - 读取单位快照中的能源存量状态分档（低电量 / 空电量），在低电或耗尽单位上方/侧方渲染高辨识度电量指示 pip（琥珀低电警示与红色断电标牌），让 [ADR 0025](0025-logistics-model.md) 的小队续航半径与减速/停机状态在战场直接可见。

### 3. `SelectionHighlightLayer` 战术圈层反馈与 `GhostPreview` 双圈补全

- **新增 `SelectionHighlightLayer`**：
  - 消费 `useSelectionStore` 与 `useInspectorStore`（区分 `hovered` 预览与 `pinned` 固定目标，遵守 [ADR 0048](0048-interaction-modes-and-inspector-contract.md)），为当前焦点实体在地面绘制统一风格的电子沙盘反馈：
    1. **地面四角 L 形战术框（L-brackets）**：按建筑 `footprint` 或单位半径贴地包络目标，清晰标示当前选中/检视边界。
    2. **武器射程圈（Weapon Range Ring）**：对挂载 `weapon` 的单位或炮塔按 `weapon.range` 绘出射程圆环。
    3. **物流连接与服务双圈（Connect / Service Circles）**：对挂载 `node` 的物流节点分别按 `node.connect / 10`（格）与 `node.service`（格）绘出连接范围与末端服务范围，使拓扑覆盖边界在检视时一目了然。
- **补全 `GhostPreview`（履行 [ADR 0025 §可读性](0025-logistics-model.md#可读性)）**：
  - 放置物流节点预览时，**同时绘制连接距离圈（含范围内己方运行节点的预测虚线连线）与服务距离圈**，并以目标建筑自身的 `silhouette` 几何体替代单纯方盒作为放置幽灵。

### 4. 自适应地形网格着色器与高程/悬崖/坡道明暗层次

- **地形网格与着色增强（`TerrainMesh` / `geometry.ts`）**：
  - 在地形材质中接入自适应地面网格着色器（基于屏幕空间导数 `fwidth` 的抗锯齿格线），在 3D 远近缩放与 2D 正交视角下动态平滑格线粗细并避免 Moiré 伪影，替代高对比硬切棋盘格。
  - 结合网格高程层级差、暗化垂直悬崖立面（cliff shading）与坡道斜面法线光照（ramp shading），在无额外贴图资源的情况下突出高台、隘口与可通行斜坡的立体层次。

### 5. `LogisticsOverlay` `DataTexture`、零分配 `HpBars` 与全层 `.dispose()` GPU 治理

- **`LogisticsOverlay` 服务覆盖层改为 `DataTexture`**：
  - 将原逐格实例化 `COVER_CAP` 平面块的渲染方式替换为一张覆盖全图尺寸（`width × height`）的 `THREE.DataTexture` 单一叠加平面，逐帧/按变更将观察者阵营的 `service` 图层写入像素缓冲并置 `needsUpdate = true`。此举彻底解除 8192 格数量上限、支持任意大地图服务覆盖显示，并将数千次矩阵更新收敛为单次纹理上传。
- **零热循环分配 `HpBars`**：
  - 在 `HpBars` 的 `useFrame` 热路径中移除每帧 `new THREE.Vector3()` 与临时数组 `.filter()` 分配，改用组件实例级复用的预分配 `THREE.Vector3` 与计数循环，消除渲染帧间 GC 抖动。
- **统一 WebGL 资源 `.dispose()` 生命周期治理**：
  - 建立各渲染层的显式 GPU 资源释放约定：组件卸载以及 `InstancedMesh` 容量翻倍重建前，必须对所有自建 `BufferGeometry`、`Material`、`CanvasTexture`、`DataTexture` 与 `LineBuffer` 调用 `.dispose()`，确保反复开局、切换玩法或窗口重建时显存占用保持有界。

## 后果

- **战术信息密度与离线合规兼得**：在不引入任何外部 3D 模型、字体或图标纹理的前提下，通过 11 种程序化轮廓、10 种 `CanvasTexture` 屋顶徽章、双态蓝图区分、单位电量 pip、地面战术圈层与自适应网格着色器，全面提升 2D 指挥与 3D 观战下的战场可读性。
- **履行跨文档未结设计承诺**：补齐 [ADR 0025 §可读性](0025-logistics-model.md#可读性) 中“节点放置预览同时显示连接距离与服务距离”的最后一项客户端表现要求，并将该视觉规则完整对齐到 [ADR 0048](0048-interaction-modes-and-inspector-contract.md) 的聚焦分离模型。
- **显存与帧率稳定性提升**：`DataTexture` 覆盖层与零分配 `HpBars` 降低了大地图与高频战斗下的 CPU/GPU 开销；`.dispose()` 生命周期约束消除了长期运行中的 WebGL 资源泄漏隐患。
- **模拟层零侵入**：全部内容字段均位于 `visual` 表现槽位，几何、纹理、高亮与着色器逻辑严格隔离在 `render/` 与 `features/*/render/` 之内，不触及 `sim/`、`kernel/` 与确定性状态哈希。

## 相关

- [ADR 0025](0025-logistics-model.md)、[ADR 0028](0028-rendering-camera-picking.md)、[ADR 0048](0048-interaction-modes-and-inspector-contract.md)、[ADR 0049](0049-hud-design-system-and-layout.md)
- [architecture.md](../design/architecture.md)
