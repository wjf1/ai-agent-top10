# 项目接力开发文档 · HANDOFF

本文档旨在为跨会话、跨 Agent、多人协同开发提供完整、清晰、可立即执行的上下文与工程状态镜像。任何新会话接手本项目时，**应优先通读本文档**。

---

## 一、项目概况与当前状态

- **项目名称**：`ai-agent-top10`
- **仓库地址**：<https://github.com/wjf1/ai-agent-top10>
- **线上站点**：<https://wjf1.github.io/ai-agent-top10/>（双语支持：英文根路由 `/en/`）
- **项目定位**：每天按 GitHub star 真实增量筛选 Top 10 AI Agent 开源项目，基于 8 个可解释维度加权打分，并生成中英双语通俗定位解读与数据报表。
- **当前发布版本**：`v0.9.2`（2026-10-10 发布，中文页卡片文案语言归属修复 + 10-05 起中文解读回填）
- **当前 Git 分支**：`main`（与远端 `origin/main` 保持同步，工作区 Clean）
- **最新 Release**：[GitHub Release v0.9.2](https://github.com/wjf1/ai-agent-top10/releases/tag/v0.9.2)
- **CI/CD 状态**：GitHub Actions `daily-update` 工作流自动化运行通过（构建耗时 ~25s，全自动部署至 GitHub Pages）。**注意：CI 仓库未配置 `secrets.LLM_API_KEY`**，每日抓取产出的解读为规则兜底版；如需每日新增也有中文一句话解读，需在仓库配置该密钥（详见「五、接力开发指引」）。
- **进行中的计划**：《ai-agent-top10 优化开发方案及实施计划》经 [PLAN.md](./PLAN.md) 可行性清理后共 6 项任务，**已全部处置完毕**：T3.1 / T3.2 / T3.3 / A1 由 v0.9.0 交付，A2 由 v0.9.1 交付；T3.4′ 触发式当前不实施，T2.5 GraphQL 延后保留，另有 7 项前提不成立已删除。当前无待办开发任务，新会话可直接从「新需求规划」切入。

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
| **测试框架** | **Node.js 原生 Test Runner (`node --test`)** | 无需安装 Jest/Vitest，回归测试集运行极快（~200ms，当前 77 项） |
| **评分口径** | **`config.scoringVersion`（当前 2.1.0）** | 日榜与条目均落盘生成时的版本号，读侧据此判断跨期可比性 |

### 常用核心命令速查

```bash
# 1. 依赖安装
npm install

# 2. 本地开发服务器 (默认端口 http://localhost:4321)
npm run dev

# 3. 运行全量单元测试（当前 93 项，跨 5 个测试文件）
npm test

# 4. 执行数据结构完整性与安全门禁校验
npm run validate

# 5. Astro 全量静态站点编译 (输出至 dist/ 目录)
npm run build

# 6. 本地静态预览
npm run preview

# 7. 全流程质量门禁 (测试 + 数据校验 + 全站构建，推送前必跑)
npm run check

# 8. 评分口径重算（只读本地快照，不调用网络；写盘前自动备份）
npm run rescore:safe
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
|   |-- fetch-daily.mjs         # 每日抓取编排主入口（落盘带 scoringVersion / gainCapped）
|   |-- validate-data.mjs       # 数据完整性与 XSS/注入/伪协议质量门禁
|   |-- generate-og.mjs         # [v0.8.0 新增] OG 分享图生成（SVG 模板 + sharp → 1200x630 PNG）
|   |-- backfill-interpretations.mjs # 历史解读回填工具 (--since, --refresh-rules)
|   |-- rescore.mjs             # [v0.7.0 增强] 规则变更离线重算 (--safe, --since-version)
|   `-- lib/                    # 抓取子模块 (github, growth, metrics, interpret, persist, status, interpret-cache)
|-- .rescored-backup/           # [v0.7.0 新增] rescore 写盘前的原文件备份（已 gitignore）
|-- .github/
|   |-- workflows/daily.yml     # 每日 UTC 06:00 抓取 → 校验 → 提交 → 构建部署
|   `-- ISSUE_TEMPLATE/         # [v0.9.0 新增] 数据纠错 / 功能建议 / 项目推荐 + config
|-- src/
|   |-- components/
|   |   |-- RankingPage.astro   # 榜单核心容器 (list-toolbar、说明文案、卡片/表格双视图、趋势标识)
|   |   |-- EntryCard.astro     # 榜单卡片 (Sparkline 趋势线、金银铜牌标、趋势标识、Popover)
|   |   |-- ScoreTrend.astro    # [v0.9.0 新增] 详情页 8 维评分小倍数趋势图（缺失期不补零）
|   |   |-- SearchView.astro    # [v0.9.0 新增] 检索共享 UI（6 种排序 + 3 种预设，静态链接）
|   |   |-- ComparePanel.astro  # 多仓库对比（star 走势绝对值/相对起点 + 维度对比模式）
|   |   |-- ProjectDetail.astro # 项目详情（雷达、趋势、评分趋势、相关推荐、口径标注）
|   |   |-- Sparkline.astro     # 120x32 轻量 SVG 趋势折线图 (近 21 天增量动力)
|   |   |-- Icon.astro          # 16x16 矢量 SVG 图标组件 (替代全站 Emoji)
|   |   |-- Radar.astro         # 自适应 6/8 维交互雷达图
|   |   |-- TrendChart.astro    # 详情页历史 star/fork 趋势图
|   |   |-- ProjectTable.astro  # 紧凑表格视图 (支持多态输入，适应双视图与检索页)
|   |   `-- PeriodSwitch.astro  # 日/周/月周期切换与日期翻页器
|   |-- layouts/
|   |   `-- Base.astro          # 全局主布局 (OG/元标签、防白屏主题脚本、精简导航、页脚)
|   |-- lib/
|   |   |-- periods.ts          # 周期聚合（weekly/monthly）
|   |   |-- scoring.mjs         # 8 维评分引擎
|   |   |-- related.ts          # [v0.8.0 新增] 相关项目相似度与挑选（纯函数）
|   |   |-- score-series.ts     # [v0.9.0 新增] 评分历史序列聚合（缺失期不补零）
|   |   |-- search-view.ts      # [v0.9.0 新增] 排序 / 快捷筛选规格与纯函数
|   |   |-- routes.ts           # 路由与 REPO_URL 集中管理
|   |   `-- ...
|   |-- pages/                  # 中英双语动态路由树 ([...lang]/*；含 search/[...view].astro)
|   `-- styles/
|       `-- global.css          # 全局设计令牌 (Tokens、暗色主题、WCAG 墨色、间距标尺)
|-- tests/
|   |-- pipeline.test.mjs       # 主回归集
|   |-- growth.test.mjs         # 增速模块
|   |-- metrics.test.mjs        # 指标采集
|   |-- periods.test.mjs        # 周期窗口（periods.ts 受构建期 import 限制，见 §四）
|   `-- search-view.test.mjs    # [v0.9.0 新增] 排序 / 预设 / 路径解析
|-- CHANGELOG.md                # 规范更新日志 (遵循 Keep a Changelog)
|-- PLAN.md                     # [v0.8.0 新增] 剩余计划可行性清理版（待办唯一来源）
|-- README.md                   # 中英双语仓库说明与架构特性表
`-- HANDOFF.md                  # [本项目] 接力开发镜像文档
```

---

## 四、最近一轮变更与交付成果 (v0.9.2 · 中文页卡片文案语言归属修复)

修复线上中文页卡片一行「显示英文自述且被截断」的问题，并把 CI 未配置 LLM 期间（2026-10-05 起）产出的 5 天数据回填为 LLM 中文解读。

| 项 | 内容 |
|---|---|
| **根因** | 规则兜底版 `ruleCardLine` 把仓库自述同时写进中英两侧：英文自述进中文页变成整行英文，还被 90 显示单位截断（`Makes your AI agent…The best code is the…`）；徽标 `cardLineTag` 又只比对 `zh` 一侧，中文页的规则状态可能被误标 |
| **修复** | 自述按语言分侧：中文页优先用中文自述、拿不到退回中文方向标签（`方向：Agent 技能、AI Agent、Claude`）；英文页维持自述原文。`cardLineTag(entry, lang, t)` 按当前语言各判各的；徽标说明去掉「未翻译」措辞 |
| **关键改动文件** | `src/lib/interpret.mjs`、`src/lib/display.ts`、`src/components/EntryCard.astro`、`src/lib/data.ts`、`tests/pipeline.test.mjs` |
| **数据回填** | `node scripts/backfill-interpretations.mjs --llm --since=2026-10-05`：5 天 / 50 条经本机网关（`127.0.0.1:9090`）生成 LLM 解读，13 个去重仓库（10 条命中 README 哈希缓存），`interpretationSource` 全部转为 `llm`；`description` 未改动 |
| **缓存策略** | `src/data/snapshots/interpret-cache.json`（本机回填派生缓存）纳入 `.gitignore`，不入库 |

**验证结论**：`npm run check` 全绿（**94/94 测试通过**、数据校验 27 天通过、**740 页**构建含 22 张 OG 图）。测试覆盖：英文自述不进中文页 / 中文自述进中文页 / 截断只发生在英文侧 / 来源徽标按语言判定。

### 上一轮交付记录（v0.9.1 · A2 数据补齐）

本轮**无任何代码变更**：执行 `npm run rescore:safe` 补齐历史日榜的评分口径标记（PLAN.md A2 运维项）。

| 项 | 内容 |
|---|---|
| **重算范围** | 13 天（2026-09-23 至 2026-10-05，130 条记录）→ 口径 **v2.1.0**；文档级与条目级 `scoringVersion` 落盘，并记录 `rescoredAt` 时间戳 |
| **安全跳过** | 10 天早期回填数据（09-13 至 09-22）指标不完整（`partial`），按脚本安全边界跳过——强行重算会把 community / practical / health 误判为缺数据、改坏历史分数，**不跑 `--all`** |
| **备份与熔断** | 原文件自动备份至 `.rescored-backup/`（13 份，已 gitignore）；各天平均 \|Δoverall\| 均低于熔断阈值 25，无熔断触发；分值变化来自 v2.1.0 引擎相对历史口径的规则演进（T1.2 / T1.7 / T2.13 等），属口径对齐的预期结果 |
| **后续** | 2026-10-06 起 `daily-update` 定时抓取自然产出的日榜自带 `scoringVersion`，A2 无需再人工干预 |

**验证结论**：`npm run check` 全绿（**93/93 测试通过**、数据校验 23 天通过、644 页构建含 22 张 OG 图）；git 变动恰好为 13 个日榜文件，无意外波及。

### 本轮仍未完成项

- **`T3.4′` 历史保留策略**：触发式，当前不实施（详见 PLAN.md）。
- **`T2.5` GraphQL 批量查询**：延后保留。
- **CI 侧 LLM 密钥未配置**：每日新增解读仍为规则兜底版（v0.9.2 起中文页显示中文方向标签，不再是英文原文）；配置方法见「五、接力开发指引」的运维建议。

### 历史交付记录

#### v0.9.0 · PLAN.md 首批：评分趋势 / 检索增强 / 社区入口 / 裁剪可观测

依据仓库根目录 [PLAN.md](./PLAN.md) 实施其中的 T3.1 / T3.2 / T3.3 与新增项 A1。**本轮不新增任何运行时依赖**，全部保持纯静态与渐进增强。

##### 交付明细

| 任务 | 内容 | 关键改动文件 |
|---|---|---|
| **T3.2** | 详情页「评分趋势」：8 维小倍数折线。连续在榜 ≥3 期才展示；维度数据量不均时**不补零、不连线**（`forksGrowth`/`activity` 仅 130/230 条有值），缺失格子显示「该维度早期未采集」 | `src/lib/score-series.ts`（新增）、`src/components/ScoreTrend.astro`（新增）、`ProjectDetail.astro`、`project/[date]/[slug].astro` |
| **T3.1** | 检索页排序 0 → **6 种**（累计增量/综合分/热度/创新/生态/Stars），新增 **3 种快捷筛选**（本周新星/生态强者/高完成度），两者可叠加。**排序做成独立静态路由而非 query**——纯静态站构建期读不到 query，挂在 `?sort=` 上会导致无 JS 时排序失效 | `src/lib/search-view.ts`（新增）、`src/components/SearchView.astro`（新增）、`src/pages/[...lang]/search.astro`、`src/pages/[...lang]/search/[...view].astro`（新增） |
| **T3.3** | 页脚「在 GitHub 上反馈 / 贡献」入口（全站可达）+ 三类 issue 模板（数据纠错 / 功能建议 / 项目推荐）与 config | `src/layouts/Base.astro`、`src/lib/routes.ts`（`REPO_URL`）、`.github/ISSUE_TEMPLATE/*`（新增 4 个） |
| **A1** | **`gainCapped` 未落盘**（此前算了但从未写入，实测 0/230 条带该标记，裁剪完全不可观测）：落盘该字段 + schema 可选布尔校验 + CI `::warning` 摘要 + 详情页「已封顶」标注 | `scripts/fetch-daily.mjs`、`scripts/lib/schema.mjs`、`src/lib/display.ts`、`src/lib/data.ts` |

**验证结论**：`npm run check` 全绿（**93/93 测试通过**，新增 `tests/search-view.test.mjs` 4 项；数据校验 23 天通过；**644 页**构建含 +46 排序/预设路由；22 张 OG 图）。构建产物中实测确认：详情页 8 个维度格子与「连续在榜不足 3 期」空态均正确渲染；检索页 6 个排序链接、3 个预设链接齐备。

#### v0.8.0 · Phase 2：口径修复与体验增强


严格依据《ai-agent-top10 优化开发方案及实施计划》Phase 2 实施，并补齐 Phase 1 的三处遗留验收项：

| 任务 | 内容 | 关键改动文件 |
|---|---|---|
| **T2.1** | 对比页新增「维度对比」模式（8 维条形 + 6 项指标卡），模式写入 URL query | `src/components/ComparePanel.astro` |
| **T2.2** | 趋势标识 NEW / 上升 N 位 / 连榜 N 期，取自构建期索引，暗色可读 | `display.ts`、`EntryCard.astro`、`RankingPage.astro` |
| **T2.3** | 详情页相关推荐：3 同类（分类 + topics 相似度）+ 2 同期热门，构建期缓存 | `src/lib/related.ts`（新增）、`aggregate.ts`、`ProjectDetail.astro` |
| **T2.4** | OG 分享图：SVG 模板 + sharp → 1200×630 PNG（22 张）+ 元标签 | `scripts/generate-og.mjs`（新增）、`Base.astro`、`package.json` |
| **T2.5** | 多 token 轮询（GITHUB_TOKEN_1/2）+ 扩展指标分级采集（stale 标记）。**GraphQL 未实现（延后）** | `scripts/lib/github.mjs`、`metrics.mjs`、`fetch-daily.mjs` |
| **T2.7** | `metricsComplete` 由 any 改为 every | `src/lib/periods.ts` |
| **T2.8** | backfill `toProject()` 合并快照扩展指标 | `scripts/backfill-interpretations.mjs` |
| **T2.9** | `dailyGain` 按 requestedDays 标准化 | `src/lib/periods.ts` |
| **T2.10** | search 额度独立限流检查，且不污染 core 余额 | `scripts/lib/github.mjs` |
| **T2.11** | 快照内部结构校验（stars 数值 / metrics 关键字段 / partial 布尔） | `scripts/validate-data.mjs` |
| **T2.12** | 测试拆分 4 个文件 + 覆盖率脚本；growth 74.9% / metrics 90.4% 行覆盖 | `tests/*.test.mjs`、`package.json` |
| **T2.13** | `growthRate` 分母改为基线 star 存量 | `src/lib/periods.ts` |
| **T2.14** | LLM 输出显式结构校验（entries 必须为数组） | `scripts/lib/interpret.mjs` |
| **Phase 1 补漏** | T1.3 解读服务前置检查（`LLM_REQUIRED` 门控）、T1.4 分页 5 页 + 异常降级、T1.8 口径标注 UI | workflow、`metrics.mjs`、`display.ts`、`ProjectDetail.astro` |

**验证结论**：`npm run check` 全绿（**89/89 测试通过**，数据校验 23 天通过，598 页构建 + 22 张 OG 图）。

#### v0.8.0 未完成项（明确延后，非缺陷）

- **T2.5 GraphQL**：分级采集已削减大部分调用，GraphQL 边际收益下降且引入第二套 API 面，延后至 Phase 3。
- **T2.6 快照分片**：计划风险节明确指出应与 T3.4 一并推进；且读者侧需先完成 T3.8（编译期 import → 运行时读取），否则分片会直接打断构建。
- **T2.12 的 periods.ts 覆盖率**：`periods.ts` 静态 import 构建产物（index.json / snapshots），Node 测试运行器无法加载，`tests/periods.test.mjs` 目前覆盖其依赖的纯时间窗口逻辑；完整 fixture 测试待 T3.8 改造后补齐。

---
#### v0.7.0 · Phase 1：止血与可信度

本轮严格依据《ai-agent-top10 优化开发方案及实施计划》**Phase 1（T1.1–T1.8，8 项 P0）**实施，全部完成并通过门禁：

| 任务 | 内容 | 关键改动文件 |
|---|---|---|
| **T1.1** | README 版本号由 `0.2.0` 修正为当前版本，新增 shields.io 徽章与数据覆盖范围说明；配置文档同步 | `README.md` |
| **T1.2** | `ruleCons` 实际判定 `hasHomepage`/`hasDocs`，不再误报「缺少官网」；`fitFor` 改为 category + topics 双重映射（8 类话题定向，重叠率 <30%） | `src/lib/interpret.mjs`、`scripts/lib/metrics.mjs` |
| **T1.3** | LLM 解读新增备用 provider 自动切换 + README 哈希缓存（`interpret-cache.mjs`）+ 整轮降级 `::error` 注解 | `scripts/lib/interpret.mjs`、`scripts/lib/interpret-cache.mjs`、`scripts/lib/status.mjs`、`.github/workflows/daily.yml` |
| **T1.4** | contributors 改为分页采集（`contributorPages` 默认 2 页/上限 200），区分「数完 / 截断」（`contributorsCapped`），不可测时返回 `null` 而非 `0` | `scripts/lib/metrics.mjs`、`config/scoring.json` |
| **T1.5** | `writeJson` 改为「同目录临时文件 + renameSync」原子写，异常清理临时文件 | `scripts/lib/persist.mjs` |
| **T1.6** | 危险块级元素（script/style/iframe/svg/math/form…）**连同内容整块剥离**；文本层伪协议断链；`validate-data.mjs` 增加伪协议拦截并扩展检查字段 | `src/lib/sanitize.mjs`、`scripts/validate-data.mjs` |
| **T1.7** | 超大仓库增速不再直接跳过：覆盖率不足时给出**保守下界**（观测条数、不外推）并标记 `gainUnreliable`/`gainLowerBound`，UI 显示「保守下界」 | `scripts/lib/growth.mjs`、`src/lib/display.ts`、`src/lib/data.ts`、`scripts/lib/schema.mjs` |
| **T1.8** | 新增 `config.scoringVersion`（2.1.0），日榜/条目落盘版本号；`rescore --safe` / `--since-version` + `.rescored-backup/` 备份 + 变动熔断；周期榜混用多版本时页面提示 | `config/scoring.json`、`scripts/rescore.mjs`、`src/lib/periods.ts`、`src/components/RankingPage.astro` |

**验证结论**：`npm run check` 门禁 100% 通过（**77/77 测试通过**，较上轮新增 15 项回归；数据校验 23 天通过；598 个静态页面构建成功）。

---

## 五、接力开发指引与后续演进建议 (Next Steps)

> **待办清单已迁移至仓库根目录 [PLAN.md](./PLAN.md)（可行性清理版）**。
> 该文档基于 2026-10-05 的实测数据逐条核验了原《优化开发方案及实施计划》Phase 3 的每个前提，
> 删除了 7 项前提不成立的任务、合并 3 项、并新增 2 项实测暴露的真问题。**后续开发请以 PLAN.md 为准，不要直接照 PDF 的 Phase 3 清单实施。**

一句话摘要：

| 处置 | 任务 |
|---|---|
| **已完成（v0.9.0）** | T3.1 搜索增强、T3.2 评分历史追踪、T3.3 社区参与入口、A1 gainCapped 落盘 |
| **已完成（v0.9.1）** | A2 `scoringVersion` 历史补齐（`rescore:safe` 重算 13 天 → v2.1.0；10 天 partial 数据按安全设计保留原口径） |
| **已完成（v0.9.2）** | 中文页卡片文案语言归属修复（自述按语言分侧 + 徽标按语言判定）+ 10-05 至 10-09 中文解读回填 |
| **删除（前提不成立）** | T3.5 / T3.6 / T3.7 / T3.8 / T3.9 / T3.11 / T2.6 |
| **合并重写** | T3.4 / T3.5 / T3.6 → T3.4′ 历史保留策略（触发式，当前不实施） |
| **延后保留** | T2.5 GraphQL 批量查询 |

**运维建议（非代码任务）**：GitHub 仓库未配置 `secrets.LLM_API_KEY`，CI 每日新增的解读是规则兜底版（卡片一行显示中文方向标签）。若希望每日新增也有 LLM 中文一句话解读，可参照本机 `config/scoring.json` 的 `interpretation` 结构，在仓库配置 `secrets.LLM_API_KEY`（或 `LLM_FALLBACK_API_KEY`）与 `vars.LLM_BASE_URL` / `vars.LLM_MODEL` 指向一个公网可达的 OpenAI 兼容服务；未配置时自 v0.9.2 起中文页也不会再出现英文原文。

核心判据：当前 27 天数据 / **740 页** / 产物约 40MB，容量红线在 **700 天以上**；原计划假设的「90 天即需分层」高估了规模 1–2 个数量级。

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
