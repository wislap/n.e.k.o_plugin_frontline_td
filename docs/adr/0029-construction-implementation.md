# 0029. 建造实现：蓝图、工地、拆除残骸与道路工程

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-17
- 决策者：wislap
- 批次：M3 跨模块参考实现
- 领域：建造

## 背景

[ADR 0012](0012-construction-as-entity.md) 定了"建造 = 实体"的框架，
[ADR 0023](0023-grid-layers-groups-commands-rng-runtime-limits.md) 定了
拆除的方向；architecture §13 留了"暂停时下达的命令"一行：规划中的
蓝图、排队、取消与退款要作为正式游戏状态实现。M3 把整条建造流水线
（放置 → 送料 → 施工 → 激活排队 → 拆除 → 残骸）和道路工程落成代码，
本文档记录实现层的约定，之后所有建造相关改动沿用。

## 决策

### 两种放置：工地与蓝图

- **工地（普通点击）**：`PlaceCommand` 校验通过后立即创建实体——
  `Structure`/`Construction`（建造模式）/`UnderConstruction` +
  注入部件（物流工地槽、战斗部件）。即刻 `setBlocked` 占地、可被
  攻击；材料由物流网按"建造"类别送达，进度受已交付封顶
  （`allowed = floor(total·delivered/required)`），每 tick 至多
  推进 1。
- **蓝图（Shift 点击）**：正式实体状态（`Blueprint` 组件），只在
  己方预订表内占格，**不**阻塞地形、不可被攻击、不消耗材料、
  可以放在覆盖之外、其他阵营快照不可见。它回答"暂停时/先规划
  后施工"的需求。
- **激活**：`ActivateCommand` 把蓝图标记为待开工；每 tick 按
  `(orderTick, entity id)` 顺序尝试转工地，条件不满足则保持等待
  并在快照中给原因：`not_covered`/`not_connected`/`occupied`/
  `reserved`/`units_in_way`/`terrain`。排队本身是游戏状态，不是
  UI 技巧——这解决了 §13 的"暂停时下达的命令"。

### 放置校验（`rules/placement.ts` 纯函数）

占地检查顺序：边界 → 静态地形/坡道 → 等高 → 动态占用 → 自身
预订 → 需求矿床。建造范围：节点类建筑要求与己方完工网络的连通
（沿用物流拓扑的环距离规则），非节点建筑要求中心点被覆盖。
占地内任何阵营的移动单位使直接放置失败（`units_in_way`）、蓝图
激活保持等待。客户端 `client/placement-view.ts` 做保守的直线
距离范围近似供预览；**模拟的校验才是权威**，预览可以偏严不能
偏松。所有命令先完成全部校验再改动（ADR 0027）。

### 取消、拆除与残骸

- 取消工地：按**已交付量 100%** 退款，材料生成为残骸（salvage）。
- 拆除（`CancelCommand` 对已完工建筑）：`Construction` 转拆除
  模式，耗时 `demolishTime`，完成后按 `buildCost × salvageBp`
  生成残骸。**当前内容 `salvageBp` = 5000（50%）**——与设计清单
  D4 的"返还 100% 造价"有偏离，以内容数值为准（可调，见
  [ADR 0033](0033-design-checklist-referenced-items.md)）。
- 残骸：export 槽实体（`amt = 退款`、`cap = amt`、`since = tick + 1`，
  全零不生成），由物流网运回仓库；**无 Health、不阻塞地形**，
  export 槽全空后每个结算周期清理。
- 被毁的建筑目前什么都不留——废墟与节点修复暂缓（见
  architecture §13 新增行）。

### 道路工程（`upgrade_links`）

- `UpgradeLinksCommand { links: [{a,b}] ≤ 64, level }` 先全量校验
  再改动：跳过未连通、重复、已有项目、已铺够等级的线路；全部
  跳过则按 `no_targets` / `already_upgraded` 拒绝。
- 项目在下单时固化：折线按上游（仓库侧）→ 下游定向，**快照**
  当时的格列与累计代价，已铺 ≥ level 的格直接跳过；施工按
  `segmentCells`（8 格）一段一段来，同一时刻至多一个当前施工段。
- 段实体：`Faction`/`InWorld`/`Position`（段中格中心）/
  `Construction`（格数 × 每格秒数）/`UnderConstruction`/
  `RoadSegment{project}` + 注入部件（物流工地槽与
  `FixedAttach{node,gen,lastMile}`——挂在上游节点，末段运距 =
  折线到段远端的累计代价；战斗 `Health`/`Targetable`）。**无
  `Structure`，不阻塞地形**。上游节点失效 ⇒ 挂靠为空 ⇒ 常规
  `disconnected` 等待，项目不推进。
- 段完工：`pave` 该段格、移除段实体、接棒下一段或结束项目。
  取消：已交付材料转残骸，项目结束；段被毁（读 `CombatDied`）：
  材料损失、项目结束；**已铺格永不回滚**。
- 项目以自增 id 为键存 `Map`（计数器随状态序列化），结束时
  删除——存档体积不随局时长增长。
- 跨模块部件（战斗 Health/Targetable、物流工地槽）一律经注入的
  spawn-part 工厂在 `app/` 装配（同 `structureParts`），功能模块
  之间不出现生成对方组件的代码。

## 否决的方案

- **蓝图预订材料**：规划状态不该冻结资源；下单时无货是常态，
  送料排队已经是玩法的一部分。
- **段并行施工**：一个项目多个当前施工段要先解决"远端段没有
  合法挂点"的问题；顺序施工天然满足"从仓库侧向外长"，实现也
  最简。
- **逐格画路**（玩家手铺任意格）：见 [ADR 0025](0025-logistics-model.md)
  ——按线路升级保证道路总是成段可用，避免零碎格。

## 后果

- §13「暂停时下达的命令」一行关闭：蓝图 + 激活排队 + 取消退款
  就是答案。
- 工地与蓝图的行为差（阻挡、可被攻击、可见性）由组件组合表达，
  校验逻辑一份（`rules/`），模拟层与客户端各写一个适配器。
- 道路段把"施工实体不是建筑"这个新形态引入了 construction：
  部件全靠注入组合，没有 `Structure` 也能有工地槽、血量和挂点。
- 遗留：废墟、节点修复（§13 新增行）；道路预览的排队量字段
  （客户端目前显示实载量代替）。
