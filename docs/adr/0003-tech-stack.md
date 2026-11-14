# 0003. 技术栈

- 状态：已采纳
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：工程

## 背景

游戏本体是纯静态网页，宿主为 NEKO（Electron / Chromium），WebGL2 可用；需要确定性模拟与大量单位的性能余量（[architecture.md §3](../design/architecture.md)）。

## 决策

- 技术栈：TypeScript + React + Vite + three.js + React Three Fiber + zustand + bitecs（部分 ECS）（[§5](../design/architecture.md)）。
- TypeScript 锁定 6.0.x：typescript-eslint 要求 `typescript <6.1`；TS 7（Go 重写版）只提供 unstable API。
- 测试与工程工具：Vitest、ESLint、Prettier、dependency-cruiser、knip，以及自写的棘轮、gen-index、文档检查脚本（[§11.1](../design/architecture.md)）。
- 包管理器 npm，版本用精确版本号，优先选发布满 7 天的版本；Node 版本用 `engines` + `.nvmrc` 固定（[§3.9、§11.1](../design/architecture.md)）。
- 引入新依赖前先说明理由；依赖许可证见 [ADR 0018](0018-licenses.md)。

### 待定事项

- 3D 观战与正交 → 透视镜头过渡：做 3D 时另写 ADR（[§13](../design/architecture.md)）。
- 音频管线、3D 美术资源格式（glTF）与插件包体积、改键：以后再说（[§13](../design/architecture.md)）。

## 后果

- 版本锁定带来可复现构建；升级依赖是显式决策。
- three/R3F/zustand/bitecs 等依赖在各里程碑按需引入。

## 相关

- [architecture.md §3.8、§3.9、§5、§11.1](../design/architecture.md)
- [ADR 0018](0018-licenses.md)
