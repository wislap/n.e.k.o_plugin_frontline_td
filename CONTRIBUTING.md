# 参与贡献

## 先读

动手之前先读 [AGENTS.md](AGENTS.md)，再读你要改的功能的 `frontend/src/features/<x>/README.md` 和 `docs/generated/` 下的相关索引。

## 协作方式

- 下一步候选事项（路线图）维护在 [architecture.md §1.4](docs/design/architecture.md#14-下一步候选)；具体任务的共享计划走 GitHub issue + 开发群通知，不进仓库。
- 个人 / agent 的施工计划、调研记录放在 `.plans/`（已被 gitignore），做完即删；删除前把有长期价值的结论提炼到 ADR 或设计文档。

## PR 流程

1. 从 `main` 切功能分支，提交信息用英文。
2. 提交前在 `frontend/` 下跑 `npm ci && npm run verify && npm run e2e`，必须全绿（e2e 首次需 `npx playwright install chromium`）。
3. 生成物一并提交：`npm run build` 更新的 `static/`、`npm run gen:index` 更新的 `docs/generated/`。不要手改这两处。
4. 填写 PR 模板（`.github/PULL_REQUEST_TEMPLATE.md`）中的勾选项，特别是：是否改了公共接口 / kernel / protocol / 依赖规则、复用了哪些已有抽象、是否新增依赖、是否放宽棘轮基线。
5. 改动公共接口、kernel、protocol 或依赖规则属于架构级改动，需要先写 ADR 再在 PR 中说明。

## ADR 流程

- 每个架构决策一篇 `docs/adr/NNNN-<kebab-slug>.md`，编号递增、连续，从已有最大编号 +1。ADR 始终平铺在 `docs/adr/` 下，不按批次或领域分文件夹。
- 头部字段按以下模板书写（H1 之下、正文之前），`gen-index` 会校验：

  ```md
  # NNNN. 标题
  - 状态：已采纳
  - 实现：已实现 | 部分（缺：…） | 未实现（缺：…）
  - 日期：YYYY-MM-DD
  - 决策者：github-id[, github-id2]
  - 批次：本轮评审 / 里程碑批次名
  - 领域：工程 | 架构 | 模拟 | 地形 | 战斗 | 建造 | 物流 | 内容 | UI
  - 部分取代：NNNN（被取代的条款）

  ## 背景

  ## 决策

  ## 后果
  ```

  正文必须包含 `## 背景`、`## 决策`、`## 后果` 三节（`gen-index` 会校验）。`实现` 必填，"部分""未实现"必须写明缺什么，"已实现"可附 `（注：…）`（ADR 0044）。`部分取代` 可选，可写多行（ADR 0041）。`决策者` 用 GitHub ID，多人用 `, ` 分隔；`领域` 只能取上列固定值之一。
- 写好的 ADR 不改正文，只允许改头部元数据（状态、部分取代、实现）。落地了某篇 ADR 的未实现部分时，更新它的「实现」行。决策被推翻时，新写一篇 ADR 取代它，并在旧 ADR 状态中标注「已取代（见 NNNN）」；只推翻部分条款时，在新 ADR 头部写「部分取代」行。
- 新增 ADR 或改动状态后运行 `npm run gen:index` 重新生成 `docs/generated/adr-index.md` 并一起提交。索引按领域分组展示当前有效 ADR，另含已取代 / 已废弃表与批次时间线。

## 验证

`npm run verify` = `verify:static`（类型检查、lint（含模拟层纯度与 i18n 字面量）、格式、依赖规则、knip、索引新鲜度、文档检查、棘轮）→ `test`（unit + scenario 两层）→ `verify:build`（构建、包体积）。日常迭代可只跑 `verify:static` 和 `test:unit`；耗时 >~3 s 或跑整局对局的测试命名 `*.scenario.test.ts`。`npm run e2e` 是额外的 Playwright 浏览器冒烟（不进 verify）。任何一项不通过都不要提交。
