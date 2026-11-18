# capture — 占领/拉锯（M5 批次 A）

带 `capture` 内容档案的结构被摧毁后由 construction 转成废墟（`Ruin` 标签、无 `Faction`、占用格仍封锁）。本模块对废墟做拉锯占领，不改写任何 `Faction` 字段。决策见 [ADR 0038](../../../../docs/adr/0038-outposts-ruins-capture-exclusion.md)。

## 规则

- 每个 `Capture` 实体按内容半径检查半径内的移动单位（`Mover + Position + Faction + InWorld`）。
- 阵营速率 `rate(n) = lnMilli(n*1000 + e*1000)`（n ≥ 1，否则 0）。
- 取最高与次高速率：`net = A - B`。
  - 无单位：每 tick 衰减 `total / 1000`（= 2%/s）；归零后 `owner = 0`。
  - `net > 0`：`owner` 为 0 或领先方 → 进度累加；`owner` 为落后方 → 进度削减，归零后 `owner` 翻转。
  - `net = 0`（平局）：停滞，`contested = 1`。
- 进度达到 `total = capture.ticks * lnMilli(1+e)` 时置 `done` 并发出 `CaptureCompleted { ruin, faction, kind, x, y }`；construction 在下一 tick 的 `construction` 阶段把废墟 despawn 并以 `rebuildTicks` 为工期生成新工地（无造价、纯时间进度）。

## 组件

`Capture { owner, progress, done, kind, x, y, leader, contested }`，经 construction 的 `ruinParts` 注入（`app/` 接线 `captureRuinParts`）。`kind/x/y` 是生成时镜像的废墟身份，使本模块不 import construction 内部。

## 通道与事件

- `frontline_td:capture.points` 快照通道：handle、圆心、半径、owner、progressBp、leader、contested。builder 接收 `observer`，批次 B 视野过滤在此注入。
- `frontline_td:capture.completed` 事件（可见性 `all`）。

## 阶段

进度系统运行于 `capture_fog`（最后一个阶段）。
