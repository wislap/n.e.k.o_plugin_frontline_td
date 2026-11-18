# 0032. 宿主显示模式与自动暂停

- 状态：已采纳
- 实现：已实现
- 日期：2026-11-17
- 决策者：wislap
- 批次：M3 跨模块参考实现
- 领域：工程
- 部分取代：0002（启动时主动请求显示模式）

## 背景

[ADR 0002](0002-plugin-form-static-panel.md) 写了"游戏启动时主动请求
fullscreen 或 focus"以及"窗口隐藏时自动暂停"。M3 落地时发现两点
需要修正：宿主提供了正式的显示模式 SDK，而启动即抢全屏对插件
形态并不合适；另外要明确这个 `<script>` 标签与 ADR 0023「禁止
运行时下载代码」的关系。本文档取代 0002 中那一句（0002 本身不
改）。

## 决策

### 显示模式：用户主动、SDK 封装、降级到 unsupported

- 我们的 `index.html` 用一个静态 `<script
  src="/plugin-ui-sdk/display.js">` 标签加载宿主的显示模式 SDK——
  脚本由宿主在同源路径下提供，加载后暴露
  `window.NekoPluginDisplay`：`requestMode('fullscreen'|'focus')`、
  `exit()`、`getState()`、`onStateChange(listener)`，结果带
  `applied|declined|unsupported|cancelled|busy|failed` 状态。
- 封装在 `src/host/display.ts`：类型就地声明（不引 SDK 包），
  SDK 缺席时所有调用返回 `unsupported`。Vite dev 下该脚本 404，
  自然降级为"不支持"——按钮禁用 + tooltip，不产生运行时错误。
- HUD 放切换按钮：fullscreen ↔ exit；`declined|busy|failed` 显示
  瞬态消息。**启动时不自动请求任何模式**——取代 ADR 0002 /
  architecture §3.1 的"启动时主动请求"：插件面板宿主本身管理
  窗口布局，未经用户操作抢全屏是坏邻居行为；按钮 + 宿主自身
  的模式入口已够用。

### 自动暂停

- `src/host/visibility.ts` 监听 `visibilitychange`：文档转 hidden
  时暂停模拟；**不自动恢复**——玩家可能在别的面板里做事，
  自行恢复会打乱节奏；恢复是用户按一次空格的成本。
- 浏览器接入在 `app/` 装配（`installVisibilityPause` 参数化
  document 便于测试）。

### 为什么 script 标签不违反"禁止运行时下载代码"

ADR 0023 禁止的是**插件在运行时下载或执行插件代码**。这里不是：
标签写死在我们的静态 `index.html` 里，脚本是宿主在自己源上提供
的固定 SDK——不是插件去抓取/执行代码，与 React 等打包依赖的区别
只在"由页面加载而非打进 bundle"；加载失败的结果是降级不是供应链
风险。lint 规则不变。

## 否决的方案

- 启动即 `requestMode('fullscreen')`：见上，坏邻居。
- 自动恢复暂停：`visibilitychange → play` 会在用户无意时启动
  模拟。
- 引入 SDK npm 包：宿主运行时注入才是权威版本，包只会制造
  版本漂移。

## 后果

- architecture §3.1 的全屏句改引本文档。
- `host/` 成为唯一允许接触宿主 SDK 全局的层；其余代码只认
  `host/display.ts` 的类型化接口。
- `unsupported` 是正常结果而非错误：UI 需始终有不依赖全屏的
  可用布局。
