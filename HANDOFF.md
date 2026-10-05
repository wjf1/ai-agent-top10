# 项目接力开发文档 · HANDOFF

本文档旨在为跨会话、跨 Agent、多人协同开发提供完整、清晰、可立即执行的上下文与工程状态镜像。任何新会话接手本项目时，**应优先通读本文档**。

---

## 一、项目概况与当前状态

- **项目名称**：`ai-agent-top10`
- **仓库地址**：<https://github.com/wjf1/ai-agent-top10>
- **线上站点**：<https://wjf1.github.io/ai-agent-top10/>（双语支持：英文根路由 `/en/`）
- **项目定位**：每天按 GitHub star 真实增量筛选 Top 10 AI Agent 开源项目，基于 8 个可解释维度加权打分，并生成中英双语通俗定位解读与数据报表。
- **当前发布版本**：`v0.8.0`（2026-10-05 发布，Phase 2 口径修复与体验增强）
- **当前 Git 分支**：`main`（与远端 `origin/main` 保持同步，工作区 Clean）
- **最新 Release**：[GitHub Release v0.8.0](https://github.com/wjf1/ai-agent-top10/releases/tag/v0.8.0)
- **CI/CD 状态**：GitHub Actions `daily-update` 工作流自动化运行通过（构建耗时 ~25s，全自动部署至 GitHub Pages）。
- **进行中的计划**：《ai-agent-top10 优化开发方案及实施计划》共 3 个 Phase、33 项任务；**Phase 1（T1.1–T1.8）与 Phase 2 主体（T2.1–T2.14，其中 T2.5 的 GraphQL 与 T2.6 明确延后）已完成并发布**，Phase 3（T3.1–T3.11）待推进。

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

# 3. 运行全量单元测试（当前 89 项，跨 4 个测试文件）
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
|   |-- fetch-daily.mjs         # 每日抓取编排主入口（落盘带 scoringVersion）
|   |-- validate-data.mjs       # 数据完整性与 XSS/注入/伪协议质量门禁
|   |-- backfill-interpretations.mjs # 历史解读回填工具 (--since, --refresh-rules)
|   |-- rescore.mjs             # [v0.7.0 增强] 规则变更离线重算 (--safe, --since-version)
|   `-- lib/                    # 抓取子模块 (github, growth, metrics, interpret, persist, status, interpret-cache)
|-- .rescored-backup/           # [v0.7.0 新增] rescore 写盘前的原文件备份（已 gitignore）
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

## 四、最近一轮变更与交付成果 (v0.8.0 · Phase 2：口径修复与体验增强)

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

### Phase 2 未完成项（明确延后，非缺陷）

- **T2.5 GraphQL**：分级采集已削减大部分调用，GraphQL 边际收益下降且引入第二套 API 面，延后至 Phase 3。
- **T2.6 快照分片**：计划风险节明确指出应与 T3.4 一并推进；且读者侧需先完成 T3.8（编译期 import → 运行时读取），否则分片会直接打断构建。
- **T2.12 的 periods.ts 覆盖率**：`periods.ts` 静态 import 构建产物（index.json / snapshots），Node 测试运行器无法加载，`tests/periods.test.mjs` 目前覆盖其依赖的纯时间窗口逻辑；完整 fixture 测试待 T3.8 改造后补齐。

---
## 四、最近一轮变更与交付成果 (v0.7.0 · Phase 1：止血与可信度)

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

依据《ai-agent-top10 优化开发方案及实施计划》，Phase 1 已交付，后续按下列顺序推进（详见 PDF 与仓库内计划）：

### Phase 2（T2.1–T2.14，P1）
| 任务 | 内容 | 关键切入点 |
|---|---|---|
| **T2.1** | 对比工具（ComparePanel）移动端体验：勾选列表搜索过滤 + 指标对比维度扩展 | `src/components/ComparePanel.astro`、`src/pages/[...lang]/compare.astro` |
| **T2.2** | 榜单新鲜度标记：NEW 徽标、窗口内 N 期上榜次数 | `EntryCard.astro`、`RankingPage.astro`、`display.ts` |
| **T2.3** | 详情页「同类项目」推荐：category + topics 相似度 | `ProjectDetail.astro`、`src/lib/aggregate.ts` |
| **T2.4** | OG 社交分享图自动生成（SVG→PNG）+ meta 标签 | `Base.astro`、`scripts/generate-og.mjs`、`astro.config.mjs` |
| **T2.5** | GitHub API 韧性：多 token 轮换、候选池分页、GraphQL 批量查询 + REST fallback | `scripts/lib/github.mjs`、新增 `graphql.mjs` |
| **T2.6** | 快照分片存储（metrics / stars 按仓库或月份拆分） | `persist.mjs`、新增 `migrate-snapshots.mjs` |
| **T2.7** | `metricsComplete` 从 any 改为 every | `src/lib/periods.ts:212` |
| **T2.8** | backfill 的 `toProject()` 补齐 metrics 字段 | `scripts/backfill-interpretations.mjs` |
| **T2.9** | `dailyGain` 按 coverageDays 归一 | `src/lib/periods.ts:189-190` |
| **T2.10** | Search API 独立限流余量检测（`searchRemaining`） | `scripts/lib/github.mjs:96` |
| **T2.11** | validate 校验快照数值类型 | `scripts/validate-data.mjs:84-96` |
| **T2.12** | 拆分测试为 `tests/growth.test.mjs` / `metrics.test.mjs` / `periods.test.mjs` | `tests/` |
| **T2.13** | `growthRate` 基线改用真实 baselineStars | `src/lib/periods.ts:180` |
| **T2.14** | LLM 返回结构容错（entries 缺失/异常时不崩） | `scripts/lib/interpret.mjs:82-85` |

### Phase 3（T3.1–T3.11，P1/P2）
检索页增强与 JS 体积治理（T3.1）、详情页趋势/雷达增强（T3.2）、Base 布局与 ISSUE_TEMPLATE（T3.3）、daily 归档分层压缩（T3.4）、归档页 404 fallback（T3.5）、数据导出增强（T3.6）、`saveIndex` 增量优化（T3.7）、periods 导入瘦身（T3.8）、`buildPoolContext` 性能（T3.9）、日志分级（T3.10）、`capWeeklyGain` 小仓库特例（T3.11）。

> **建议切入点**：Phase 2 的 T2.5 / T2.6 属于架构性改动且相互耦合（GraphQL 与快照分片都影响 `persist` / `metrics`），建议同一会话内连续推进；T2.12 的测试拆分可最先做，为后续改动提供更细的回归保护。

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
