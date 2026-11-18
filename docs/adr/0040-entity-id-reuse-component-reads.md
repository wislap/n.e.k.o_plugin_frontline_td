# 0040. 实体 ID 复用与组件数组读取

- 状态：已采纳
- 日期：2026-11-18
- 决策者：wislap
- 批次：M5
- 领域：工程

## 背景

M5 对拍发现 rush 局 40 分钟 0 波：波次小队反复停在
`resupplying` 永不出发。怪物（crawler/spitter/raider）内容里
**没有** `CargoStore`（电池），`meanEnergyBp` 本应返回
`null`。实际原因是实体 id 会被回收：某只怪物占用了已死
机器人的 id 后，无条件读 `CargoStore` 槽位数组拿到的是
死者的旧电池数据 → 平均能量被算成低 bp → 进 resupplying；
而怪物阵营没有覆盖格，永远出不来。

同类隐患还在小队命令与交战目标校验里：按解析出的 id 直读
`Faction`/`Mover` 数组而不先确认组件存在。视野记忆表的
陈旧行同理：按 id 判活会被复用骗过（ADR 0039 要求按
句柄校验）。

## 决策

- **规则**：遍历小队成员、记忆行等 id 集合读组件数组前，
  必须先 `ctx.has(<Component>, id)`（或用能给出同样保证的
  查询）。允许缺件的代码路径里，「id 有效」不等于
  「该 id 有这个组件」。
- 电池均值收口为共享助手 `squads/sim/energy.ts`
  `meanEnergyBp(ctx, ids, energyCargo)`：跳过无 `CargoStore`
  的成员，全员都无电池时返回 `null`（小队永不进 resupply）。
  `orders.ts` 的补给判定与 `module.ts` 的快照字段共用此
  助手，不复制循环。
- **定时发射不可被补给阻塞**：`squads` 的 `gather` 令到
  `launchTick` 时先转 `advance` 并发 `SquadsLaunched`，再进
  补给分支。发射是计划中的指令转换而非可选行为；出发前
  掉队的补给是移动方式，不能取消一次排定的进攻。
- 回归测试：电量耗尽且无覆盖格的小队仍按 `launchTick`
  出发；无电池单位生成在刚回收的 id 上永不会触发
  resupplying。

## 后果

- 修复后对拍中波次正常发出（rush 局 waves=5，见
  ADR 0038 数据表）。该 bug 同时解释了 M4 后期偶发的
  波次停滞——此前全靠「无驻军时波次快速满编」掩盖。
- AGENTS.md 增加一条组件数组读取规则（与既有「句柄校验」
  条目并列）。
