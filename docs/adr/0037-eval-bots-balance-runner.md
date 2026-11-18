# 0037. 策略机器人与对拍

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-17
- 决策者：wislap
- 批次：M4 MVP 收尾
- 领域：工程

## 背景

A6 与 architecture §1.2 要求「无界面对拍工具 + 4 个策略机器人
+ 状态哈希测试」（ADR 0024 的 eval 框架只到性能场景）。§13
同时挂着「对局统计观察者」：结算报告与评估框架共用探针。
M4 把两者一起落地。

## 决策

### 机器人（`eval/bots/`）

- 全部是普通 `Controller`：只能通过 `input.issue` 发命令，
  只读自己阵营的快照，一切可变状态经 `save`/`load`（ADR
  0036）；无 RNG，确定性。
- `common.ts` 提供共享件：快照读出器（密集单位、建筑表、
  小队表、库存）、最近点/质心、编队与下单助手，以及建筑
  选址——复用 `features/construction/rules` 的公共选址规则 +
  `makePlacementView` 快照适配器（该适配器由 `client/` 移入
  `rules/`，供 eval 与建造幽灵预览共用）。
- 四个策略：
  - `rush`：先造机器人工厂，凑够 6–8 人成队即直接打 hive。
  - `turtle`：电厂 → 弹药厂 → 工厂，基地朝敌向 7 格一线
    摆 3 座炮塔；小队驻守隘口，满编后定时出击。
  - `economy`：开局机器人留守；电厂 → 朝最近矿区的车站 →
    2 座矿机 → 工厂；满足「工厂与 2 矿机投产且队里 ≥16 人」
    或满 8 分钟后才发起一次总攻。
  - `balanced`：电厂 → 工厂；小队驻守通往敌方方向的两个
    隘口，扛过 2 波反攻后推进。
- 第一版 `economy` 从 0 tick 就把 10 人编队压上去——与
  rush 无异，修正为上述行为（对拍数据见下）。

### 对拍器（`eval/balance/matches.ts`，`npm run eval:balance`）

- 默认 8 个种子 × 4 机器人，经 `resolveSetup(defaultSetup(seed))`
  把 1 号阵营的 local 控制者换成机器人（`controllerFor` 注入），
  对手是正式 `director`；跑满 40 分钟或 `ended`。
- 每局记录：胜者、时长、已发波数、每 60 s 库存采样、逐 tick
  耗时（`sim.timings()` 差分）的均值与 p95、终态哈希；JSON
  报告写 `eval/reports/`（gitignore），控制台打印汇总表。
  不进 `npm run verify`。

### CI 确定性测试（`eval/determinism.test.ts`）

- vitest 的 include 增加 `eval/**/*.test.ts`；depcruise 的
  `eval-src-public-only` 白名单同步加 `app/resolve-setup.ts`
  与 `modes/*/index.ts`（src ↛ eval 方向不变）。
- 两个用例：同一 balanced 对局跑两遍 → 同哈希；90 s 存档 +
  全新 `resolveSetup` 恢复 → 跑到 3 分钟同哈希。两份合计
  约 10 s，CI 可接受。

## 首批数据（8 种子，proto_01，导演对手）

economy 修正前：

| bot | 胜 | 平 | 负 | 均时长(s) | 均波数 | tick均值(ms) | tick p95(ms) |
|---|---|---|---|---|---|---|---|
| rush | 8 | 0 | 0 | 67 | 0.0 | 0.17 | 0.63 |
| turtle | 0 | 0 | 8 | 1346 | 6.0 | 0.47 | 2.04 |
| economy | 8 | 0 | 0 | 52 | 0.0 | 0.17 | 0.41 |
| balanced | 0 | 8 | 0 | 2400 | 10.0 | 0.49 | 1.10 |

economy 修正后：

| bot | 胜 | 平 | 负 | 均时长(s) | 均波数 | tick均值(ms) | tick p95(ms) |
|---|---|---|---|---|---|---|---|
| rush | 8 | 0 | 0 | 67 | 0.0 | 0.18 | 0.56 |
| turtle | 0 | 0 | 8 | 1346 | 6.0 | 0.56 | 2.21 |
| economy | 0 | 0 | 8 | 1713 | 9.0 | 0.28 | 0.61 |
| balanced | 0 | 8 | 0 | 2400 | 10.0 | 0.43 | 1.01 |

读法：rush / 修正前 economy 的速胜说明开局兵力直接冲家
约 1 分钟可破 hive（ADR 0035 记为已知平衡缺口，M4 不调）；
修正后 economy 正常经营也守不住第 9 波，balanced 守满
10 波战平——导演中后期压力在当前数值下偏强。各种子时长
一致是因为机器人与导演决策都不消费 RNG（哈希仍各异）。

## 后果

§13「对局统计观察者」收口：结束画面（`EndScreen`）与对拍器
读同一批 `frontline_td:assault.*` 探针。eval 框架从性能场景
扩展到行为评估；机器人同时是「控制者怎么写」的公开样例。
