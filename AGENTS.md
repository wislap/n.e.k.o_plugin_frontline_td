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
4. 需要理解"为什么"时，按 ADR 索引查对应的 ADR。

## 分层与依赖（工具强制，见 ADR 0007）
- 模拟层（`core/`、`kernel/`、`features/*/sim/`、`features/*/rules/`）是无头游戏核心，只通过命令、快照、事件与外界交互（ADR 0004）。
- `features/*/render/`、`features/*/ui/`、`client/`、`input/` **禁止 import 任何 `sim/`**。需要共享的纯规则放在 `features/*/rules/`。
- 跨功能引用只能走对方的 `index.ts`，不能深入引用内部文件。禁止循环依赖。只有 `app/` 可以装配全部模块。
- 玩法专属代码放在 `modes/<mode>/`，只有 `app/` 可以引用它。通用模块不感知玩法，禁止按玩法 ID 写特判（ADR 0019）。
- 违反依赖规则时修改设计，不要修改规则。规则本身的改动属于架构级改动，必须先写 ADR。

## 模拟层硬性规则（ADR 0006、0008）
以下前两条由 lint 强制，作用于纯度区：`core/`、`kernel/`、`content/`、`protocol/`、`features/*/sim/`、`features/*/rules/`、`features/*/content.ts`、`features/*/protocol.ts`。
- 禁止 `Math.random`、`Date`、`performance`、DOM 全局对象。随机数只用 `core` 提供的带种子 RNG 流。
- 禁止直接调用超越函数（`Math.sin`、`cos`、`tan`、`atan2`、`exp`、`log`、`pow` 等），一律用 `core` 的确定性数学。
- 不依赖帧时间。每个 tick 推进固定的 50ms 模拟时间。
- 时间用整数 tick；资源、血量、伤害等数量用千分单位整数，舍入只用 `core` 的整数运算；只有几何量用浮点（ADR 0020）。
- 延迟效果走 kernel 调度队列，冷却用 `readyAtTick` 字段，不自写计时器（ADR 0021）。
- 组件视图在每次系统运行时从 kernel 获取，不跨 tick 保存（存储会扩容，ADR 0020）。
- 创建、删除实体和增删组件在 tick 末统一生效，新实体从下一个 tick 起才出现在查询里（ADR 0026）。
- 可开关的机制写成独立的组件 + 系统，由玩法决定注册，不在系统里按玩法写分支；通用规则对各阵营对称（ADR 0019）。
- 新增 RNG 流要在 `app/` 中登记用途（ADR 0023）。
- 内容 ID 和所有注册表键用 `包ID:名字`；已发布的 ID 不改名，存档不写数字索引（ADR 0022）。
- 跨 tick 只保存实体句柄（ID + 代数），使用前先校验有效性。
- 按 id 读组件数组前先 `ctx.has` 该组件（或用保证含有的查询）：id 会被回收，"id 有效"不等于"该 id 有此组件"（ADR 0040）。
- 属于某一方的状态（资源、解锁、迷雾、物流网）一律按阵营 ID 存储，不写全局"玩家状态"。AI 只能通过命令行动（ADR 0019）。
- 实现 `save`/`load` 的控制者不得把可变状态留在它们之外（ADR 0036）。AI 与系统代码请求单位移动时提交移动意图，不写 `MoveTarget`（ADR 0034）。
- 每个组件只有所属模块能写：模块安装时用 `claimWriter` 认领，写入时出示认领凭证。其他模块要改，就提交意图，由所属模块在结算阶段统一处理（ADR 0026）。
- 跨功能的组件组合（如工地加战斗血量）经注入的部件工厂（`*Parts`）装配：工厂在 `app/` 接线，功能模块不直接生成对方的组件。
- 运行中的系统查询一律排除建造中的实体（`OPERATIONAL_EXCLUDE`）：工地、道路段不参与正常运作，需要工地的模块显式单独查询。
- 系统、调度效果、命令处理函数要声明读取（`reads`）和发出（`emits`）的事件与意图。
- 命令处理函数先完成全部校验，再修改状态；被拒绝的命令不能只执行了一半（ADR 0027）。
- 事件只用来通知"已经发生"。需要拿到结果时，调用对方的公开查询函数。
- 系统按组件查询，禁止通过比较内容 ID 或"种类"字符串来写特判。
- 数据只放参数和组合，行为写在代码里。

## 客户端规则
- 逐 tick 的实体状态不进 React state，也不进 zustand。渲染在 `useFrame` 里直接读快照缓冲。
- 用户可见文本一律通过 i18next 的键获取，禁止写字面量。新增键时同时更新 `zh-CN` 和 `en`。
- 输入的流程是"按键或鼠标 → 意图 → 命令"，不要在组件里直接监听某个具体按键。

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
- 不要在白名单以外的位置新建 `.md` 文件。施工计划、调研记录写在 `.plans/`（已被 gitignore），做完即删。删除前把有长期价值的结论提炼到 ADR、设计文档或 `docs/guides/`。
- 不要修改已有 ADR 的正文。决策被推翻时，新写一篇 ADR 来取代它。
- 不要修改 `.github/workflows/verify.yml` 和 `release.yml`。它们是插件市场托管的模板。
- 不要在运行时下载或执行代码（`eval`、`new Function`、远程 URL 的动态 `import()`）。只有资源加载模块和 `host/` 可以访问网络（ADR 0023）。
- 不要用实体数量上限之类的"保险丝"掩盖性能问题，从根源优化。不要把性能阈值或平衡关系写成代码测试，它们属于 `frontend/eval/`（ADR 0024）。

## 语言
- 文档正文用中文。代码标识符、代码注释、提交信息用英文。

## 验证（提交前必须通过）
在 `frontend/` 目录下：
```bash
npm ci
npm run verify   # 类型检查、lint、格式、依赖规则、knip、测试、索引、文档、棘轮、构建
npm run e2e      # 浏览器冒烟（首次需 npx playwright install chromium）；不进 verify
```
- 黄金哈希（kernel determinism、`eval/match-smoke.test.ts`）允许随规则变化更新：常量在同一次提交里改，提交信息写明原因。
- `npm run build` 会更新 `static/`，`npm run gen:index` 会更新 `docs/generated/`，这两处的变更都要一起提交。

Python 薄壳在 N.E.K.O 仓库根目录下检查：
```bash
uv run neko-plugin check frontline_td
```

## Git
- 本目录是一个独立的嵌套 git 仓库，提交和推送都在 `plugin/plugins/frontline_td/` 下进行，不要提交到外层的 N.E.K.O 仓库。
