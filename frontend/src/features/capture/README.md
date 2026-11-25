# capture

## 职责
对废墟做拉锯占领：带 `capture` 内容档案的结构被摧毁后由 construction
转成废墟，本模块按半径内的移动单位推进占领进度，完成后发出
`CaptureCompleted`，由 construction 在下一 tick 把废墟改建为工地。
不改写任何 `Faction` 字段。

## 公开接口
- `sim/index.ts`：`createCaptureModule(db, options?)`，`options.visible`
  注入 `VisibilityQuery`（默认全见），占领点圆心对观察者不可见时
  整行从快照隐藏；`captureRuinParts`（经 `app/` 注入 construction 的
  `ruinParts`，镜像废墟身份使本模块不 import construction 内部）。
- `protocol.ts`：`CapturePointsChannel`
  （`frontline_td:capture.points`，handle、圆心、半径、owner、
  progressBp、leader、contested）；`CaptureCompleted` 事件
  （可见性 `all`）。
- `content.ts`：结构的 `capture` 档案 schema（半径、占领 tick 数、
  重建工期）。导出全表见 [exports.md](../../../../docs/generated/exports.md)
  与 [contracts.md](../../../../docs/generated/contracts.md)。
- `render/`：`captureSceneLayers`（CaptureLayer：占领点半径环，
  ADR 0062 场景层注册）。
- `ui/`：`captureInspectorSubjects`（ADR 0062 检视器主题注册：
  ruin，联合 CapturePointsChannel）。

## 拥有的组件
- `Capture { owner, progress, done, kind, x, y, leader, contested }`
  （本模块写）。

## 不变量
- 每个 `Capture` 实体按内容半径检查半径内的移动单位
  （`Mover + Position + Faction + InWorld`）。
- 阵营速率 `rate(n) = lnMilli(n·MILLI + E_MILLI)`（n ≥ 1，否则 0）；
  取最高与次高速率，`net = A - B`。
  - 无单位：每 tick 衰减 `total / 1000`（= 2%/s）；归零后 `owner = 0`。
  - `net > 0`：`owner` 为 0 或领先方 → 进度累加；`owner` 为落后方 →
    进度削减，归零后 `owner` 翻转。
  - `net = 0`（平局）：停滞，`contested = 1`。
- 进度达到 `total = capture.ticks · lnMilli(MILLI + E_MILLI)` 时置
  `done` 并发出 `CaptureCompleted { ruin, faction, kind, x, y }`；
  construction 在下一 tick 的 `construction` 阶段把废墟 despawn 并以
  `rebuildTicks` 为工期生成新工地（无造价、纯时间进度）。
- 进度系统运行于 `capture_fog`（最后一个阶段）。

## 对应设计
- [ADR 0038](../../../../docs/adr/0038-outposts-ruins-capture-exclusion.md)
  （据点、废墟、占领与禁建区）。
- [ADR 0039](../../../../docs/adr/0039-vision-fog-of-war.md)（观察者
  过滤注入 `options.visible`）。
- [ADR 0043](../../../../docs/adr/0043-review-remediation.md)（跨模块
  共享用部件工厂注入，不互 import 内部）。
