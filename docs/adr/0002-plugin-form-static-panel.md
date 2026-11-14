# 0002. 插件形态：static 面板 + Python 薄壳

- 状态：已采纳
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：工程

## 背景

项目是 NEKO 插件。现阶段 NEKO 插件系统只是启动器：游戏本体是打包好的纯静态网页，跑在插件面板的 iframe 中；运行时没有 npm（[architecture.md §2](../design/architecture.md)、[§3.1](../design/architecture.md)）。

## 决策

- 插件形态为 static 面板 + Python 薄壳：`plugin.toml` 声明 `[plugin.ui]` 与 `[[plugin.ui.panel]]`（`mode = "static"`，`entry = "static/index.html"`），Python 侧用 `@neko_plugin` 声明插件类，不写游戏逻辑。
- `static/` 构建产物入库：插件市场托管的 release 只用官方 builder 从 tag 源码打包，没有前端构建钩子；`frontend.yml` CI 校验 `static/` 与源码构建结果一致。
- Python 薄壳将来如接入 NEKO 解说 / 语音，参照 `neko_survivors` 的 `game_event → /chat → speak` 模式，经事件流驱动。
- 面板有 normal / focus / fullscreen 三种模式，渲染与 UI 必须适配尺寸变化；游戏启动时主动请求 fullscreen 或 focus。窗口隐藏时自动暂停（rAF 停止、Worker 计时器被节流）。

### 待定事项

- 关闭 / 切换面板时 iframe 是否销毁：原型不处理，以后做存档时一并解决（[§13](../design/architecture.md)）。
- NEKO 解说 / 语音：事件流已预留，以后接入（[§13](../design/architecture.md)）。

## 后果

- 插件包只包含构建产物；`static/` 必须在提交前由 `npm run build` 重新生成并一起提交。
- Python 依赖为零，薄壳改动面积极小。

## 相关

- [architecture.md §3.1、§5、§6.14](../design/architecture.md)
- [ADR 0003](0003-tech-stack.md)
