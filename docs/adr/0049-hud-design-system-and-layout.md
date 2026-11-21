# 0049. 近未来战术 HUD 设计系统、九宫格布局与建造分类字段

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-20
- 决策者：wislap
- 批次：F2 战术 HUD 主体
- 领域：UI
- 部分取代：0048（快捷键速查由居中浮层改为左中常驻可折叠快捷键引导栏并以 K 键开关、Esc 不再关闭引导栏；战术检视面板移至右下角，左下角承载一级模式栏并预留小地图槽位）

## 背景

[ADR 0048](0048-interaction-modes-and-inspector-contract.md) 建立了 F1 阶段的一级模式/二级工具状态机、`selectionStore` / `inspectorStore` 焦点分离与强类型 `*Inspection` 契约，但界面层仍停留在 M2–M5 遗留的灰盒状态：

1. **硬编码坐标与面板互盖**：所有面板使用 `position: fixed` 与内联 `monospace` 样式，在常规操作或 NEKO `normal` 窄窗下，`EntityPanel` 与 `SquadPanel`、`DebugPanel` 与 `StockPanel`、敌军预警与命令提示直接文字重叠，且 Worker 报错被藏在默认展开的调试面板中。
2. **缺少统一视觉语言与基础原语**：无集中式色彩/字体/间距 Token，每个面板重复手写原生白底按钮、边框与数字样式，后续维护和 F3/F4 扩展成本高。
3. **快捷键可见性与空间分配失衡**：仅靠玩家记忆或居中弹窗不利于边操作边参照；检视面板详情在建造/物流与复杂实体上纵深较长，与左下角未来小地图及模式切换栏同槽竞争高度，而右下角长期空置。
4. **建造栏缺少功能分组**：所有可建造建筑平铺展示，随着建筑种类扩充不利于快速筛选与未来 F2 数字键分类跳转。

## 决策

### 1. 零外部依赖离线样式系统（`src/ui/styles/`）

确立“**星际开荒公司 · 前线战术遥测终端**”视觉风格，全部样式基于 Vite 原生 CSS Custom Properties 与 CSS Modules（`*.module.css`），**严禁引入任何外部字体 CDN 或第三方 UI / 图标库**，确保 100% 离线运行与包体受控：

- **`tokens.css`**：定义黑曜石/深钢灰毛玻璃表面（`--surface-panel`、`--surface-elevated`、`--surface-ghost`）、细钢框线（`--border-subtle`、`--border-strong`）、语义色（`--semantic-danger`、`--semantic-warn`、`--semantic-ok`）、离线工业字体栈与 `tabular-nums` 等宽数值规范。
- **模式联动主题色**：`HudShell` 在根节点绑定 `data-mode="command" | "build" | "logistics"`，驱动 `--mode-accent` 在冰川蓝（`#5cc8ff`）、工程琥珀（`#ffaa33`）、遥测薄荷（`#3ddc97`）之间平滑过渡，同步点亮面板 2px 顶边指示条、激活按钮边框与微弱遥测光晕。
- **`base.css`**：统一 `#root` 全屏无滚动条、禁用误选文本、暗色细滚动条与 `:focus-visible` 焦点轮廓。

### 2. 无业务原语组件库（`src/ui/kit/`）

抽离 7 个无业务依赖的基础 UI 原语并通过 `src/ui/kit/index.ts` 统一导出，原语自身不导入任何 store、`features/` 业务逻辑或 `sim/` 模块，全部文本均由调用方经 `i18next` 传入：

- `TacticalPanel`：毛玻璃底、2px 语义/模式顶边指示条、微切角或角标准星、斜纹微底纹标题栏与关闭槽位。
- `ActionButton`：支持 `default` / `primary` / `ghost` / `danger` / `active` 变体、`sm` / `md` 尺寸与内嵌 `<Kbd>` 键帽角标。
- `Kbd`：统一等宽快捷键微徽章。
- `SegmentedTabs`：带 `tablist` / `tab` 语义的分段切换器（时间倍速、建造分类标签等）。
- `MeterBar`：基于 `0..10000` 基点的平滑血量/建造进度/电量/占领拉锯条。
- `RateBadge`：渲染 `milliPerSec` 净收支速率（带正负号、涨跌箭头着色与 `tabular-nums`）。
- `ToastStack`：左上方流式提示栈，将 Worker 致命错误置顶常驻高优高亮，并向下排开命令拒绝与状态通知。

### 3. 九宫格流式 `HudShell` 与已锁定槽位布局

废弃全屏散落的 `position: fixed` 硬编码坐标，改由 `HudShell` 统一声明响应式九宫格流式容器，同槽位内多块卡片纵向自动排开，中间战场保持通透：

- **`topLeft`（左上）**：时间控制（暂停/倍速）、视角胶囊（`3D/2D Tab`、`📌 锁定视角`、全屏切换），以及流式下挂的 `ToastStack`（Worker 报错不再藏进调试面板）。
- **`topCenter`（顶中）**：敌军集结倒计时预警横幅，以及按需出现的二级工具提示 / `C` 拆除 2.5s 待确认 / 放置幽灵状态胶囊。
- **`topRight`（右上）**：中央仓库 `StockPanel`（内置 `stock-rate.ts` 每秒净速率 `RateBadge` 与缺货诊断建议），下方流式挂载 `DebugPanel`（**默认关闭 `debugPanelOpen = false`**，按 `` ` `` 开关，展开时自然向下排列而不遮挡仓库库存）。
- **`middleLeft`（左中）**：**`KeyGuideRail`（常驻可折叠快捷键引导栏）**——**默认展开（`keymapHelpOpen = true`）**，按一排纵列优先置顶展示当前一级模式快捷键，再列全局通用快捷键，数据源与 `input/keymap.ts` 同源；通过 **`K`**（`KeyK`，保留 `?` 键盘别名）或点击边栏按钮收起/展开，**`Esc` 不再关闭快捷键引导栏**（仅用于退出二级工具或解除固定检视）。
- **`bottomLeft`（左下）**：一级模式切换栏（`F1 指挥` / `F2 建造` / `F3 物流` + `[L]` 物流覆盖层开关），并在模式栏正上方保留 F3 战略小地图 `Minimap` 的专属插槽。
- **`bottomCenter`（底中）**：模式上下文工作台——`SquadBar` 严格仅在 `F1 指挥` 模式下渲染在工作台上方；进入 `F2 建造` 自动隐藏小队条并展开按分类筛选的建造台；进入 `F3 物流` 展开修路与配额工具台。
- **`bottomRight`（右下）**：**`InspectorPanel`（战情检视面板）**——从左下迁至右下，以虚线“预览”与实线高亮“📌 已固定”区分 Hover 与 Pin 态，支持己方/敌方单位与建筑、废墟占领拉锯、记忆幽灵、地形格纯 Hover 预览、多选汇总与 `[G 开工]` / `[C 拆除（含待确认）]` 操作，并与左下模式栏及预留小地图互不争夺垂直空间。
- **`EndScreen`**：同步接入设计系统 Token 与原语美化胜负结算遮罩。

### 4. `build.category` 建造分类内容字段

在 `src/features/construction/content.ts` 正式导出建造分类元数据，作为表现层/菜单筛选字段，**不进入模拟状态与确定性哈希**：

- 导出 `BUILD_CATEGORIES = ['logistics', 'production', 'military'] as const` 与 `type BuildCategory`。
- 在 `buildProfileSchema` 新增可选 `category: s.optional(s.enumOf(BUILD_CATEGORIES))`，在 `src/content/resolve-structures.ts` 的 `ResolvedBuild` 解析为非空 `category`（未显式标注时缺省为 `'production'`）。
- 在 `src/content/frontline_td/structures.ts` 为全部可建造建筑标注分类：`station`、`supply_depot` 归为 `'logistics'`；`miner`、`power_plant`、`ammo_factory` 归为 `'production'`；`turret`、`robot_factory` 归为 `'military'`。

## 后果

- **零遮挡与多尺寸适配**：所有 HUD 面板通过 `HudShell` 流式排布、同槽位自动堆叠且 `DebugPanel` 默认收起，彻底消除固定坐标互盖，并适配 NEKO `normal` 窄窗与 `focus` / `fullscreen` 模式。
- **单向视觉与业务解耦**：`src/ui/kit/` 与 `tokens.css` 不含业务耦合；`HudShell` 保持在 `src/app/` 或 `src/ui/` 显式插槽装配，遵守 `architecture.md §7.3` 不过度引入插件容器。
- **为 F3 小地图与 F2 数字分类跳转铺路**：`bottomLeft` 已稳定留出小地图位置，`build.category` 已与 `BUILD_CATEGORIES` 对齐，后续 F3 `Minimap` 与 `F2` 数字键分类跳转可直接接入而无需重构布局或内容 schema。
- **消除长文件债务**：原 `EntityPanel.tsx`（664 行）拆分为模块化 `InspectorPanel` 后，消除了 F1 阶段遗留的 `ratchet` 600 行黄线预警。

## 相关

- [ADR 0023](0023-grid-layers-groups-commands-rng-runtime-limits.md)、[ADR 0048](0048-interaction-modes-and-inspector-contract.md)
- [architecture.md](../design/architecture.md)
