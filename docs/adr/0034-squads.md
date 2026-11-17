# 0034. 小队

- 状态：已采纳
- 日期：2026-11-17
- 决策者：wislap
- 批次：M4 MVP 收尾
- 领域：模拟

## 背景

architecture §1.2 把「小队驻守 / 推进两种状态」列为 M4 条目；
§13 同时挂着四个相关问题：模拟侧 AI 的算力分摊、多目的地寻路、
"路被堵死"、以及小队如何组建和补充（`game_design.md` §4.7【待定】）。
本 ADR 落地单层小队机制并逐一收口。

## 决策

### 结构：单层小队，模块自有状态

- 小队是 `features/squads` 模块自有的状态（`env.squads`），不是
  实体；成员关系通过 squads 持有的 `SquadMember` 组件反向索引
  （单一写者，ADR 0026）。嵌套编组（小队里有小队）明确不做，
  列入 §13 待定。
- 小队命令：`squads.create`（成员句柄 + `strength` + 可选 `tag`）、
  `squads.assign`、`squads.disband`、`squads.set_strength`、
  `squads.order`（`guard` / `advance`，`guard` 带 `radius`）、
  `squads.gather`（集结点 + `launchTick` + 目标点）。
- `tag` 是不透明字符串（≤24 字符），存档进小队状态、出现在
  快照里，模块本身从不解释；调用方（导演、UI 快捷键）用它做
  稳定的身份标识。
- 快照 `SquadsChannel` 暴露每个小队的 `order`（含 gather 的
  `launchTick`、目标与已存路线 ≤512 格）、`phase`
  （`moving`/`holding`/`engaging`/`returning`/`resupplying`）、
  `memberCount`。本方小队另附成员句柄，敌方不给。

### AI：orders 相位、错开结算

- 小队 AI 是一个 `orders` 相位系统，按 `(tick + id) % 10 === 0`
  错开，每支小队每 10 tick 决策一次——architecture §13
  「AI 算力分摊」就此收口（模拟侧）。`MoveOrdered` 剔除成员与
  `UnitsSpawned` 补充这两个逐 tick 的子循环不随错开。
- **驻守**：成员在 `radius` 内活动，敌情进入 `radius` 时交战，
  追击限 `radius + 4`（leash）。
- **推进**：到点（≤2 格）后自动转为驻守。
- **交战拆分**：对每个成员用 `combat.inWeaponReach`（武器射程 +
  目标命中半径，与开火判定同一公式）判定——够得着的停下开火，
  其余的继续前进；目标漂移 <2 格不重新给目标。
- **补给**：成员平均电量 <3000 毫（30%）转 `resupplying`，走到
  最近的己方补给覆盖格（物流覆盖层），≥8000 毫返回原任务。
- **集结**：`squads.gather` 存下寻路下行折线（≤512 格）作为路线，
  到 `launchTick` 自动转 `advance` 并发 `SquadsLaunched`。
- **补充**：新出生单位补进同阵营 `strength - 现员` 缺口最大的
  小队（并列取小队 id 小者）。
- 普通 `MoveCommand` 点中小队成员即把它移出小队（玩家微操
  覆盖）；小队 AI 只发 `MoveIntent`/`StopIntent`，从不写
  `MoveTarget`（同 ADR 0036 配套写入 AGENTS.md）。

### 移动意图的节流与吸附

- **防抖**：各分支只在「目标点 ≠ lastGoal」或「有成员空闲
  （MoveTarget 失效）且离目标 >2 格」时才重发 `MoveIntent`；
  否则槽位每 0.5 s 重排一次，队形可见地抖动。掉队成员
  （离质心 >10 格）保留自己的追赶规则。
- **堵路重定向**：推进中每次错开结算都探测原目标的可达性
  （成员已持有该流场，代价低）；不可达时以质心为有界 BFS
  （8 向固定顺序、走本小队移动类、96 格切比雪夫上限、遵守
  动态阻挡层）找最近的可进入格——该格邻接任一敌对
  `Structure` 实体（工地也算，蓝图不在世界里）；找到就打
  那段障碍，原目标恢复可达后回到原路。重定向每小队每
  40 tick 至多一次（`squad.retarget` 随存档）。architecture
  §13「路被堵死」就此收口：小队攻障而不是绕路。
- **多目的地**：不引入分层 A*；「小队各去各处」就是每支小队
  一个目标格，各拿各的流场——§13 对应行收口。
- **不可达目标吸附**：`MoveIntent` 落在该移动类不可通行的格
  （典型：直接点建筑中心）时，沿出发生成螺旋（`spiralOffsets`）
  取最近的可通行**且可达**格，环半径 32。可达性按候选逐个
  探测（`acquireGoal` 一次建一张流场）——实测绝大多数 1 次
  命中、有界上界 32，换来"小队隔着死路也能打到建筑"；若
  日后成为热点可降环径或缓存。`MoveCommand` 行为不变：
  仍拒绝不可通行目标（玩家 UX），吸附只在意图侧。

## 被拒绝的备选

- **小队直接写 `MoveTarget`**：破坏单一写者，移动相位无法
  统一结算；改为意图。
- **按候选建筑逐一建流场选重定向目标**：每支小队每次结算
  建 N 张流场，太贵；改为一次有界 BFS 命中即停。

## 后果

`features/squads/`（`protocol.ts`、`sim/{module,components,state,
deps,commands,update,orders,routing,index}`）、`render/`（威胁
标记与路线箭头）、`ui/`（小队面板）落地；敌方集结有脉冲标记 +
倒计时 + 路线箭头 + HUD 横幅。§13 的 AI 算力分摊、多目的地、
路被堵死三行随本 ADR 关闭；嵌套编组新列一行。
