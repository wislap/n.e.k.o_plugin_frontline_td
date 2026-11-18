# 0016. 多语言策略

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：UI

## 背景

必须支持多语言，禁止硬编码用户可见文本；先做 zh-CN 与 en（[architecture.md §3.6](../design/architecture.md)）。

## 决策

- i18next + react-i18next；键类型由 zh-CN 资源推导（i18next `CustomTypeOptions`）。
- eslint-plugin-i18next 禁止 JSX 字面量（jsx-only 模式，测试文件除外）。
- 中英键完整性由测试保证：zh-CN 与 en 键集合（深层）一致且无空串。
- 语言选择：`navigator.language` 以 "zh" 开头用 zh-CN，否则 en；fallbackLng 为 zh-CN。
- 插件元数据的 i18n（`plugin.toml` 的 `[plugin.i18n]`）在有需要时再加。
- 新增键时同时更新 zh-CN 与 en。

## 后果

- 用户可见文本一律通过 i18next 键获取；缺键在 lint / 测试 / 类型层被发现。

## 相关

- [architecture.md §3.6、§5](../design/architecture.md)
