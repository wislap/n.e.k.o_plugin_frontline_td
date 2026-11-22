# AGENTS.md — frontline_td 开发守则

适用于本仓库的所有贡献者：人和 AI agent。动手之前先读完本文件。

## 项目是什么
- NEKO 插件。插件系统只负责启动；游戏本体是 `frontend/` 下的网页游戏，构建产物在 `static/`，由 static 面板加载。
- Python（`__init__.py`）只是薄壳，不写游戏逻辑。
- 玩法设计：[docs/design/game_design.md](docs/design/game_design.md)。架构总览：[docs/design/architecture.md](docs/design/architecture.md)。具体决策以 [docs/adr/](docs/adr/) 为准，索引见 [docs/generated/adr-index.md](docs/generated/adr-index.md)。

## 动手前的阅读顺序
1. 本文件。
2. 要改的功能的 `frontend/src/features/<x>/README.md`。
3. `docs/generated/` 下的相关索引：`contracts.md`（模拟契约：系统、组件写者、事件 / 意图 / 命令、通道）、`exports.md`（各功能公共导出）先确认有没有现成的组件、事件、接口可以复用。
4. 需要理解"为什么"时，按 ADR 索引查对应的 ADR；引用决策前先看头部的「实现」行（已实现/部分/未实现，ADR 0044）。

## 协作与决策
- 项目负责人（`wislap`）决定：玩法与产品取舍（名称、品类、范围、做不做某个系统）、数值平衡、架构级改动（写 ADR）、里程碑验收。agent 在已有 ADR 和设计的范围内决定实现细节。
- 代码现状不等于产品决定：没实现不代表放弃（如 Rogue），数值没调可能是有意不调（architecture.md §13）。不要从代码推断负责人的意图，拿不准就问。
- `game_design.md` 不是不可动摇的需求（见其开头「本文的地位」）：【建议】【待定】先确认再做；对【已定】有异议时带证据提出。
- 需要负责人定的事：给出选项、各自的代价和你的倾向，一次问完。负责人可以推迟决定，没定的事不要先做。
- 有证据就可以反对，包括反对负责人、外部评审和本仓库的文档；同意也要基于核实，不附和。
- 只做任务要求的改动，顺手发现的问题列出来汇报，不顺手改。新增模块、改模块边界或公共接口前，先简述方案。
- 每个里程碑做完停下评审，通过后再开始下一个。下一步候选见 [architecture.md §1.4](docs/design/architecture.md#14-下一步候选)，开工前确认优先级。
- 处理外部评审：先确认它基于哪个提交；逐条在当前代码里核实，分成"已修 / 属实 / 不实 / 需负责人定"；属实的每条配回归测试；黄金哈希变化逐条说明原因；结论沉淀为 ADR（如 0043、0045）。
- 交付时如实报告跑了哪些检查、结果如何。Playwright `e2e/` 覆盖冒烟与 HUD/模式/小地图/防重叠交互；迷雾视觉观感、"再来一局"、多局重开 WebGL 显存等仍列为人工验证项（Human Gate），不写成"已验证"。交付前通读一遍自己的 diff。

## 分层与依赖（工具强制，见 ADR 0007）
- 模拟层（`core/`、`kernel/`、`features/*/sim/`、`features/*/rules/`）是无头游戏核心，只通过命令、快照、事件与外界交互（ADR 0004）。
- `features/*/render/`、`features/*/ui/`、`modes/*/ui/`、`client/`、`input/` 等客户端层 **禁止 import 任何 `sim/`、`kernel/`、`runtime/`**。需要共享的纯规则放在 `features/*/rules/`。
- 跨功能引用只能走对方的 `index.ts`，不能深入引用内部文件。禁止循环依赖。只有 `app/` 可以装配全部模块。
- 玩法专属代码放在 `modes/<mode>/`，只有 `app/` 可以引用它。通用模块不感知玩法，禁止按玩法 ID 写特判（ADR 0019）。
- 违反依赖规则时修改设计，不要修改规则。规则本身的改动属于架构级改动，必须先写 ADR。

## 模拟层硬性规则（ADR 0006、0008）
以下前两条由 lint 强制，作用于纯度区：`core/`、`kernel/`、`content/`、`protocol/`、`features/*/sim/`、`features/*/rules/`、`features/*/content.ts`、`features/*/protocol.ts`、`modes/*/`（`ui/` 除外）。
- 禁止 `Math.random`、`Date`、`performance`、DOM 全局对象。随机数只用 `core` 提供的带种子 RNG 流。
- 禁止直接调用超越函数（`Math.sin`、`cos`、`tan`、`atan2`、`exp`、`log`、`pow` 等），一律用 `core` 的确定性数学。
- 不依赖帧时间。每个 tick 推进固定的 50ms 模拟时间。
- 时间用整数 tick；资源、血量、伤害等数量用千分单位整数，舍入只用 `core` 的整数运算；只有几何量用浮点（ADR 0020）。
- 延迟效果走 kernel 调度队列，冷却用 `readyAtTick` 字段，不自写计时器（ADR 0021）。
- 组件视图在每次系统运行时从 kernel 获取，不跨 tick 保存（存储会扩容，ADR 0020）。
- 创建、删除实体和增删组件在 tick 末统一生效，新实体从下一个 tick 起才出现在查询里（ADR 0026）。
- 可开关的机制写成独立的组件 + 系统，由玩法决定注册，不在系统里按玩法写分支；通用规则对各阵营对称（ADR 0019）。
- 新增 RNG 流要在 `app/` 中登记用途（ADR 0023）。
- 内容 ID 和所有注册表键用 `包ID:名字`；已发布的 ID 不改名。存档不写数字索引是目标而非现状（ADR 0022，实现：部分）：当前组件字段保存 u16 内容索引，存档与内容版本绑定。
- 跨 tick 只保存实体句柄（ID + 代数），使用前先校验有效性。
- 按 id 读组件数组前先 `ctx.has` 该组件（或用保证含有的查询）：id 会被回收，"id 有效"不等于"该 id 有此组件"（ADR 0040）。
- 属于某一方的状态（资源、解锁、迷雾、物流网）一律按阵营 ID 存储，不写全局"玩家状态"。AI 只能通过命令行动（ADR 0019）。
- 实现 `save`/`load` 的控制者不得把可变状态留在它们之外（ADR 0036）。AI 与系统代码请求单位移动时提交移动意图，不写 `MoveTarget`（ADR 0034）。
- 每个组件只有所属模块能写：模块安装时用 `claimWriter` 认领，写入时出示认领凭证。其他模块要改，就提交意图，由所属模块在结算阶段统一处理（ADR 0026）。组件随实体 spawn 挂上去但本模块不写字段时，用 `ownComponent` 声明归属（ADR 0047）。
- 跨功能的组件组合（如工地加战斗血量）经注入的部件工厂（`*Parts`）装配：工厂在 `app/` 接线，功能模块不直接生成对方的组件。
- 运行中的系统查询一律排除建造中的实体（`OPERATIONAL_EXCLUDE`）：工地、道路段不参与正常运作，需要工地的模块显式单独查询。
- 系统声明读取（`reads`）和发出（`emits`）的事件与意图；调度效果和命令处理函数声明 `emits`（`builder.effect`/`builder.command` 不接受 `reads`）。
- 命令处理函数先完成全部校验，再修改状态；被拒绝的命令不能只执行了一半（ADR 0027）。
- 事件只用来通知"已经发生"。需要拿到结果时，调用对方的公开查询函数。
- 系统按组件查询，禁止通过比较内容 ID 或"种类"字符串来写特判。
- 数据只放参数和组合，行为写在代码里。

## 客户端规则
- 逐 tick 的实体状态不进 React state，也不进 zustand。渲染在 `useFrame` 里直接读快照缓冲。
- 三态分离：`interactionStore`（一级模式 + 互斥二级工具）、`selectionStore`（仅己方可控句柄）、`inspectorStore`（`hovered`/`pinned`，地形格不可 Pin），跨局重置集中于 `client/session.ts`（[ADR 0048](docs/adr/0048-interaction-modes-and-inspector-contract.md)）。
- UI 快照订阅走共享 `subscribeSnapshotClock` / `useSnapshotValue`（selector 返回引用稳定切片，禁止面板自建 `setInterval`）；检查器读强类型 `*Inspection` 契约。
- UI 原语与离线 Token 统一收口在 `src/ui/kit/` 与 `src/ui/styles/`（[ADR 0049](docs/adr/0049-hud-design-system-and-layout.md)）；`render/` 与 `features/*/render/` 的命令式 Three.js 资源必须在卸载或替换时 `.dispose()`（[ADR 0050](docs/adr/0050-tactical-sandbox-rendering-and-gpu-lifecycle.md)）。
- 用户可见文本一律通过 i18next 的键获取，禁止写字面量。新增键时同时更新 `zh-CN` 和 `en`。
- 输入的流程是"按键或鼠标 → 意图 → 命令"，不要在组件里直接监听某个具体按键。
- 事件用各自的游标从 `sim-client` 的事件日志读取（`eventsSince`）；一份快照可能带多个 tick 的事件（ADR 0045）。
- 跨帧保存对模拟数据的引用时用稳定键（句柄、句柄对），不存会重排的下标（ADR 0045）。

## 加东西之前
- 先查索引，找已有实现。有就复用或扩展，不要复制一份再改。
- 第三处出现相似逻辑时，先合并成共享实现，再继续改动。
- 替换旧实现时直接删掉旧的，不要留下 `_v2`、`_old` 这类并存副本，也不要用开关长期保留多套实现。
- 新增依赖前先说明理由。版本用精确版本号，并且优先选发布满 7 天的版本。
- 改动范围对照 [architecture.md §7.4](docs/design/architecture.md) 的"典型改动的预期影响范围"。明显超出预期范围时，先停下来说明原因。

## 禁止事项
- 不要留死代码、被注释掉的代码、未使用的导入、临时调试输出、没有意义的 TODO。
- 不要手改 `docs/generated/` 和 `static/`，它们由脚本生成。
- 不要为了让检查通过去放宽棘轮基线（`frontend/ratchet.json`）。确实需要放宽时，在 PR 里写明理由。超长文件：>800 行计入棘轮、(600, 800] 仅警告；`*.test.ts(x)`、`test-world.ts`、`src/kernel/testing/` 豁免。
- 不要在白名单以外的位置新建 `.md` 文件。施工计划、调研记录写在 `.plans/`（已被 gitignore），做完即删。删除前把有长期价值的结论提炼到 ADR 或设计文档。
- 文档抽象层级（ADR 0061）：ADR 记决策不记调参，调整已有参数不新写 ADR（原因写进提交信息）；功能 README 只写职责与可核对的不变量（≤80 行、单行 ≤200 字符），`architecture.md` 只写总览；调参常数在代码里集中命名，不写裸数字。人工验收项写进 architecture.md §1.4。
- 不要修改已有 ADR 的正文。决策被推翻时，新写一篇 ADR 来取代它。头部元数据（状态、部分取代、实现）可以更新；落地了某篇 ADR 的未实现部分时，更新它的「实现」行（ADR 0044）。
- 不要修改 `.github/workflows/verify.yml` 和 `release.yml`。它们是插件市场托管的模板。
- 不要在运行时下载或执行代码（`eval`、`new Function`、远程 URL 的动态 `import()`）。只有 `host/` 可以访问网络（ADR 0023，lint 强制）。
- 不要用实体数量上限之类的"保险丝"掩盖性能问题，从根源优化。不要把性能阈值或平衡关系写成代码测试，它们属于 `frontend/eval/`（ADR 0024）。

## 语言
- 文档正文用中文。代码标识符、代码注释、提交信息用英文。

## 验证（提交前必须通过）
在 `frontend/` 目录下：
```bash
npm ci
npm run verify   # = verify:static && test && verify:build（提交前跑全量）
npm run e2e      # 浏览器端到端（冒烟 + HUD/模式/小地图/防重叠，首次需 npx playwright install chromium）；不进 verify
```
- 日常迭代用分段命令：`npm run verify:static`、`npm run test:unit`、`npx vitest --changed`。
- 测试分两层：全对局/耗时 >~3 s 的测试命名 `*.scenario.test.ts`（`npm run test:scenario`），其余为 unit。
- 本地 lint/format/typecheck 有缓存（`node_modules/.cache/`）；缓存不追踪跨文件类型变化，`rm -rf node_modules/.cache` 可复位，存疑以冷跑/CI 为准。
- 黄金哈希（kernel determinism、`eval/match-smoke.scenario.test.ts`）允许随规则变化更新：常量在同一次提交里改，提交信息写明原因。
- `npm run build` 会更新 `static/`，`npm run gen:index` 会更新 `docs/generated/`，这两处的变更都要一起提交。

Python 薄壳在 N.E.K.O 仓库根目录下检查：
```bash
uv run neko-plugin check frontline_td
```

## Git
- 本目录是一个独立的嵌套 git 仓库，提交和推送都在 `plugin/plugins/frontline_td/` 下进行，不要提交到外层的 N.E.K.O 仓库。
