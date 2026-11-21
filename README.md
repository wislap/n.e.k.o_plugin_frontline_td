# frontline_td

星际开荒塔防原型：建立补给网、修筑防线、指挥机器人小队推进前线，最终攻破敌方要塞。

NEKO 插件。游戏本体是 `frontend/` 下的网页游戏，构建产物在 `static/`，由插件的 static 面板加载；Python 侧只是声明面板的薄壳。

## 状态

原型开发中（里程碑 M5 完成）。玩法与架构还会频繁变化，公开接口未冻结。

## 操作

- **视角**：`V` 切换观战/战术；`WASD`/方向键平移；滚轮缩放；鼠标中键拖拽平移；`Space` 暂停（观战自动切俯瞰）；`-`/`=` 变速。
- **选择与移动**：左键点选，左键拖框选；右键命令选中单位移动。
- **小队**：`Ctrl`+数字键把选中单位编成小队；数字键选中小队，连按两次镜头居中；右键小队推进，`Ctrl`+右键驻守；左下面板调编制/解散。
- **生产**：开局自带 24 个机器人；机器人工厂持续产出，自动补进缺编最多的小队；检查器显示配方进度与下一个单位。
- **据点与迷雾**：地图上有 3 座敌方据点；单位站在废墟的占领圈内即可拉锯夺占，重建完成前可再被打成废墟。未探区域全黑、探过区域留淡影，敌对据点与巢穴以幽灵方块记忆位置。建造模式下显示敌对禁建圈，禁区内无法放置并显示禁区提示。
- **终局**：胜负判定后弹出结算与"再来一局"。
- **建造**：建造栏选建筑后，左键直接放置工地；`Shift`+左键放蓝图并留在建造模式；`G` 开工选中的蓝图；`X`/`Delete` 取消工地/拆除建筑；右键或 `Esc` 退出建造模式。
- **物流**：`L` 切换物流覆盖层（建造/道路模式下自动显示）。
- **道路**：`R` 或建造栏“道路”按钮进入道路工具；点击线路自动向两端延伸主路线，再次点击已选线路或按 `Enter` 确认下单；`Shift`+点击单独加选/取消一条；右键或 `Esc` 退出。
- **调试**：反引号 `` ` `` 开关调试面板。

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
npm run e2e       # Playwright 浏览器冒烟（首次需 npx playwright install chromium）
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
