# 0045. 第二轮评审整改约定

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-20
- 决策者：wislap
- 批次：治理
- 领域：架构

## 背景

第二轮外部评审逐条核实后，提交 `0d03eeb` 修复了 16 个问题。其中
多数不是孤立的笔误，而是同一类错误的第一个实例：同样的写法换个
位置还会再犯。修复只体现在代码和提交信息里，本文档把它们沉淀成
约定，后续改动按此执行，形式与 [ADR 0043](0043-review-remediation.md) 相同。

## 决策

### 模拟层
- **移动目标只在"仍持有"时释放**：只有 `MoveTarget.active === 1`
  （行进中）的单位持有共享目标的引用；到达驻留（`active = 2`）时
  引用已经释放。所有释放点统一调用 movement 的 `releaseHeldGoal`，
  不在调用点自行判断 `active !== 0`。重复释放会把同组还在路上的
  单位的流场释放掉，让它们原地停下。
- **读建筑归属必须显式查 `Faction`**：查询 `[Structure, InWorld]`
  不保证有 `Faction`，废墟就没有。需要阵营时把 `Faction` 放进查询
  或先 `ctx.has`，没有阵营按阵营 0 处理（[ADR 0040](0040-entity-id-reuse-component-reads.md)）。
- **跨系统沿用的空间分桶要复核命中**：分桶在某个系统内每 tick
  重建一次，在别的系统里读到的条目可能已死亡或 id 已被回收；命中
  后先 `ctx.has` 复核所需组件（combat 的 `nearestHostile` 复核
  `Targetable`、`InWorld`、`Faction`），再读字段。
- **DEV 投毒的覆盖范围**：投毒（[ADR 0041](0041-governance-and-indexes-v2.md)）
  只能在测试真正走到的路径上暴露脏读，生产环境读到的是回收槽位的
  旧值、行为与开发环境不同，黄金哈希也抓不到。新增"读别的组件"
  的代码路径时，要有测试走到它，尤其是废墟、死亡、id 回收这些边界。
- **纯度区包含玩法目录**：`modes/*/` 中除 `ui/` 以外的代码跑在
  Worker 里，适用模拟层纯度规则；`modes/*/ui/` 适用客户端规则
  （禁止 import `sim/`）。

### 协议与运行时
- **快照携带自上次投递以来所有 tick 的事件**：Worker 一次可能推进
  多个 tick 才发一次快照（倍速、卡顿）。kernel 按观察者过滤每个
  tick 的事件，`sim-host` 累积到下次投递为止。消费方不得假设"快照
  里只有最后一个 tick 的事件"。
- **客户端事件日志 + 游标**：`sim-client` 给收到的事件编序号，保留
  最近 4096 条；每个消费者（HUD 提示、开火光束等）各自持有游标，
  用 `eventsSince(cursor)` 读取，互不抢占。重开对局时日志清空。
- **Worker 错误三条通道都要接**：pump 内的异常走 `error` 消息；
  Worker 的 `onerror`（初始化等处的未捕获异常）与 `onmessageerror`
  也统一上报到 `console.error` 和 runtime store。
- **`runTicks` 返回实际推进的 tick 数**：对局中途结束时提前停止，
  返回值与计时统计都按实际推进数计算。

### 客户端与输入
- **跨帧保存选择时用稳定键**：模拟数据里会重排的下标（如物流链路
  下标）不跨帧保存。道路选择存规范化的端点句柄对 `RoadLinkKey {a, b}`，
  每帧和下单时再解析成当前下标；解析不到视为该选择已失效。
- **指针拖拽可被中断**：按下时 `setPointerCapture`；
  `pointercancel`、`lostpointercapture` 和窗口 `blur` 一律取消进行中的
  拖框或平移，不发出框选。
- **修饰键归浏览器**：按住 Ctrl / Cmd / Alt 时，只有小队数字键产生
  意图（带上 Ctrl 状态），其余按键不产生意图、也不阻止默认行为
  （例如 Ctrl+X 不再触发拆除）。

### CI
- `frontend.yml` 的 `push` 只对 `main` 触发，PR 由 `pull_request`
  覆盖，同一提交不跑两遍。

## 后果

- movement、logistics 的功能 README「不变量」写入对应条目；
  `AGENTS.md` 的纯度区与客户端规则同步更新。
- 评审指出、但核实后代码本来就正确的条目（如移动意图去重），
  补回归测试锁住行为，不改代码。
