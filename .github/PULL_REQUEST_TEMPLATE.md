## 改动说明

<!-- 简述这个 PR 做了什么、为什么。 -->

## 影响范围

- 涉及的功能 / 层：<!-- 例：features/logistics/sim、kernel、ui -->

## 架构级改动

- [ ] 本 PR **未**改动公共接口 / kernel / protocol / 依赖规则
- 若勾选了，请在上方说明并链接对应 ADR：

## 复用

- 复用了哪些已有抽象：
- 为什么没有复用（若新增了近似实现）：

## 需要沉淀的决定

- [ ] 无
- [ ] 已写 ADR：
- [ ] 已更新设计文档 / 功能 README：
- [ ] 落地了某篇 ADR 的未实现部分时，已更新它的「实现」行

## 依赖

- [ ] 未新增依赖
- 新增依赖及理由（精确版本、发布时间满 7 天）：

## 棘轮

- [ ] 未放宽 `frontend/ratchet.json` 基线
- 若放宽，理由：

## 检查单

- [ ] `npm run verify` 已通过
- [ ] `static/` 与 `docs/generated/` 的生成变更已一并提交
- [ ] i18n 键 zh-CN 与 en 齐全，JSX 中无字面量
- [ ] 改动涉及性能热点（模拟系统、物流、寻路、渲染循环）时，已运行 `npm run eval:perf` 并对比 `eval/baselines/`
