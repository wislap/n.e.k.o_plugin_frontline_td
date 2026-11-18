# 0017. 防腐化机制

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：工程

## 背景

腐化的根源是 AI 追求完成眼前任务，单次合理的改动不断累积。防线设在"累积"这一层（[architecture.md §11.3](../design/architecture.md)）。

## 决策

六道防线（[§11.3](../design/architecture.md)）：

1. **参考实现**：M2、M3 写成示范代码，AGENTS.md 明确"新功能参照 `features/xxx`"。
2. **棘轮指标**（基线文件入库，只许变好）：`as any`、`@ts-ignore`、eslint-disable 次数（所有逃生口必须附理由）、超长文件数、未使用的导出 / 文件 / 依赖（knip）。变差即 CI 失败，放宽基线必须在 diff 中显式出现。
3. **公共接口清单**：每个功能的导出生成清单入库；PR 改动接口、kernel、protocol、依赖规则时在 diff 中显形，单独评审。
4. **场景测试**作为客观验收标准：黄金状态哈希、同场景两遍一致、中途存档恢复一致；每个玩法机制必须附带场景测试。无头运行器 `runScenario(地图, 种子, 命令序列, tick 数, 探针) → 统计` 是将来批量平衡模拟与调参工具的接口（[§10](../design/architecture.md)）。
5. **先查索引再动手**：AGENTS.md 第一条；PR 模板含"复用了哪些已有抽象，为什么没有复用"。
6. **人工评审聚焦边界**：工具拦得住越界，拦不住"抽象本身错了"；每个里程碑回顾 ADR，预留重构时间。

另外：至少两处真实用法才抽象成共享实现；kernel 改动视同架构级改动，需 ADR（[§7.3](../design/architecture.md)）。

### 待定事项

- 重复代码检测（jscpd）、许可证白名单检查、CODEOWNERS：出现实际需要时引入（[§13](../design/architecture.md)）。
- 平衡调试工具：只留 `runScenario` 接口（[§13](../design/architecture.md)）。

## 后果

- CI 管道固定为：类型检查 → lint → 格式 → 依赖规则 → knip → 测试 → 索引新鲜度 → 棘轮 → 文档检查 → 构建并校验 `static/` 无差异（[§11.2](../design/architecture.md)）。

## 相关

- [architecture.md §10、§11](../design/architecture.md)
- [ADR 0001](0001-adr-process-and-docs.md)、[ADR 0007](0007-feature-first-layout-dependency-rules.md)
