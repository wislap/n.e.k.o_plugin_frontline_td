# 0035. 攻占模式、导演与胜负

- 状态：已采纳
- 日期：2026-11-17
- 决策者：wislap
- 批次：M4 MVP 收尾
- 领域：模拟

## 背景

ADR 0019 定下「玩法可插拔、通用模块不感知玩法」，但到 M4 前
仓库里只有 dev 场景（`dev_raid` 控制器 + `dev-setup`）。M4 需要
把 A6 的「一个敌方集结点 + 一次反攻 + 路线箭头」与「攻占敌方
基地」装成正式玩法 `frontline_td:assault`，并给出胜负条件。
原里程碑表把「敌方基地与胜负条件」排在 M5；用户决定提前到
M4 一并完成（迷雾仍留 M5）。

## 决策

### 模式装配与注册表

- `modes/assault/` 持有：`setup.ts`（`defaultSetup(seed)`，取代
  `app/dev-setup.ts`：玩家主基地 + 24 机器人 + 物资 200 / 矿 100 /
  能量 100 / 弹药 50；敌方北方 hive + 12 爬虫 + 4 喷吐，东侧
  6 掠袭者，敌方无库存无物流）、`victory.ts`、`director.ts`、
  `probes.ts`、`protocol.ts`、`ui/EndScreen.tsx`。
- `app/modes.ts` 是模式注册表：`resolveSetup` 按 `setup.mode`
  解析，把模式的 sim 模块与控制者装进 `SimConfig`。控制器枚举
  `local | none | director`；`director` 必须配模式，否则报错。
  无模式的最小注册表路径保持不变。
- 怪物是灰盒内容（`crawler`/`spitter`/`raider` 作为 `monster`
  内容注册）；`hive` 是不能建造、无物流节点的生产建筑
  （`producer` 无输入 → 不需要附着与供能），`unitOutput` 循环
  出怪，`ramp` 按比赛时间阶梯提速（10 s → 4 s/只）。
- `Core` 是 construction 持有的组件标记，只标在 operational
  建筑上（site 期没有）；胜负模块只认它，不点名任何阵营或
  内容 id（ADR 0019）。

### 胜负

- 每 20 tick 检查一次：非中立阵营若没有 operational `Core`
  建筑即被淘汰（事件 `assault.eliminated`）；存活 ≤1 个参战方
  时结束，`assault.ended` 给出胜者（0 存活 = 平局）；40 分钟
  时限到 = 平局。`ended` 记录进存档与 `AssaultChannel` 快照，
  换边测试（镜像开局 → 镜像结果）保证对称性。
- **停表机制**：模式向 `Resolved` 提供 `ended()` 谓词；运行时
  在最新快照报 ended 后停步（时钟冻结，暂停/变速失效），
  `runScenario` 用同一个通用 `stop(sim)` 回调。kernel 不含
  模式知识；不在 kernel 里加「终局后拒收命令」的门——命令
  照常进队列，只是时钟不再走。

### 导演

- `modes/assault/director.ts`，确定性控制者，每 20 tick 凭自己
  的快照决策（M4 无迷雾，§13「导演 AI 是否可以无视迷雾」
  随本模式一并定：读全图快照；做迷雾时若改，另写 ADR）。
- 周期：`init` → `gather` → `wave` → `breather`。首次集结
  90 s；集结窗口 60 s，每完成一波 +10 s，上限 120 s
  （从 `gatherStart` 起算）；目标 = 离 `enemy_rally` 直线最近的
  敌对 `Core` 或建筑（并列取 id 小者）；`squads.gather` 带
  `launchTick` = 窗口终点；波次小队消亡后或出发 150 s 后进入
  45 s 喘息。
- 小队靠不透明 tag 识别：`hive_guard`（开局怪驻守 hive、
  半径 10、strength = 当前数量）、`wave:<n>`（集结小队，
  strength = 波次上限 8 + 4/已完成波、上限 40——用 strength
  缺口引导通用补充规则把新怪喂进集结队）、`raid`（掠袭者
  小队，攻击最近的敌对非仓库物流节点，目标倒了重选）。
  波次一发射就把 strength 钉成当前人数，之后刷的怪留给
  下一波。
- 探针（模式注册）：每阵营每货物库存、存活单位、建筑数、
  已发波数、hive 血量毫——结束画面与 eval 对拍共用（§13
  「对局统计观察者」收口，见 ADR 0037）。

### 结束画面

- `modes/assault/ui/EndScreen.tsx` 读自己模式的 `AssaultChannel`
  与探针；`Hud` 只留一个通用 `modeUi` 插槽，由 `app/` 装配——
  通用 UI 不认识任何模式 id。`client.restart(setup)` 走
  worker 协议重启，不刷新页面。

## 已知缺口（用户决定，M4 不处理）

- **开局 rush 过快**：按当前数值，开局 24 机器人直接 A hive
  约 1 分钟可赢（eval 数据见 ADR 0037）。平衡不在 M4 调，
  列入 architecture §13 新行。
- 集结点打断、逐波难度系数、骚扰波等导演增量功能均留到
  后续里程碑。

## 后果

`modes/assault/` + `app/modes.ts` 落地，dev 场景与 `dev_raid`
删除；胜负、集结可见性、路线箭头、再来一局全部可演示。
