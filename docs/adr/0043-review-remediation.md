# 0043. 评审整改约定

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-18
- 决策者：wislap
- 批次：治理
- 领域：工程
- 部分取代：0021（容纳关系的 ContainedIn 契约组件设计）
- 部分取代：0026（契约组件清单中的 ContainedIn）

## 背景

一次外部评审对运行时正确性、架构一致性与性能提出了若干问题，
逐条核实后分两部分整改：第一部分修客户端与运行时的真实缺陷，
第二部分把约定固化成文档与工具检查。本文档记录整改后生效的
约定，后续改动按此执行。

## 决策

### 运行时正确性
- **重开即重置**：重开对局 = 向 worker 发 restart + 重置全部
  client store（`resetClientState()`）+ 摄像机复位 + 以 `matchKey`
  重挂 React 子树。组件内的对局态（结算屏状态、图层缓存）靠
  remount 回收，不靠手动清理。
- **单一意图路由**：键盘与指针产生的意图都进 `app/dispatch.ts`
  的 router；全局意图由 router 处理，依赖画布的意图转发给
  GameCanvas 注册的 handler。UI 按钮该走意图的走意图，不直接
  戳 store。道路等级从内容数据取最低可建道路等级，不写字面量。
- **内容查找失败即报错**：地图关键点（`requirePoint`）、能量货物
  索引（`requireCargoIndex`）、结构渲染高度（必填 `visual.height`）
  在装配期缺失时抛错，不再静默回退到 -1 / {0,0} / 默认值。
- **worker 崩溃路径**：pump 捕获 `host.advance` / 快照投递的异常，
  发一次 `error` 消息后锁死（不再每帧抛），主线程经
  `console.error` + runtime store 的 error 上 UI，e2e 的失败收集器
  能捕获。

### 渲染性能
- **线段缓冲复用**：六处逐帧 `new BufferAttribute(arr.slice())`
  改成共享的 `render/line-buffer.ts`：按容量预分配、原位写入、
  `setDrawRange` + `needsUpdate`，超容量才销毁重建，卸载时
  dispose。可变 GPU 缓冲放 `useRef`（react-compiler 不允许
  改 `useMemo` 的返回物）。

### 内核精简
- 删除契约组件 `ContainedIn`：没有生产使用方，驻防/容纳机制
  出现时按当时设计重做，不再保留占位。
- 统计量不再有 `quantity` / 几何类别之分：`MoveSpeed` 是唯一
  统计量，`combineStat` 只保留倍率合成。
- **保留** `builder.effect` / `ctx.schedule` 延迟效果队列
  （ADR 0021）：已实现但尚无生产使用方，首个使用方出现前保留，
  见 architecture.md §13。

### 治理与工具
- **功能 README 固定章节**：每个 `features/<x>/README.md` 按序
  使用「职责 / 公开接口 / 拥有的组件 / 不变量 / 对应设计」五个
  `##` 章节，`check-docs` 强制（缺失、多余、乱序都报错）。正文
  中文，不出现内部批次标签，行为描述 + ADR 链接。
- **knip 入口导出**：`includeEntryExports: true`，每个导出项
  都要被真实消费；只在本模块内用的改内部声明，桶文件不代发
  无人用的名。测试世界是导出项的合法消费者（test-world helpers）。
- **`src/testing/` 测试共享目录**：只放测试助手（`makeGrid`、
  `must`、`denseUnits` 等出现 ≥3 份的拷贝）。depcruise 强制：
  只能被 `*.test.ts(x)` 与 `**/test-world.ts` 引用；自身只能
  引用测试可用的公开入口。功能测试世界仍自组装最小模块集。
- **`eval:perf` 覆盖两个场景**：movement + logistics 顺序执行。
- **生成物标注**：`static/**` 标 `linguist-generated=true -diff`；
  CI 的一致性检查走 `git status --porcelain`，不受影响。

### 系统顺序（评审第 9 条的结论）
`sim-registry` 中 combat 最后注册**是负载的，但原注释的原因
是错的**：不是「cleanup 读者要在 despawn 前看到 died」（事件
整 tick 可读、despawn 本来就是 tick 末生效），而是结构变更队列
按入队顺序生效——`free_dead` 等 cleanup 系统自身也会入队
despawn，队列顺序决定实体空闲槽顺序，进而决定后续 spawn 复用
的实体 id；提前注册 combat 会使 match 哈希分叉（已实验证实）。
注释已按真实原因改写，`src/app/sim-order.test.ts` 用
`describe()` 钉住 `release_dead` / `free_dead` 先于
`combat.despawn` 的顺序。

## 后果

- 契约组件清单回到 `Faction` + `InWorld` 两个；容纳机制将来
  按新设计加组件，不复活 `ContainedIn`。
- 新增测试助手一律进 `src/testing/`，不再在测试世界间拷贝。
- 模块注册顺序不再是「可以随便排的列表」：跨阶段同 phase 的
  相对顺序由 `sim-order.test.ts` 钉住，改动顺序要配哈希更新
  与说明。
