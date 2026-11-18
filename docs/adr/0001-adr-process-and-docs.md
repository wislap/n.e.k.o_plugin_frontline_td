# 0001. ADR 流程与文档体系

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：工程

## 背景

中大型项目在 vibe coding 环境下需要文档承载"为什么"，防止决策随代码腐化而丢失（[architecture.md §2](../design/architecture.md)、[§12](../design/architecture.md)）。

## 决策

文档分层管理（[§12 表格](../design/architecture.md)）：

- `AGENTS.md`：入口守则，人 与 agent 动手前必读，上限约 150 行；其他工具的守则文件只有一行指向它。
- `features/<x>/README.md`：功能说明，固定章节。
- `docs/design/`：设计文档，随设计演进。
- `docs/adr/NNNN-*.md`：架构决策记录，写好后不改正文；被推翻则新写一篇取代，旧文只允许改状态。
- `docs/guides/`：操作指南，指向参考实现而非复制代码。
- `docs/generated/`：生成索引，文件头标注"自动生成，勿手改"。
- 施工计划不进主分支：草稿放 `.plans/`（gitignore），共享计划走 GitHub issue；删除计划前先提炼到 ADR / 设计文档 / guides。

Markdown 白名单：只允许根目录 `AGENTS.md`、`CLAUDE.md`、`README.md`、`CONTRIBUTING.md` 与 `docs/{design,adr,guides,generated}/`、`frontend/src/features/*/README.md`、`.github/**/*.md`，由 CI 强制。

ADR 头部固定五个字段（H1 之下、正文之前）：

- `- 状态：`：已采纳 / 待定 / 已废弃 / 已取代（见 NNNN）。
- `- 日期：`：YYYY-MM-DD。
- `- 决策者：`：一个或多个 GitHub ID，用 `, ` 分隔。
- `- 批次：`：本次评审轮次 / 里程碑批次名（如 "M0 架构基线"）。
- `- 领域：`：固定取值之一——工程、架构、模拟、地形、战斗、建造、补给、内容、UI。

ADR 始终平铺编号（`docs/adr/NNNN-*.md`），不按批次分文件夹；批次归属只写在头部字段里。`docs/generated/adr-index.md` 由 `npm run gen:index` 生成，分三段：当前有效（按领域分组）、已取代 / 已废弃、批次时间线。

## 后果

- 文档位置、生命周期与保鲜手段固定，agent 有明确阅读顺序：AGENTS.md → 功能 README → 生成索引 → ADR。
- ADR 编号从 0001 连续递增；新增 ADR 后运行 `npm run gen:index` 更新索引。

## 相关

- [architecture.md §12](../design/architecture.md#12-文档体系)
- [ADR 0017](0017-anti-decay-mechanisms.md)
