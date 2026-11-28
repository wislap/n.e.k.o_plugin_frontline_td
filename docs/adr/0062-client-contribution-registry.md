# 0062. 客户端贡献点注册：场景层、HUD 面板、检视器与小地图由功能声明、app 装配

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-24
- 决策者：wislap
- 批次：前端重构 P3
- 领域：工程
- 部分取代：0007（新增 shell-not-to-features 禁止客户端壳层引用 features/*）
- 部分取代：0048（删除 client/inspect-subject.ts 与 pick 汇总，修路工具状态拆入 features/logistics/ui/road-tool-store.ts）
- 部分取代：0049（Hud 面板改为按槽位与 order 注册装配）
- 部分取代：0060（三维拾取拆分为 client/picking.ts 与 features/selection/ui/pick-ray.ts）

## 背景

模拟层已按 ADR 0004/0007/0019 做到"功能自带组件与系统，app 装配"，客户端却没有对应机制：

- `render/GameCanvas.tsx` 逐个写死 14 个场景层，并把 `client`、`db`、`map`、`heights`、
  `mapWidth`、`mapHeight`、`isHostile` 逐层手传（宽高本可由 `map.grid` 推出）。
- `ui/Hud.tsx` 逐槽位写死各功能面板。
- `client/inspect-subject.ts`（516 行，引用 8 个功能）与 `client/minimap-model.ts`
  （561 行，引用 6 个功能）把各功能的解析逻辑汇总在 `client/`，成了事实上的第二个装配根。
- `render/input-dispatch.ts`（460 行）在渲染层组装放置、拆除、修路、移动等命令。
- 依赖规则只禁止客户端引用 `sim/`、`kernel/`、`runtime/`，未约束 `render/`、`ui/`、
  `client/` 的共享壳层引用具体功能，因此上述汇总没有被工具拦住。

结果：新增或修改一个功能通常要同时改 4–5 个中心文件，中心文件持续膨胀；玩法（ADR 0019）
也无法按模式增减客户端表现。

## 决策

1. **四类贡献点，由功能在其公共入口声明。**
   - 场景层：`SceneLayerDef { id; order; Component: ComponentType<SceneContext> }`，
     由 `features/<x>/render/index.ts` 导出。
   - HUD 面板：`HudPanelDef { id; slot: HudSlot; order; Component: ComponentType<HudContext> }`，
     由 `features/<x>/ui/index.ts` 导出。
   - 检视器：`InspectorProvider { id; resolve(input) → *Inspection | null; Sections }`，
     沿用 ADR 0048 的强类型 `*Inspection` 契约；`client/` 只保留按主体分派的调度。
   - 小地图：`MinimapContributor { id; order; collect(snapshot, ctx) → MinimapMark[] }`；
     `minimap-model` 只保留与功能无关的几何（坐标换算、视锥裁剪、底图合成）。
2. **上下文对象代替逐层手传。** `SceneContext`/`HudContext` 由壳层构造一次，包含
   `client`、`db`、`map`、`heights`、`isHostile` 等共享只读依赖；宽高从 `map.grid` 取。
3. **`app/` 是唯一装配处。** `app/` 汇总各功能的贡献点列表，玩法模块（`modes/`）可增删；
   `render/GameCanvas`、`ui/Hud`、检视器与小地图壳层只遍历注入的列表。显式列表，不用
   `import.meta.glob` 之类的隐式发现（保持静态可分析，knip/depcruise 有效）。
4. **场景层顺序用具名分段常量**（地面、结构、单位、叠加、迷雾、场景内 UI），透明层的
   绘制顺序由 `order` 决定，不依赖 JSX 书写顺序。
5. **画布输入拆分。** 射线拾取适配留在 `render/`，命令组装移到 `client/`（或对应功能的
   `ui/`），渲染层不构造命令。
6. **新增依赖规则（depcruise）。** `render/`、`ui/`、`client/` 的共享壳层不得引用
   `features/*`；只有 `app/`、`modes/` 与功能自身可以。违反时改设计，不改规则。

## 放弃的方案

- **保留中心文件，只按功能分组重排**：不减少改动面，也拦不住继续汇总。
- **自动发现（glob 导入）**：装配隐式化，静态分析与死代码检查失效，顺序不可控。
- **每个功能自带 Canvas/HUD 根**：破坏单一场景与统一布局（ADR 0028、0049）。

## 后果

- 新增功能只改功能目录与 `app/` 的一行装配；中心文件不再随功能增长。
- 玩法可以按模式增减客户端表现，与模拟层的可插拔机制对称。
- 迁移按贡献点类型分四步，每步为纯重构：`npm run shots:diff` 对基线 0% 差异、e2e 全绿。
- 依赖规则收紧后，现有违规须在迁移完成前清零；规则在最后一步启用。
