# frontline_td

星际开荒塔防原型：建立补给网、修筑防线、指挥机器人小队推进前线，最终攻破敌方要塞。

NEKO 插件。游戏本体是 `frontend/` 下的网页游戏，构建产物在 `static/`，由插件的 static 面板加载；Python 侧只是声明面板的薄壳。

## 状态

原型开发中（里程碑 M5 玩法底座已完成，并完成 F1–F5 正式化战术 HUD 与电子沙盘前端重构）。玩法与架构还会频繁变化，公开接口未冻结。

## 操作

- **交互模式（左下模式栏）**：`F1` 指挥 / `F2` 建造 / `F3` 物流；`L` 开关物流覆盖层（建造/道路模式下自动开启）。
- **视角与时间（左上控制条）**：`Tab` 切换 3D 观战 / 2D 战术视角；进入 `F2` / `F3` 默认自动切 2D、回 `F1` 自动恢复 3D，可点「视角锁定」关闭自动切换；`Space` 暂停/继续（不再强制切视角）；`-` / `=` 变速；`WASD` / 方向键与鼠标中键拖拽平移、滚轮缩放；支持 NEKO 全屏切换按钮。
- **快捷键引导与遥测**：左中 `KeyGuideRail` 默认展开，按 `K`（或 `?`）或边栏按钮收起/展开，按当前模式置顶键位，`Esc` 不关闭引导栏；按 `` ` `` 在右上仓库下方开关运行遥测面板（默认收起）。
- **战略小地图（左下模式栏上方）**：实时绘制已探索地形、迷雾/记忆、建筑、据点、单位与敌军集结路线及视口框；左键点击/拖拽跳转镜头、滚轮缩放、`F1` 下右键下达推进（`Ctrl`+右键驻守），支持收起/展开。
- **选择、小队与检视（右下 `InspectorPanel`）**：左键点选/拖框选己方实体；悬停任意可见实体、记忆幽灵、废墟/残骸或已探索地格即时预览，左键点击实体可固定检视（`Esc` 或点空地取消固定，地形格仅悬停不固定，严守迷雾零泄密）。`Ctrl+1–9` 或「+ 小队」编队、`1–9` 选队（双击居中），右键下令推进、`Ctrl`+右键驻守；`SquadPanel` 仅在 `F1` 指挥模式显示。
- **建造与双形态拆除（`F2` 建造模式）**：底部建造台支持「全部 / 物流 / 生产 / 军事」分类筛选；选建筑卡片进入放置工具（左键建造、`Shift`+左键下蓝图，幽灵显示程序化轮廓、连接/服务/射程圈与阻塞原因）；`G` 激活已选蓝图；`C` / `Delete` 双形态拆除（选中蓝图/工地直接取消，选中运转中建筑触发 2.5s 二次确认，无己方选中时进入拆除工具连续点拆）；右键或 `Esc` 退出二级工具返回所属一级模式。
- **物流与道路（`F3` 物流模式 & 右上 `StockPanel`）**：`R` 进入道路工具（点击路段沿主线延伸、`Shift`+点击单段切换，`Enter` 或再次点击确认下单；右键或 `Esc` 退出）；右上仓库实时显示存量、净收支速率（`/秒`）、缺货诊断与建造/生产优先级切换。
- **生产**：开局自带 24 个机器人；机器人工厂持续产出，自动补进缺编最多的小队；检查器显示配方进度与下一个单位。
- **据点与迷雾**：地图上有 3 座敌方据点；单位站在废墟的占领圈内即可拉锯夺占，重建完成前可再被打成废墟。未探区域全黑、探过区域留淡影，敌对据点与巢穴以幽灵方块记忆位置。建造模式下显示敌对禁建圈，禁区内无法放置并显示阻塞原因。
- **终局**：胜负判定后弹出结算与“再来一局”。

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
