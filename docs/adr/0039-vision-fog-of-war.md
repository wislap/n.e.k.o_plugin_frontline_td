# 0039. 视野与战争迷雾

- 状态：已采纳
- 日期：2026-11-18
- 决策者：wislap
- 批次：M5
- 领域：模拟

## 背景

M5 批次 B/D 实现标准 RTS 迷雾：单位与运营建筑开视野，
敌方建筑离开视野后留下「上次看到的样子」，各观察者的
快照通道按可见性过滤。本文记录图层、记忆、过滤注入、
全知阵营与已知限制。

## 决策

### 视野层

- 内容字段 `vision?: int`（格）：单位默认 6、结构默认 4；
  实际取值 robot 7、crawler 6、spitter 8、raider 7；主基地 12、
  车站 6、补给站 8、矿机/电厂/弹药厂 4、炮塔 9、机器人工厂 5、
  据点 14、hive 10。`visionLandmark?: true` 标记地标
  （据点、hive）。
- `Vision { radius, x, y }` 组件经 `unitParts`/`structureParts`
  工厂注入（结构无 `Position`，工厂把占地中心烘进组件；
  单位随 `Position`）。工地、废墟、蓝图不产生视野。
- 每阵营一张 `frontline_td:vision.state` 网格层（u8：0 未见、
  1 见过、2 可见），vision 模块唯一写者。每 5 tick 在
  `capture_fog` 阶段（capture 之后）重算：先把 2 降为 1，
  再按每个视野源盖预计算好的整数圆盘偏移。

### 建筑记忆

- 每个观察者维护 `id -> { handle, kind, x, y, faction, state }`
  的非己方建筑记忆（含废墟）：可见占地任一格子就（重新）
  记录；条目登记的占地重新可见、而实体已消失或不再是
  `Structure`（按 **句柄**校验，见 ADR 0040）时删除。
- 首个视野 tick 把每方的地标建筑播种进各阵营记忆（开局
  双方互相知道据点与 hive 在哪）。
- 记忆经 `builder.state` 排序序列化；快照通道
  `frontline_td:vision.memory` 只列当前不可见的记忆行
  （可见时该行由建筑表呈现）。eval 机器人读建筑时合并
  该通道。

### 过滤：注入式，不回改被过滤模块

- 新类型 `VisibilityQuery`（kernel `types.ts`）：被过滤的
  各快照通道 builder 收一个可选 `visible(ctx, observer, x, y)`，
  默认恒真。接线全在 `app/sim-registry.ts`：
  - `units.dense`：己方恒见，他人按所在格可见；
  - `structures`：己方+己方蓝图恒见，他人按占地任一格；
    `salvage` 仅己方；
  - `squads`：己方恒见；敌方小队按质心格可见 **或** 指令为
    集结/溃退推进——威胁情报按设计保留（看得到集结在哪，
    不要求看得到队形）；
  - `capture.points`：中心格可见才出现。
- `MatchSetup` 阵营加 `vision?: 'fog' | 'omniscient'`（默认
  fog）；攻占 `defaultSetup` 把导演阵营设为 omniscient，
  查询对全知者恒真。全知阵营仍有自己的图层（便宜且统一）。
  §13「导演 AI 是否可以无视迷雾」收口：导演无视迷雾，
  直接读建筑表定夺还目标（ADR 0038）。

### 客户端（批次 D）

- `FogLayer` 按 `vision.state#observer` 盖双层实例网格
  （未见 ≈0.85、见过 ≈0.45、可见无），随地形高，只在图层
  数组身份变化时重建；`MemoryLayer` 用结构高度与占地把
  记忆行画成半透明方块。
- `BeamsLayer` 丢弃两端格都不可见的射击（事件可见性仍为
  'all'，见限制）。建造幽灵与禁建圈读同一敌意判定；
  被雾吞掉的选中目标经既有 prune 自然移出选择集。

## 已知限制

- **事件不过滤**：`combat.shot`、`combat.died`、
  `units.spawned` 等仍以 `all` 可见性下发，客户端只做
  表现层隐藏。带日志/回放的观战可以重建全部战斗——
  迷雾不是反作弊边界；真正要藏需按观察者过滤事件，
  列入待定。
- 圆盘重算每 5 tick 一次；proto_01 上 6000 tick 实测
  `vision.recompute` 约占系统总耗时 9.8%（1200 次、
  约 0.12 ms/次）。更大地图/更多单位时的成本列入待定。

## 后果

- §13「迷雾记忆」与本行收口。`MatchSetup.vision` 是数据
  不是模式分支，与 ADR 0019 的模式无关性一致。
- 据点大图视野（14）+ 地标播种让「攻占推迷雾」的开局
  信息正确；中立据点设计后可直接复用地标播种。
