# 0064. 将 `game_design.md` 降级为无约束力的早期概念讨论归档

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-28
- 决策者：wislap
- 批次：文档治理收口
- 领域：工程
- 部分取代：0001（`docs/design/game_design.md` 冻结为无直接约束力的早期概念讨论归档，不再作为现行玩法规范；同时正式移除未启用的 `docs/guides/` 白名单）

## 背景

`docs/design/game_design.md` 形成于 M0 前后的早期概念讨论。随着 M1–M5 底座、P1–P5 寻路运动以及晴野视觉与客户端贡献点架构（[ADR 0060](0060-orbital-3d-camera-ray-anchored-controls-and-volume-picking.md)–[0063](0063-field-visual-pipeline-hud-and-camera-evolution.md)）落地，所有现行有效的玩法机制与技术契约均已沉淀至 `docs/adr/`、各功能 `README.md` 与场景测试中；而 `game_design.md` 内部仍保留大量早期淘汰方案对比、前后不一的参数口径与尚未拍板的机制张力（如对称补给与终局高潮、单兵自动补员与多兵种混编、老家零运费选址等）。继续在入口文档中将其称为“玩法设计（唯一来源）”容易误导协作者与 AI agent 将早期讨论稿当成既定需求。

## 决策

1. **原路径就地降级为历史归档**：保留文件路径 `docs/design/game_design.md` 及现有章节标题不变（确保 [ADR 0019](0019-factions-and-pluggable-modes.md)、[0021](0021-scheduled-effects-entity-relations.md)、[0025](0025-logistics-model.md) 与各功能 `README.md` 的历史链接不断链，不改动既有 ADR 正文），但正式将其定性为**早期概念讨论归档**。
2. **剥离直接开发约束力**：`game_design.md` 全文（**包括原标 `【已定】`、`【建议】`、`【待定】` 的全部条目**）不再具备直接需求或规则约束力，仅作理解早期设计脉络与后续讨论的选题池参考。
3. **现行权威契约归口**：已生效的玩法规则与架构约束统一以已采纳的 `docs/adr/`、各功能 `frontend/src/features/*/README.md` 不变量及测试为准（[`architecture.md`](../design/architecture.md) 持续维护架构总览与路线图）。`game_design.md` 中任何未落地设想在动工前，必须经负责人重新拍板并另立新 ADR 后方可实施。
4. **文档白名单收口**：正式废除 [ADR 0001](0001-adr-process-and-docs.md) 中从未启用的 `docs/guides/` 层级，`tooling/check-docs.ts` 仅放行 `docs/{design,adr,generated}/`。

## 后果

- 彻底消除早期头脑风暴文稿对日常开发与 AI 施工的误导，同时 100% 保持历史 ADR 链接完好。
- 协作者与 agent 的规则检索路径收敛为单一权威链路：`AGENTS.md` → 功能 `README.md` → 生成索引 → `docs/adr/`。
