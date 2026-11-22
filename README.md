# frontline_td

星际开荒塔防原型：建立补给网、修筑防线、指挥机器人小队推进前线，最终攻破敌方要塞。

NEKO 插件。游戏本体是 `frontend/` 下的网页游戏，构建产物在 `static/`，由插件的 static 面板加载；Python 侧只是声明面板的薄壳。

## 状态

原型开发中（里程碑 M5 玩法底座已完成，并完成 F1–F5 正式化战术 HUD 与电子沙盘前端重构）。玩法与架构还会频繁变化，公开接口未冻结。

## 操作

- **视角**：`WASD`/方向键沿当前朝向平移；`Q`/`E` 旋转；中键拖拽或 `Alt`+左键拖拽环绕观察；`Shift`+中键拖拽抓地移动；滚轮缩放；`N`/`Home` 或指北针回正北。
- **模式**：`F1` 指挥 / `F2` 建造 / `F3` 物流；`Tab` 切换 3D/2D 视角（进建造、物流默认自动 2D，可在左上「视角锁定」关掉）。
- **指挥与小队**：左键点选/框选己方单位，右键下令推进、`Ctrl`+右键驻守；`Ctrl`+`1–9` 编队、`1–9` 选队（仅 `F1`）；悬停或左键固定后右下检视面板显示详情。
- **建造**：`F2` 下在底部建造台按分类选建筑，左键放置、`Shift`+左键下蓝图；`G` 激活选中的蓝图；`C`/`Delete` 拆除（选中运转建筑需二次确认，未选中时进入拆除工具连续点拆）；右键或 `Esc` 退出工具。
- **物流与道路**：`F3` 下 `R` 进道路工具，点击路段延伸、`Shift`+点击切换、`Enter` 或再点确认；右上资源面板看存量、收支速率并切优先级；`L` 随时开关物流覆盖层。
- **其他**：`Space` 暂停，`-`/`=` 变速；小地图（左下）左键点/拖跳转、`F1` 右键直接下令；`K`/`?` 收起左中快捷键栏；`` ` `` 开关右上调试面板；`Esc`/右键逐级返回。

## 文档入口

- [AGENTS.md](AGENTS.md) — 开发守则，动手前必读（`CLAUDE.md` 等只有一行指向它）
- [docs/design/game_design.md](docs/design/game_design.md) — 玩法设计（唯一来源）
- [docs/design/architecture.md](docs/design/architecture.md) — 架构总览
- [docs/adr/](docs/adr/) — 架构决策记录，索引见 [docs/generated/adr-index.md](docs/generated/adr-index.md)

## 前端开发

需要 Node 24（见 `frontend/.nvmrc`），包管理器为 npm，版本全部精确锁定。

```bash
cd frontend
npm ci            # 安装依赖
npm run dev       # 浏览器热更新开发
npm run verify    # 提交前必须通过：类型 / lint / 格式 / 依赖规则 / knip / 索引 / 文档 / 棘轮 → 测试 → 构建 / 包体积
npm run e2e       # Playwright 浏览器端到端检查：冒烟 + HUD/模式/小地图/防重叠（首次需 npx playwright install chromium）
npm run build     # 构建到 ../static/
```

`npm run build` 会更新 `static/`，`npm run gen:index` 会更新 `docs/generated/`——这两处是入库的生成物，变更要一起提交，不要手改。

## NEKO 侧检查与发布

插件源码是独立的嵌套 git 仓库，位于 `N.E.K.O/plugin/plugins/frontline_td`。

在本目录（插件仓库根）：

```bash
uvx ruff==0.12.4 check --ignore-noqa --config ruff.toml .
```

在 N.E.K.O 仓库根目录：

```bash
uv run neko-plugin sync frontline_td --clean
uv run neko-plugin check frontline_td
uv run neko-plugin check -r frontline_td
```

发布（推送 tag、构建插件包、通知插件市场）：

```bash
uv run neko-plugin publish frontline_td
```

插件市场发布使用的 GitHub 仓库名：`n.e.k.o_plugin_frontline_td`。

## 许可证

MIT，见 [LICENSE](LICENSE)。
