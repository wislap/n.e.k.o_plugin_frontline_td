# frontline_td

星际开荒塔防原型：建立补给网、修筑防线、指挥机器人小队推进前线，最终攻破敌方要塞。

NEKO 插件。游戏本体是 `frontend/` 下的网页游戏，构建产物在 `static/`，由插件的 static 面板加载；Python 侧只是声明面板的薄壳。

## 状态

原型开发中（里程碑 M0：工具链与治理）。玩法与架构还会频繁变化，公开接口未冻结。

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
npm run verify    # 提交前必须通过：类型 / lint / 格式 / 依赖规则 / knip / 测试 / 索引 / 文档 / 棘轮 / 构建
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
