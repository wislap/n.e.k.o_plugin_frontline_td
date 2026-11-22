# 0060. 全 3D 自由轨道沙盘镜头、射线锚定操控与三维实体拾取

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-21
- 决策者：wislap
- 批次：R2 全 3D 自由轨道镜头与三维交互
- 领域：UI
- 部分取代：0028（观战镜头由固定正南 55° 升级为无奇点全向 3D 轨道阻尼镜头，支持自由旋转、智能俯角与一键归北；拖拽平移与滚轮缩放升级为三维平面射线精确锚定；点选升级为三维实体包围体优先拾取）
- 部分取代：0048（补充 Q/E 连续旋转、Alt+左键与中键轨道旋转、Shift+中键抓地平移及 N/Home 归北快捷键）

## 背景

在 [ADR 0028](0028-rendering-camera-picking.md)、[ADR 0050](0050-tactical-sandbox-rendering-and-gpu-lifecycle.md) 与 [ADR 0051](0051-scene-culling-depth-precision-and-decal-stack.md) 完成沙盘三维渲染与 HUD 重构后，地形、悬崖与建筑silhouette均已具备全向 3D 几何体，但摄像机与客户端交互仍停留在“正南朝北、固定 55° 俯角”的半 2.5D 模式，存在六类手感瓶颈：

1. **无水平旋转与自由俯仰**：镜头写死 `CAMERA_UP = (0, 0, -1)` 与 `55°` 固定俯角，无法绕战线观察高低差与建筑背面，且一旦加入水平航向 `yaw` 在高俯角附近会发生侧倾退化。
2. **`WASD` 与鼠标平移未随视角解耦**：屏幕平移写死叠加地图南北坐标；中键拖动采用屏幕常数像素比例，斜视透视下近快远慢、角度旋转后操作错乱。
3. **焦点高程写死海平面**：`lookAt(center.x, 0, center.y)` 在观察高地时导致旋转支点下沉到地面以下。
4. **低俯角点击穿顶与框选背面投影**：低俯角点选建筑或单位上身时地面射线穿透打到身后地块，且框选投影缺少 `ndc.z` 前向深度裁剪。
5. **屋顶图标倒立与迷向风险**：屋顶战术徽章不随镜头朝向旋转；小地图视框为轴对齐矩形，无法反映倾斜梯形视锥与观察朝向；缺少归北锚点。
6. **低俯角地图边缘露底**：纯平面边界缺乏底座厚度与背向补光。

## 决策

### 1. 无奇点 3D 轨道阻尼底座（`camera-math.ts` / `camera-store.ts` / `CameraRig.tsx`）

- **四自由度镜头状态**：`useCameraStore` 在既有 `(mode, center, zoom)` 之上新增水平航向 `yaw`（弧度，`0` 面向正北 `-Z`，顺时针为正）与手动俯角偏置 `pitchOffsetDeg`，提供 `orbitBy` 与 `resetOrientation`。
- **智能景深俯角联动与防卷绕**：`baseSpectatePitchDeg(dist)` 随视距在近距 `34°`（`dist = 8`）→ 默认 `55°`（`dist = 30`）→ 远览 `72°`（`dist = 80`）间以 `easeInOut` 平滑过渡；叠加 `pitchOffsetDeg` 后整体钳制在 `[26°, 86°]`，并由 `clampPitchOffsetForDist` 实时消除边界空转累积（wind-up）。`matchZoomForMode` 对任意自定义 `pitchOffsetDeg` 采用 36 次二分保持 3D/2D 切换地面视跨严格一致。
- **零奇点 `'YXZ'` 姿态与焦点贴地**：`orbitalCameraPose` 以 `(yaw, pitchDeg)` 解析构造正交基与 Euler `'YXZ'`（`x = -pitch, y = -yaw, z = 0`），彻底替代易在 `90°` 奇异的固定 `up` `lookAt`；`CameraRig` 在每帧指数阻尼平滑 `center`、`centerY = terrainY(...)`、`yaw`、`dist`、`pitchDeg` 与 `orthoHeight`。
- **保持航向切换 2D/3D**：`Tab` 或 `F2`/`F3` 自动切换 2D 正交视图时保留当前 `yaw` 平滑拍平（零突然打转晕眩），同时在建造/物流视图也能在任意旋转角下作业。

### 2. 零冲突操控与 1:1 射线锚定平移/缩放（`input/` / `dispatch.ts` / `input-dispatch.ts`）

- **不扰乱右键战斗指令**：`中键拖拽` 与 `Alt + 左键拖拽` 驱动自由旋转/俯仰（`camera.orbit_px`）；连续按住 **`Q` / `E`** 经 `PanTracker` 连续旋转 `yaw`；**`Shift + 中键拖拽`**（及 `Shift + Alt + 左键拖拽`）触发抓地平移（`camera.pan_start` + `camera.pan_px`）；**`N` / `Home`** 沿最短圆弧归正北并重置俯角偏置（`nearestNorthYaw`）。右键全程专用于移动/驻守与退出二级工具。
- **沿视觉朝向平移与 1:1 地面射线抓取**：`WASD` / 方向键通过 `rotatePanVector(pan, yaw)` 实时对齐当前屏幕朝向；抓地平移在按下时锁定光标下方 `panPlaneY`，拖动中通过精确水平面射线求交（`intersectHorizontalPlane`）逐像素追平地面偏移；滚轮缩放借助 `spectateCursorGroundOffset` 精确锚定光标射线下的三维地面点。

### 3. 三维包围体优先拾取与前向框选裁剪（`client/pick-ray.ts` / `input-dispatch.ts`）

- 点选与悬停检视由 `pickSubjectByRay` / `pickDemolishableByRay` 对可见单位包围柱（Cylinder）与建筑/工地/蓝图/废墟包围盒（AABB）执行射线求交，使用地形交点距离 `maxT = dGround + 0.35` 实现近山崖对远方实体的天然遮挡；未命中三维实体时回落到既有高度场 `pickSubjectAt` / `pickDemolishableAt`（保留道路段、残骸、记忆幽灵与地形格拾取）。
- `select.box` 增加 `v.z ∈ [-1, 1]` 前向裁剪，彻底杜绝极低俯角下摄像机背后单位的反向投影误选。

### 4. 立体沙盘表现、旋转梯形视锥与 HUD 指北针（`TerrainMesh` / `StructuresLayer` / `Minimap` / `TopLeftPod`）

- **沙盘底座裙边与背光**：在 `terrain/render/geometry.ts` 新增 `buildTerrainSkirtGeometry`，为地图四边生成向下的深岩青色台座立面，并在 `GameCanvas` 增设北西向冷色轮廓补光，确保 360° 全向俯视质感统一。
- **屋顶图标随镜头正立**：`StructuresLayer` 每帧以 `-camera.rotation.y` 同步旋转屋顶徽章实例，并根据俯角在 `[0.45, 0.72]` 区间平滑调整 `spectate` 透明度；其余轮廓与蓝图/待工体块显式复位旋转。
- **小地图旋转梯形视锥、高分抗锯齿与 HUD 指北针**：`computeMinimapFrustumQuad` 对 `3D` 观战视锥将俯角平滑映射至 `[48°, 90°]` 以避免极低俯角远端向地平线无限发散，在 `2D` 正交下绘制旋转矩形；`paintMinimapCanvas` 以 `devicePixelRatio` 同步物理像素缓冲、去除 CSS `image-rendering: pixelated` 的二次最近邻重采样撕裂（仅地形底图通过 `imageSmoothingEnabled = false` 一次性像素清晰绘制），并以 `clipPolygonToRect`（Sutherland-Hodgman 四边裁剪）与统一圆角双层描边保证跨图边界视框始终闭合流畅；左上角 `TopLeftPod` 新增随 `-yaw` 实时旋转的紧凑指北针按钮（点击触发 `camera.reset_orientation`）。

## 后果

- **全向沉浸与战术效率兼得**：玩家可在指挥或锁定视角建造时自由旋转 360°、拉近压低俯角贴近战线观战，亦可随时一键归北或切回纯正交俯视。
- **低俯角操纵零漂移、零穿顶**：1:1 射线抓地平移、光标锚定缩放与三维包围体拾取让斜视角点选高塔、框选部队与近距拖屏保持像素级稳定。
- **纯客户端零模拟侵入**：所有逻辑严守 `src/client/`、`src/input/`、`src/ui/` 与 `src/render/` 边界，`sim/`、`kernel/`、协议契约及黄金状态哈希保持零改动。

## 相关

- [ADR 0028](0028-rendering-camera-picking.md)、[ADR 0048](0048-interaction-modes-and-inspector-contract.md)、[ADR 0050](0050-tactical-sandbox-rendering-and-gpu-lifecycle.md)、[ADR 0051](0051-scene-culling-depth-precision-and-decal-stack.md)
- [architecture.md](../design/architecture.md)
