# 0051. 全图批次视锥裁剪契约、动态深度窗口与地表贴花层级

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-21
- 决策者：wislap
- 批次：R1 场景视锥裁剪与深度精度治理
- 领域：UI
- 部分取代：0050（屋顶战术图标升级为 128×128 各向异性过滤加 polygonOffset；全图动态 InstancedMesh 与 LineSegments 强制显式声明 frustumCulled 并由 ESLint 守门）

## 背景

在 [ADR 0028](0028-rendering-camera-picking.md) 与 [ADR 0050](0050-tactical-sandbox-rendering-and-gpu-lifecycle.md) 落地后，实际在 2D 正交战术视角与 3D 观战视角之间切换、缩放或平移镜头时，沙盘出现批次级闪烁消失、远距斜视重影/Z-fighting 以及屋顶战术徽章模糊的问题。经排查，根因集中在三处：

1. **动态批次冻结第 1 帧包围球导致视锥裁剪误杀**：Three.js 的 `InstancedMesh` 与 `LineSegments` 默认开启 `frustumCulled = true`，且 R3F 挂载首帧构建的 `boundingSphere` 不会随每帧 `setMatrixAt` 或动态顶点缓冲改写自动重算——初始化时 `count = 0` 的批次包围球永久冻结在原点（`radius = -1`），运动单位簇则冻结在首帧出生点；当镜头缩放或平移离开原点/出生点区域后，整批实例或线段会被对象级视锥测试整批剔除，表现为“平白消失或闪烁弹入/弹出”。
2. **固定裁剪窗口浪费 24-bit 深度缓冲精度且存在大地图裁切风险**：`CameraRig` 原硬编码固定 `near = 0.1`、`far = 500`。在常规观战视距 `dist = 80..145` 下，`far / near = 5000` 使绝大多数 24-bit 深度精度消耗在眼前 `[0.1, 1]` 的空气区间，同时对于对角线或视距超过 500 格的大地图存在远裁剪面误裁风险。
3. **地表贴花 Y-lift 层序交叉与低分辨率屋顶图标失真**：既有地表层高度偏移存在倒挂与挤压（如单位选区环 `0.02` 低于道路层 `0.03`），导致斜视或远距下发生 Z-fighting 闪烁；同时 `64×64` 默认采样滤波的屋顶战术徽章在远距/斜角透视下容易糊化或与屋顶共面闪烁。

## 决策

### 1. 全图动态批次显式关闭对象级视锥裁剪并由 ESLint 守门

- **全图动态批次统一声明 `frustumCulled={false}`**：所有全图覆盖或每帧更新实例矩阵/顶点缓冲的 `<instancedMesh>` 与 `<lineSegments>`（含全图地形 `TerrainMesh`、动态 `Sprite` 与 `Line` 渲染层）必须显式声明 `frustumCulled={false}`，禁止依赖默认 `frustumCulled = true` 的首帧包围球。
- **ESLint 静态门禁（`renderCullingBlock`）**：在 `frontend/tooling/eslint-rules.ts` 新增并导出 `renderCullingBlock`（接入 `frontend/eslint.config.ts`，覆盖非测试的 `src/**/*.tsx`），通过 `no-restricted-syntax` 强制所有 `<instancedMesh>` 与 `<lineSegments>` JSX 元素必须显式带有 `frustumCulled` 属性，从工具链层杜绝后续新增批次遗漏声明。
- 本项决策正式收口 [`architecture.md`](../design/architecture.md) §1.4 中“铺满全图的图层是否关闭视锥裁剪”工程遗留项。

### 2. 动态相机深度窗口（`perspectiveClipPlanes` / `orthoClipPlanes`）

在 `frontend/src/client/camera-math.ts` 中新增纯函数计算并由 `CameraRig` 驱动动态裁剪面，在保证不裁切地图与近处建筑的前提下最大化 24-bit 深度缓冲分辨率：

- **透视视角（`perspectiveClipPlanes(dist, mapWidth, mapHeight)`）**：
  - `safeDist = Math.max(SPECTATE_MIN_DIST, dist)`
  - `near = Math.max(0.8, Math.min(8, safeDist * 0.12))`
  - `diag = Math.hypot(Math.max(1, mapWidth), Math.max(1, mapHeight))`
  - `far = Math.max(500, safeDist + diag + 120)`
  - `CameraRig` 通过 `syncPerspClip` 在模式过渡动画分支（使用当帧插值 `dist`）与常规 `spectate` 观战分支同步更新 `persp.near / persp.far`，仅当变化量超过 `1e-3` 时调用 `updateProjectionMatrix()`。
- **正交战术视角（`orthoClipPlanes(cameraY)`）**：
  - `near = 1`、`far = Math.max(300, cameraY + 80)`，`CameraRig` 在 `tactical` 分支于 `ortho.updateProjectionMatrix()` 前写入。

### 3. 地表贴花严格分层 Y-lift 栈

统一全场景地表叠加层的垂直偏移顺序（单位：格），消除任何跨层重叠与 Z-fighting：

| 层级 | Y-lift | 对应渲染内容 |
|---|---|---|
| 0 | `0.000` | 地形基底（`TerrainMesh`） |
| 1 | `0.030` | 道路网格层 |
| 2 | `0.038` | 物流服务覆盖层（`LogisticsOverlay`） |
| 3 | `0.045` | 战争迷雾层 |
| 4 | `0.050–0.052` | 修路 / 物流连线与节点连接/服务环 |
| 5 | `0.055` | 单位选中圈 |
| 6 | `0.058–0.062` | 占领进度圈（`0.060`）/ 建造幽灵环与连线（`0.058–0.062`） |
| 7 | `0.065` | 移动指令落点圈 |
| 8 | `0.070` | 禁建区标识与选中/悬停高亮 L 形角标框 |

屋顶战术徽章锚定于建筑实体满高之上 `full + 0.06`，与建筑顶面保持稳定分离。

### 4. `128×128` 高清屋顶战术图标纹理与采样参数

部分取代 [ADR 0050 §1](0050-tactical-sandbox-rendering-and-gpu-lifecycle.md#1-visualsilhouette--visualglyph-内容字段与程序化网格--离线屋顶图标) 的 `64×64` 默认材质设定：

- 离线 `CanvasTexture` 分辨率提升至 `128×128`。
- 采样与过滤统一配置为 `anisotropy = 4`、`minFilter = LinearMipmapLinearFilter`、`magFilter = LinearFilter`，保留斜视视角下的边缘清晰度并抑制缩远闪烁。
- 徽章材质启用 `polygonOffset`（`polygonOffsetFactor = -2`、`polygonOffsetUnits = -2`），彻底避免斜角深度精度波动导致的屋顶穿插。

## 后果

- **彻底消除缩放/平移批次弹出与闪烁**：全图动态 `InstancedMesh` / `LineSegments` 不再受首帧包围球误裁剪影响，且新代码由 ESLint `renderCullingBlock` 自动守门。
- **深度精度显著改善且兼容大地图**：观战模式下 `far / near` 比值由固定 `5000` 收紧至约 `60..625` 区间，正交模式下收紧至 `300`，显著降低远景共面闪烁风险，同时在超大地图下自动外扩 `far`。
- **贴花与屋顶图标层次清晰稳定**：严格单调递增的 `0.000..0.070` 地表 Y-lift 栈与 `128×128` 各向异性过滤 + `polygonOffset(-2, -2)` 屋顶徽章保证了远近斜俯全角度的可读性。
- **纯渲染与数学契约**：全部变更严格隔离在客户端相机数学、渲染层与 ESLint 工具链中，零触及 `sim/`、`kernel/` 与确定性状态哈希。

## 相关

- [ADR 0028](0028-rendering-camera-picking.md)、[ADR 0050](0050-tactical-sandbox-rendering-and-gpu-lifecycle.md)
- [architecture.md](../design/architecture.md)
