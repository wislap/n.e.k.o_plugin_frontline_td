# 0018. 许可证与依赖许可证

- 状态：已采纳
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：工程

## 背景

项目是开源插件，需要与宿主及依赖的许可证兼容（[architecture.md §3.8](../design/architecture.md)）。

## 决策

- 本项目采用 MIT；必要时可接受 GPL。
- 已核实（2026-11-14）：NEKO 主仓库为 Apache-2.0；three、@react-three/fiber、@react-three/drei、zustand、react、dependency-cruiser 为 MIT；bitecs 为 MPL-2.0（文件级弱 copyleft，作为未修改的依赖使用不影响 MIT）。
- 引入新依赖时核实其许可证兼容性；许可证白名单检查待实际需要时引入（[§13](../design/architecture.md)）。

## 后果

- LICENSE 文件为 MIT，版权归 "frontline_td contributors"。
- bitecs 保持未修改依赖使用；如需修改其源码，按 MPL-2.0 文件级义务处理。

## 相关

- [architecture.md §3.8](../design/architecture.md)
- [ADR 0003](0003-tech-stack.md)
