# 项目接力开发文档 · HANDOFF

本文档旨在为跨会话、跨 Agent、多人协同开发提供完整、清晰、可立即执行的上下文与工程状态镜像。任何新会话接手本项目时，**应优先通读本文档**。

---

## 一、项目概况与当前状态

- **项目名称**：`ai-agent-top10`
- **仓库地址**：<https://github.com/wjf1/ai-agent-top10>
- **线上站点**：<https://wjf1.github.io/ai-agent-top10/>（双语支持：英文根路由 `/en/`）
- **项目定位**：每天按 GitHub star 真实增量筛选 Top 10 AI Agent 开源项目，基于 8 个可解释维度加权打分，并生成中英双语通俗定位解读与数据报表。
- **当前发布版本**：`v0.6.0`（2026-10-05 发布）
- **当前 Git 分支**：`main`（与远端 `origin/main` 保持同步，工作区 Clean）
- **最新 Release**：[GitHub Release v0.6.0](https://github.com/wjf1/ai-agent-top10/releases/tag/v0.6.0)
- **CI/CD 状态**：GitHub Actions `daily-update` 工作流自动化运行通过（构建耗时 ~25s，全自动部署至 GitHub Pages）。

---

## 二、技术栈与运行基线

| 维度 | 规范与实现方案 | 约束说明 |
|---|---|---|
| **核心框架** | **Astro v5.13.0** | 纯静态站点生成（SSG 模式），零服务端运行时，零外部数据库 |
| **运行时环境** | **Node.js >= 20.0.0** | 原生 ES Module 规范（`"type": "module"`） |
| **语言规范** | **TypeScript + Modern JavaScript (.mjs)** | 严格模式，双端纯函数复用 |
| **样式体系** | **纯原生 CSS 自定义属性 (CSS Tokens)** | 零 Tailwind / Sass 外部编译器依赖，全站全局 CSS 仅 9.5 KB |
| **图表可视化** | **手写内联 SVG** | 零外部图表库依赖（无 ECharts/D3/Chart.js），首屏 JS 几乎为零 |
| **图标系统** | **零依赖矢量 SVG 组件 (`Icon.astro`)** | 16×16 纯矢量描边，替代全站 Emoji |
| **测试框架** | **Node.js 原生 Test Runner (`node --test`)** | 无需安装 Jest/Vitest，回归测试集运行极快（~150ms） |

### 常用核心命令速查

```bash
# 1. 依赖安装
npm install

# 2. 本地开发服务器 (默认端口 http://localhost:4321)
npm run dev

# 3. 运行全量单元测试与流水线回归测试 (62 个测试项)
npm test

# 4. 执行数据结构完整性与安全门禁校验
npm run validate

# 5. Astro 全量静态站点编译 (输出至 dist/ 目录)
npm run build

# 6. 本地静态预览
npm run preview

# 7. 全流程质量门禁 (测试 + 数据校验 + 全站构建，推送前必跑)
npm run check
```

---

## 三、核心架构与文件拓扑

### 1. 数据流向拓扑
```
GitHub REST API
      ↓ (每日定时抓取 scripts/fetch-daily.mjs)
数据清洗与净化 (sanitize.mjs)
      ↓ (单一事实来源规则 config/scoring.json)
纯函数评分计算 (src/lib/scoring.mjs)
      ↓
本地持久化 (src/data/daily/*.json & snapshots/stars.json)
      ↓
Astro SSG 构建期只读消费 (periods.ts 周期聚合)
      ↓
全静态 HTML 产物 (dist/，直接部署至 GitHub Pages)
```

### 2. 关键文件职责与目录结构

```
ai-agent-top10
|-- config/
|   `-- scoring.json            # [单一事实来源 SSOT] 权重、阈值、关键词、时间窗口与抓取参数
|-- scripts/
|   |-- fetch-daily.mjs         # 每日抓取编排主入口
|   |-- validate-data.mjs       # 数据完整性与 XSS/注入防范质量门禁
|   |-- backfill-interpretations.mjs # 历史解读回填工具 (--since, --refresh-rules)
|   |-- rescore.mjs             # 规则变更离线重算脚本
|   `-- lib/                    # 抓取子模块 (github, growth, metrics, interpret, persist)
|-- src/
|   |-- components/
|   |   |-- RankingPage.astro   # 榜单核心容器 (list-toolbar、说明文案、卡片/表格双视图)
|   |   |-- EntryCard.astro     # 榜单卡片 (Sparkline 趋势线、高对比墨色徽章、金银铜牌标、Popover)
|   |   |-- Sparkline.astro     # [v0.6.0 新增] 120x32 轻量 SVG 趋势折线图 (近 21 天增量动力)
|   |   |-- Icon.astro          # [v0.6.0 新增] 16x16 矢量 SVG 图标组件 (替代全站 Emoji)
|   |   |-- Radar.astro         # 自适应 6/8 维交互雷达图 (已收敛至项目详情页)
|   |   |-- TrendChart.astro    # 详情页历史 star/fork 趋势图 (已解耦 --data-primary 色彩)
|   |   |-- ProjectTable.astro  # 紧凑表格视图 (支持多态输入，适应双视图与检索页)
|   |   `-- PeriodSwitch.astro  # 日/周/月周期切换与日期翻页器
|   |-- layouts/
|   |   `-- Base.astro          # 全局主布局 (防白屏主题脚本、精简导航、触控热区)
|   |-- lib/                    # 工具库 (periods.ts 周期聚合, scoring.mjs 评分, routes.ts 路由)
|   |-- pages/                  # 中英双语动态路由树 ([...lang]/*)
|   `-- styles/
|       `-- global.css          # 全局设计令牌 (Tokens、暗色主题、WCAG 墨色、间距标尺)
|-- tests/
|   `-- pipeline.test.mjs       # 核心测试集 (包含 62 项全量自动化测试)
|-- CHANGELOG.md                # 规范更新日志 (遵循 Keep a Changelog)
|-- README.md                   # 中英双语仓库说明与架构特性表
`-- HANDOFF.md                  # [本项目] 接力开发镜像文档
```

---

## 四、最近一轮变更与交付成果 (v0.6.0)

本轮开发严格依据《AgentTop10-UI设计提升方案》审查报告（18 项改进）实施，全面完成并成功部署上线：

1. **P0 阻塞级缺陷修复**：
   - **色彩对比度**：引入 `--good-ink: #036c50` 与 `--warn-ink: #8a4b06`，上涨徽章提升至 5.81:1，下降徽章提升至 6.18:1，分类标签提升至 6.98:1，全量达到 WCAG 2.1 AA 标准（≥4.5:1）；
   - **持平语义闭环**：`.rank-change.same` 切换为中性灰底（`card-2`），消除品牌紫底误导；
   - **字号基线收口**：清除散落的 10.5/11/11.5px 小字，正文文字最低基线统一定为 12px；
   - **排版防断裂**：全局注入 `tabular-nums` 实现数字等宽对齐；长数字与仓库名优化折行规则（`overflow-wrap: anywhere`）。
2. **P1 核心交互与信息架构改造**：
   - **列表工具栏（List Toolbar）**：在榜单上方增加显性说明，明确“近 N 天增量排名”与“8 维综合评分”各自独立，消除首次访问者的认知困惑；
   - **双视图切换**：工具栏支持“卡片视图 / 表格视图”即时切换，借助 `localStorage` 记住用户偏好；
   - **Sparkline 趋势线替代雷达图**：榜单卡片引入近 21 天 Star 增量折线图，卡片高度压减至约 110px，首屏信息容量提升 35% 以上；雷达图完整收敛至详情页；
   - **矢量图标系统（`Icon.astro`）**：封装 16×16 统一矢量描边图标替代全站 Emoji，提升无障碍兼容性与多端一致性；
   - **移动端单行横滚导航**：顶栏剥离日/周/月重复链接；≤700px 视口下实现单行无折行平滑轻触滚动；
   - **触控热区补齐**：通过伪元素扩展点击区域至 ≥44×44px（WCAG 2.5.8 触控标准）；
   - **Hero 指标去重**：第 3 项指标改为全周期“平均单项目增量”。
3. **P2 设计系统规范与细节质感**：
   - **Tokens 标尺收敛**：规范 4 档圆角（`--radius-sm` 至 `--radius-full`）、4px 间距阶梯与全局焦点环 `--focus-ring`；
   - **数据色彩解耦**：拆分 `--data-primary`（#6366f1 / #818cf8）专用于图表曲线与顶点；
   - **Top 3 荣誉塑形**：前三名赋予微描边高亮与高对比度金银铜牌标，去除斜体保证数字端正；
   - **原生 HTML Popover 提示**：差值计算口径使用原生 HTML Popover 替换原生 `title`，兼顾触屏点击与键盘 Tab+Enter 激活；
   - **检索页空态设计**：检索无匹配时展示矢量图标、引导提示与一键清除筛选条件按钮。
4. **验证结论**：`npm run check` 门禁 100% 通过（62/62 测试通过，574 个静态页面构建成功）。

---

## 五、接力开发指引与后续演进建议 (Next Steps)

若后续会话接手本项目，可优先从以下几个方向推进：

| 优先级 | 优化方向 | 建议实现路径与切入点 |
|---|---|---|
| **P1** | **表格视图客户端动态排序** | 在 `ProjectTable.astro` 中注入约 1 KB 的轻量原生脚本，监听 `th` 点击，允许用户按 Stars、7d 增量、上榜次数进行升/降序重排，进一步增强表格视图的分析生产力。 |
| **P2** | **Astro View Transitions 过渡** | 在 `Base.astro` 中引入 Astro 5 官方 `<ClientRouter />`，实现页面跳转间的无刷新平滑过渡与主题状态无缝衔接。 |
| **P2** | **对比工具（ComparePanel）窄屏优化** | 优化 `ComparePanel.astro` 左侧仓库勾选列表在移动端的触控体验，增加搜索过滤输入框，减少长列表滚动摩擦。 |
| **P3** | **自动化无障碍回归测试** | 在 GitHub Actions 中引入 Axe DevTools CLI 或 Lighthouse CI，将 WCAG 2.1 AA 对比度与触控目标尺寸纳入 CI 自动阻断门禁。 |

---

## 六、关键避坑与运行约束（必读）

1. **Bash 命令工作目录重置**：
   - 在 Windows 环境下运行 ZCode Bash 时，工作目录每条命令后均会重置。执行任何命令时必须内联 `cd F:/AI/Zcode/ai-agent-top10 && <命令>`。
2. **Git 网络与代理配置**：
   - 若本机科学上网代理端口（如 7897）未启动，Git 推送会报代理连接失败；此时应使用临时直连参数：`git -c http.proxy= <git命令>`。
3. **发布与推送四文档硬门禁**：
   - 本项目严格受全局规则（`~/.zcode/AGENTS.md`）约束：**在执行任何 `git push` 或发布 Tag/Release 之前，必须同时核验并更新以下 4 份文档**：
     1. `package.json`（版本号对齐）
     2. `CHANGELOG.md`（完整中文更新日志）
     3. `README.md`（中英双语特性与使用说明）
     4. `HANDOFF.md`（本文档，更新最新完成项与下一阶段待办）
4. **Release 标题统一格式规范**：
   - GitHub Release 标题和 Annotated Tag 的说明文字必须严格对齐，且格式必须为：`vX.Y.Z: <中文核心摘要>`（如 `v0.6.0: UI设计提升方案实施与规范化重构`），严禁使用裸版本号或纯英文 commit 标题。
