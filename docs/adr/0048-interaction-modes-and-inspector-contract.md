# 0048. 客户端交互模式、检视焦点与强类型检查器契约

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-20
- 决策者：wislap
- 批次：F1 客户端交互底座
- 领域：UI
- 部分取代：0028（按 V 切换视角改为 Tab；删除暂停自动切指挥视角，改为进入建造/物流模式自动切 2D 且可锁定视角；点选拆分为己方可控选中集合与可固定检视对象）

## 背景

[ADR 0028](0028-rendering-camera-picking.md) 确立了 M2 灰盒阶段的摄像机与拾取基础，但随着 M3–M5 功能叠加，客户端交互与状态管理出现四类结构性缺口：

1. **模式与工具状态散落**：建造模式与修路模式分散在零散字段中，缺少顶层平级一级模式与互斥二级工具的状态机约束，导致键鼠返回行为不统一。
2. **选中集合与检视焦点混为一谈**：所有可看对象都被塞进单一 `selectionStore`，使得敌方单位/建筑、废墟、记忆幽灵与地形格无法在不破坏当前己方小队选中的前提下被预览或固定查看。
3. **检查器弱类型与查询直穿 Worker**：`EntityPanel` 长期通过 `Record<string, unknown>` 硬读 `Inspection.sections` 字符串键，模拟层改名时编译期无感知；同时缺少面向观察者快照的 0ms 防泄密即时解析管线。
4. **全局变量、轮询与业务逻辑泄漏**：`cursorScreen` / `cursorGround` 裸露为模块可变变量，各面板各自维护 `setInterval` 读快照，重置清单靠手写维护，且 `input-dispatch` 混入了物流、小队与建造业务计算。

## 决策

### D1：通用层 + 平级一级模式 + 互斥二级工具（`src/client/interaction-store.ts`）

用 `useInteractionStore` 取代原有的 `build-store.ts`，将交互状态收敛为 `PrimaryMode` 与归属校验的 `SecondaryTool`：

- **通用层**：跨模式常驻输入（`WASD`/方向键平移、中键拖动与滚轮缩放、`Tab` 切视角、`Space`/`-`/`=` 控速、`F1`/`F2`/`F3` 切模式、`L` 物流覆盖层、`?`/`Shift+/` 键位速查、`` ` `` 调试面板、`Esc` 与右键分级返回）。
- **平级一级模式（`PrimaryMode`）**：`'command'`（`F1` 指挥，默认）、`'build'`（`F2` 建造）、`'logistics'`（`F3` 物流），并预留 `F4` 槽位。
- **二级工具（`SecondaryTool`）**：
  - `{ kind: 'none' }`（任意一级模式默认态）；
  - `{ kind: 'place'; structureKindId: string }` 与 `{ kind: 'demolish' }`（仅允许存在于 `'build'` 模式）；
  - `{ kind: 'road' }`（仅允许存在于 `'logistics'` 模式）。
- **切换与返回约定**：
  - 切换一级模式时，**保留**己方可控选中集合（`selectionStore`）与已固定检视目标（`inspectorStore.pinned`），自动将 `tool` 复位为 `{ kind: 'none' }` 并清理工具期临时状态（待确认窗口、建造幽灵、修路悬停/选段）。
  - 处于任一二级工具时，**右键或 `Esc` 统一退回所属一级模式**。
  - 处于一级模式时：右键在 `F1` 执行推进（`Ctrl+右键` 驻守），在 `F2`/`F3` 预留；`Esc` 先解除已固定的检视目标，若速查浮层打开则关闭之，否则留空（预留未来系统菜单）。

### D2：按模式分层的快捷键映射（`src/input/keymap.ts`）

快捷键由数据驱动的 `keymap` 统一定义并供 `?` 速查浮层同源消费，按键分发按“通用层 → 当前一级模式/二级工具”分层解析：

- 数字键 `1–9`（选中小队，双击居中）与 `Ctrl+1–9`（创建/重绑小队）**严格限定仅在 `F1 command` 模式下生效**。
- 在 `F2 build` 模式下，`1–9` 由模式 `keymap` **显式预留给建造分类抽屉的快捷跳转**（当前不硬编码具体绑定，也绝不触发 `F1` 选小队）；在 `F3 logistics` 模式下留空。

### D3：`C` / `Delete` 双形态拆除（仅 `F2 build` 一级生效）

在 `F2 build` 一级模式下，`C` / `Delete` 按当前是否选中己方目标分为两条确定路径：

1. **已有己方选中目标时**：
   - 若选中集合仅含蓝图或未完工工地，按一次 `C` 或 `Delete` 立即提交取消/拆除；
   - 若选中集合包含已建成运营建筑（拆除不可逆且仅退还 50% 材料），首次按 `C` 或 `Delete` 进入 **2.5 秒** `DemolishConfirmState`（记录 `targetKey` 与 `expiresAt`）并提示再次确认；有效期内再次按下（或点击检视器确认按钮）才提交 `CancelCommand`，超时或切换模式/选区自动取消待确认态。
2. **未选中己方目标时**：
   - 按 `C`（或点击建造栏按钮）进入 `F2` 二级工具 `{ kind: 'demolish' }`。悬停可拆己方建筑、蓝图、工地或道路段时显示警示高亮与退款预览，**左键点击立即执行拆除并保持留在 `demolish` 工具以支持连续点拆**；右键或 `Esc` 退回 `F2` 一级状态。

### D4：`Tab` 切换视角、移除暂停切视角与视角锁定（`src/client/camera-store.ts`）

- 手动切换 3D 观战（`'spectate'`）与 2D 正交战术（`'tactical'`）视角的快捷键由 `V` 改为 **`Tab`**；手动按 `Tab` 会清除 `autoSwitch` 标记。
- **删除“暂停（`Space`）时自动切指挥视角”规则**，移除无 UI 入口的 `autoTacticalOnPause` 状态与开关。
- 新增 `locked: boolean` 视角锁定状态及开关：
  - `locked === false` 时，进入 `F2 build` 或 `F3 logistics` 若当前为 `'spectate'`，自动切换为 `'tactical'` 并标记 `autoSwitch = true`（若原本已处于 `'tactical'`，则保持 `autoSwitch` 不变）；切回 `F1 command` 时，仅当当前为 `'tactical' && autoSwitch`（即期间未手动按 `Tab`）才自动恢复 `'spectate'`。
  - `locked === true` 时，切换一级模式不触发任何自动视角切换。

### D5：聚焦分离（`selectionStore` vs `inspectorStore`）与防泄密混合检视管线

将旧的单一选中模型拆分为两个正交 store：

1. **`useSelectionStore`（己方作战可控集合）**：仅存储己方实体句柄集合 `selected: ReadonlySet<EntityHandle>` 与短期移动落点 `moveMarker`，服务于 `F1` 移动/编队与 `F2` 批量开工/拆除。敌方实体与地形格永远不得进入 `selected`。
2. **`useInspectorStore`（战情检视焦点）**：持有 `{ hovered: HoverSubject | null; pinned: PinnableSubject | null }`，界面实际展示对象为 `active = pinned ?? hovered`：
   - `PinnableSubject` 覆盖全部可左键固定的实体：`own_unit`、`hostile_unit`、`own_structure`、`hostile_structure`、`ruin`、`salvage`、`road_segment`、`memory`（记忆幽灵）。
   - `HoverSubject = PinnableSubject | { kind: 'cell'; x: number; y: number }`，`cell` 在类型系统层面被限制为**仅可悬停预览、不可写入 `pinned`**。
   - 左键点击联动：点中己方实体（非加选拖拽时）同时更新 `selectionStore` 并 `pin`；点中可见敌方实体、废墟、记忆幽灵、残骸或道路段仅更新 `inspectorStore.pin`，不改动己方小队选区；点中无实体的空地/地形格时同时清空 `selectionStore` 与解除 `pinned`。
3. **混合检视数据管线（`src/client/inspect-subject.ts`）**：
   - **0ms 观察者快照即时解析**：通用信息直接由主线程最新 `Snapshot`（已在 Worker 侧完成视野裁剪）与 `ContentDb` 组装；对未探明迷雾格仅返回未探明状态，从数据源上杜绝透视迷雾外信息。
   - **按需异步深度检视**：仅当 `active` 为单个己方实体时，客户端以 **80ms 防抖**调用 `SimClient.inspect(handle)`，补充货槽明细、等待阻塞原因、生产配方进度及武器装填与修正值来源。

### 强类型检查器契约与客户端底座收拢

- **强类型 `*Inspection` 协议**：在 `features/construction/protocol.ts`、`features/logistics/protocol.ts`、`features/production/protocol.ts`、`features/combat/protocol.ts`（及按需补充的 `units`）正式导出 `ConstructionInspection`、`LogisticsInspection`、`ProductionInspection`、`CombatInspection` 等结构化接口，并在对应 `sim/` inspector 实现侧使用 `satisfies` 校验，淘汰 `Record<string, unknown>` 与字符串键盲猜。
- **光标状态与集中式会话重置**：将裸露的 `cursorScreen` / `cursorGround` 收归带受控读写与重置方法的 `cursorState`（`src/client/cursor.ts`）；新增 `src/client/session.ts` 提供 `registerSessionReset` 与 `resetClientState`，集中重置全部 client store 与 `cursorState`，取代易漏维护的 `reset.ts`。
- **共享节流快照时钟与资源速率**：新增 `src/client/use-snapshot.ts`（同一 `(client, intervalMs)` 共享单一定时器，统一 10Hz 节流订阅并清理各自面板的 `setInterval`）与纯函数 `src/client/stock-rate.ts`（基于滑窗 tick 差分计算每种货物 `milliPerSec` 净收支速率，重开局 tick 回退时自动重置历史）。
- **业务逻辑归位**：将原 `render/input-dispatch.ts` 中耦合的业务判断拆回各自功能模块（物流节点查找与路线延伸归 `features/logistics/`，小队推进/驻守拆单归 `features/squads/`，放置中心与可拆除目标筛选归 `features/construction/`），并扩展 `client/pick.ts` 支持全类别实体拾取与格子坐标反算。

## 后果

- **正交与类型安全**：模式状态机、己方指挥选区、可固定检视焦点与强类型 `*Inspection` 契约形成编译期防线，后续 F2 正式 HUD、F3 小地图与 F4 高亮圈层可直接消费而无需改写状态模型。
- **零信息泄露与低延迟**：悬停地图任意实体或地块均为 0ms 响应且天然受限于观察者视野快照，Worker 仅在单己方实体深度检视时按 80ms 防抖被查询。
- **模拟层隔离不变**：全部改动限定在客户端状态、输入路由、协议 TS 类型与 inspector 返回型别校验，对模拟步进确定性与黄金哈希无影响。
- **过渡约束**：`F1`–`F3` 与 `Tab` 依赖宿主环境允许网页拦截默认快捷键，须在真实 NEKO Electron 宿主面板内完成实测验证；如宿主拦截其中某键，可通过数据驱动 `keymap` 平滑调整。

## 相关

- [ADR 0028](0028-rendering-camera-picking.md)、[ADR 0031](0031-combat-modifiers-inspect.md)、[ADR 0044](0044-adr-implementation-field.md)
- [architecture.md](../design/architecture.md)
