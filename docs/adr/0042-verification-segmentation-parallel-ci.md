# 0042. 验证分段与 CI 并行

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-18
- 决策者：wislap
- 批次：治理
- 领域：工程
- 部分取代：0041（CI 单一顺序 job 描述改为并行 job；整局冒烟重命名为 eval/match-smoke.scenario.test.ts）
- 部分取代：0037（确定性测试重命名为 eval/determinism.scenario.test.ts 并共享对局运行）
- 部分取代：0017（CI 管道固定顺序：改为 verify:static → test → verify:build 三段、三个并行 job）

## 背景
验证整体耗时成为迭代瓶颈：本地 `npm run verify` 串行约 150 s（测试 80 s、lint 32 s、typecheck 12 s、其余 ~23 s），CI 单 job 约 3 min。测试墙钟被单文件支配（vitest 只按文件并行）：`assault-director` 38 s、`determinism` 22 s、`match-smoke` 11 s、`pathing` 9 s。门禁强度不降的前提下缩短反馈。

## 决策
1. **慢测试只重构不删断言**。同一 tick 区间内重叠断言的用例共享一次对局运行（`beforeAll` 跑一次，各 `it` 从同一组快照/探针断言）；否则按主题拆成多个文件让 vitest 并行。`assault-director` 拆为 wave / director（共享 200 s 跑三次断言）/ persistence / garrison / targeting 五个文件；`determinism` 由 4 次对局降为 3 次（hash 相等与存档复现共用 run A）；`pathing` 的属性测试（全图可达格遍历）拆出。共享夹具移到 `test-world.ts`（`src/app/`、`features/pathing/sim/`）。
2. **unit / scenario 分层**。全对局或长耗时测试命名 `*.scenario.test.ts`；vite.config.ts 定义 vitest `projects`：`unit`（其余全部）与 `scenario`。脚本 `test`（全部）、`test:unit`、`test:scenario`。约定：用时超过 ~3 s 的测试归入 scenario。
3. **verify 分段，单一门禁保留**。`verify:static` = typecheck、lint、format、depcruise、knip、check:index、check:docs、ratchet；`verify:build` = build、check:size；`verify` = `verify:static && test && verify:build`（静态检查最先，失败最快）。本地缓存：eslint `--cache`、prettier `--check --cache`、tsc `--incremental`（tsBuildInfo 存 `node_modules/.cache/tsc/`）。已知限制：ESLint 缓存不追踪跨文件的类型感知变化——**CI 始终冷跑**（`npm ci` 后缓存为空），本地用 `rm -rf node_modules/.cache` 复位，存疑时以冷跑为准。
4. **CI 三个并行 job**：`static`（`verify:static`）、`test`（`test`）、`build`（`verify:build` + 生成物一致性检查 + playwright install + `e2e` + 失败时上传报告）。每个 job 都是 checkout → setup-node（npm 缓存）→ `npm ci` → 同名 npm 脚本，本地门禁与 CI 不可能漂移（CI 调的就是 `verify` 组合的脚本）。

## 结果（本机实测）
- `npm run test` 墙钟 80 s → ~22 s（unit 6.4 s 与 scenario 21.9 s 并行；scenario 最慢文件从 47.6 s 降到 ~15 s）。
- `verify:static` 冷 ~55 s → 热 ~15 s（缓存命中时）。
- CI 单 job ~3 min → 三 job 并行，瓶颈 job 预计 ~1.5 min（build：npm ci + build + playwright + e2e）。

## 后果
- scenario 命名是约定，无工具强制；新增长测试靠评审把关命名。
- scenario 共享 `beforeAll` 的用例对顺序更敏感：共享快照必须只读，修改模拟状态的用例留在自己的 sim 上。
- 缓存只影响本地；CI 结果仍是权威。
- 未做：测试级并行度（vitest 只按文件并行，单文件 15 s 仍是上限）；job 间复用 node_modules（npm ci 每 job ~50 s，权衡后接受）。
