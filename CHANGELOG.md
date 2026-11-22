# 变更记录 · Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与[语义化版本](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

### 新增

- **评分方法论公开页（`/scoring/` 与 `/en/scoring/`）**：8 维加权打分透明化——权重表（双语名 +
  权重 + 说明 + 权重条）、公式规则（系数 × 归一化因子、分位 / 对数归一、MissFactor、剔除重归一）、
  每维度公式参数原样展示、当日榜第一名真实计算示例（构建期从 `scoring.json` 与最新 daily 数据
  读取，无手抄数值，页面复算与榜单 `overall` 一致）与 `scoringVersion` 版本口径。导航栏新增入口，
  「数据导出」页的 `score_*` 字段说明改为内链方法论页。对标 artificialanalysis.ai 的方法论公开做法。
- **入选徽章（Featured badge）**：新增自托管静态徽章 `docs/badge.svg`（无第三方服务依赖）与回挂指引 `docs/backlink.md`（含入选确认方式与一行 markdown 用法），README 中英双节新增「入选徽章 / Featured badge」——对标 trendshift / star-history 的「入选项目回挂徽章」增长循环，起步版。
- **sitemap.xml 生成（`@astrojs/sitemap` 集成）**：740 页双语站点此前无 sitemap，搜索引擎只能靠内链爬取。集成后构建产出 `sitemap-index.xml` + 分片 sitemap（URL 按构建期 `BASE` 自动带 `/ai-agent-top10` 前缀），并新增 `public/robots.txt` 声明站点地图地址。
- **每日巡检失败自动开 issue（`daily.yml` 新增 `alert` job）**：fetch / build 任一失败时自动创建当日失败 issue（含 Actions 日志链接，同日防重复）——替代此前的静默失败（2026-11-10 的失败靠下一次成功才被发现），对齐 coding-plan-radar 的「失败可见」机制。
- **自定义 404 页（`src/pages/404.astro`）**：此前 404 流量落到 GitHub Pages 默认裸页。新增页面静态构建输出 `dist/404.html`（部署根，Pages 自动用作全站 404），复用 Base 布局与既有设计令牌。双语采用单页并列——Pages 的 404 是部署根单一文件，`/zh/…` 与 `/en/…` 下的缺失路径回落同一份文件、无法按语言分流，故中文块在前英文块在后（英文块标 `lang="en"`），各自带「回到首页 / 归档页 / 检索页」三条引导链接。
- **JSON-LD 结构化数据 + hreflang 互指（SEO）**：`Base.astro` 新增可选 `jsonLd` prop，head 注入 `application/ld+json`（序列化时 `<` 转义 `\u003c`，防数据内嵌 `</script>` 逃逸，数据虽为构建期产物仍纵深防御）。榜单页与首页（共用 RankingPage）输出 `ItemList`：`position` / `name` / `url` 全部取自构建期 entries，无硬编码数值，空态不发。项目详情页输出 `Article`——详情页主体是构建期生成的双语解读与 8 维评分分析（编辑性内容，成文日期即榜单日期），Article 语义匹配且是 Google 文档化最充分的富结果类型；Dataset 面向可下载数据集的描述页（`distribution` 等字段），本页并非数据集页（数据下载入口在 `/export/`），故不选。head 同时新增 hreflang 互指：self 与 canonical 同源、对侧语言复用 `langHref`（各页经 `routes.ts` 拼的对侧同视图 URL），中英两侧 URL 齐备时整组输出 `zh-CN` / `en` / `x-default`（指向默认语言 zh）；顺带修正 search 视图页 `langHref` 丢失视图路径的问题（此前从 `/search/s/stars/` 切语言会丢排序条件，hreflang 也会指向未过滤页）。

### 变更

- **PeriodSwitch 弃用 tablist/tab 语义（ARIA）**：日 / 周 / 月切换器原用 `<div role="tablist">` + `<a role="tab" aria-selected>`，但页面并无对应 tabpanel、也没有方向键交互，不符合 ARIA APG 对 tab 模式的结构要求，读屏用户会得到"有三个标签页"的错误预期。改为普通链接 + `aria-current="page"` 标记当前项（容器保留 `role="group"` + `aria-label` 提供可及名称），与 SearchView 排序 / 筛选 chips 的既有做法一致。
- **无 JS 暗色模式兜底（`global.css`）**：暗色令牌此前只由 Base.astro 内联脚本写 `data-theme` 驱动，禁用 JS 时系统深色偏好用户永远看到浅色。新增 `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }` 兜底块——有 JS 时 `:not([data-theme])` 恒不生效（脚本异常路径也会写 light），主题决策仍以 `data-theme` 为准。令牌块原生 CSS 无法跨选择器复用、项目又无 PostCSS/Sass 构建器，取复制方案并以 `DARK-TOKENS` 注释标记两处需同步，主题切换按钮图标状态一并兜底。同时 `:root` 与 `[data-theme="dark"]` 分别补 `color-scheme: light / dark`，滚动条与原生表单控件跟随主题渲染。

### 修复

- **LLM 解读调用重试 + 超时放宽（`scripts/lib/interpret.mjs`）**：火山方舟端点从 GitHub Actions 海外 runner 访问普遍偏慢，单次 45s 超时且无重试，频繁触发 "This operation was aborted" 使整天解读回落规则模板（11-14 实测仍复现）。默认超时放宽至 90s，主 / 备 provider 失败后按指数退避重试（`retries` 默认 2 次、`retryBaseMs` 默认 8s），瞬时故障自愈后才真正回落规则版。
- **接入 Pollinations.AI 作为免费备用解读 provider**：dispatch 实跑证实火山方舟国内端点从 Actions 海外 runner 直连 `fetch failed`（非慢、是不可达）；GitHub Models 已于 2026-07-30 完全退役（端点恒返 200 "OK" 非 JSON）不可用作兜底。最终接入开源 AGPL 的 **Pollinations.AI**（匿名无鉴权、限速 45s/IP，secret 只需任意非空占位值）：GPT-OSS 20B 为 reasoning 模型，10 条目解读实测必须 `reasoning_effort: "low"`（否则 `output_token_limit_exceeded`）。为此 `interpret.mjs` 做三处增强，主 provider 行为不变：① `resolveProvider` 备用分支不再回落主 provider 的 `LLM_BASE_URL` / `LLM_MODEL` 环境变量（**原 bug**：备用通道继承主端点，Pollinations 配置被完全架空）；② provider 级 `extraBody` 参数透传与 fallback 专属 `retryBaseMs`（45s，重试跨过限速窗口）；③ 备用通道**分批请求**（`fallback.chunkSize=3`、`interBatchDelayMs=45s`）——匿名档单次输出上限实测只产出 1/10 条目，分批后逐批合并、批失败不阻塞后续，且**缺失条目自动补一轮重跑**（补缺前同样跨过限速窗口；实测从 8/10 补到 **10/10**）。主 provider 仍为火山方舟（本机 / 国内环境优先）。`npm test` **97/97**（新增 extraBody 透传、分批合并与缺口补跑用例）。
- **全站 canonical 固定指向语言首页（SEO）**：`Base.astro` 的 canonical 硬编码为语言首页路径（`${B}/${lang === "en" ? "en/" : ""}`）且不接收页面级参数，1700+ 日榜 / 周月榜 / 项目详情 / 检索 / 分类 / 话题等页面的 `<link rel="canonical">` 全部指向首页（实测 `dist/day/2026-11-15/index.html` 的 canonical 指向站点根），搜索引擎会把整站榜单页视为首页的重复内容。`Base` 新增可选 prop `canonicalPath`：传入时用它拼 canonical，未传保持回落语言首页（首页默认视图不传）。日榜 / 周榜 / 月榜（含指定窗口版）、项目详情（`/project/<date>/<slug>/`）、归档、检索（含排序 / 快捷筛选视图）、分类榜、话题页、对比、导出、评分方法论各视图全部传入自身路径，统一经 `src/lib/routes.ts` 辅助函数拼接（自带 BASE 前缀与 `/en/` 语言前缀、保留尾斜杠）；构建后抽查日榜 / 详情 / 检索 / 周榜等中英页面 canonical 均指向各自真实 URL。
- **暗色模式「accent 底 + 白字」对比度 2.95:1 不达 WCAG AA**：暗色令牌 `--accent: #8b8bf5` 与写死的白色文字对比度实测仅 **2.95:1**（AA 要求 4.5:1），涉及 `.btn`、`PeriodSwitch` 的 `.seg.active`、`SearchView` / `ComparePanel` 的 `.fchip.active`、`EntryCard` 的 `.trend-badge.tb-new`（引用了未定义的 `--accent-ink` 恒回落 `#fff`）与 `.skip-link` 共 6 处。设计令牌表新增成对变量 **`--accent-contrast`**（浅色 `#ffffff`、对比 6.29:1；暗色 `#14161d`、对比 6.12:1，均 AA 通过，令牌注释写明实测值）并补上真实存在的 **`--accent-ink`**（与 accent 底文字色同义，指向 `--accent-contrast`）；上述 6 处统一改为引用令牌。顺带修复 Radar tooltip 同类问题：硬编码白字在暗色反转底色（`--tip-bg: #e8e9f2`）上原对比 1.21:1 完全不可读，`.radar-tip b` 改用 `var(--tip-ink)`（14.94:1），数值强调色在暗色下换用浅色 accent 深值（1.65:1 → 5.20:1）。
- **榜单空态文案按 period 分支（`RankingPage.astro`）**：空态说明此前硬编码为周 / 月榜口径（「需要至少一个完整窗口的历史快照」），日榜条目为空时口径不符、有误导；且空态标题在日榜下会误标成「周榜」（原三元表达式漏了 daily 分支）。现按 `period` 分支：日榜显示快照缺失 / 当日无入选项目的说明（`data.ts` 新增 `dailyEmptyNote`），周期榜维持窗口积累文案（`periodEmptyNote` 入 strings）；空态标题统一走 `periodLabel`。
- **卡片视图偏好首屏闪换（FOUC）**：保存了「表格视图」的用户每次进页都先渲染卡片、再由打包后的模块脚本切走，首屏可见明显的视图闪换。新增 `is:inline` 脚本置于两个视图容器之后，HTML 解析到该处即同步执行（先于首次绘制），读 localStorage 直接落初始视图与按钮 `aria-pressed` 状态——模式对齐 Base.astro 的主题前置脚本；原模块脚本保留，负责点击交互并对初态做幂等兜底。

### 变更

- **快照损坏硬失败 + 校验门禁可测化（后端设计专项分析 P1/P2 逐项）**：① `persist.mjs` 的 `readJson` 对"文件存在但解析失败"从 warn + 回退空对象改为**硬失败抛错**——此前一次 JSON 损坏会让 `saveSnapshots` 用残缺数据整文件覆写，静默清空历史并 commit 进仓库；现在 CI 变红 → alert job 开 issue，数据可从 git 历史找回（新增 T1.5b 用例钉住）。② validate-data 的门禁逻辑（index 一致性 / stars / metrics 快照类型 / XSS 与伪协议扫描）从 CLI 主流程提取为 `scripts/lib/validate-core.mjs` 纯函数，新增 `tests/validate-core.test.mjs` **7 用例**（好数据零问题 / 各类坏数据被拦）——此前门禁自身回归时 CI 不会变红。③ 主 provider **部分成功**（如 10 条只回 2 条）时也让免费备用 provider 补缺（复用现有分批 + 缺口补跑机制）——此前只有全败才切备用，部分成功时其余条目直接落规则版。④ workflow 全部 actions 从浮动 tag 改 **SHA pin**（checkout/setup-node v7、configure-pages v5、upload-pages-artifact v3、deploy-pages v4，各带版本注释）；fetch job 加 `actions/cache` 滚动缓存解读文件 `interpret-cache.json`（此前已 gitignore，CI 每日全量冷跑 LLM）。⑤ 删除无引用的死配置 `api.maxTotalBackoffMs`。**核实后跳过**：GitHub 请求的 429 已尊重 `Retry-After` 与 `x-ratelimit-reset`（`github.mjs` 既有实现）；README 无 Node 版本声明段，版本口径漂移不成立。
- **验证**：`npm test` 全绿（validate-core 7/7、pipeline 78/78 含新增 T1.5b）；`npm run validate` 真实数据 70 天 / 29 项目通过；YAML 逐 job 权限与 SHA 断言通过。

### 安全

- **CI 消除 GITHUB_TOKEN 外发第三方端点（`daily.yml` / `scripts/lib/interpret.mjs`）**：备用解读服务的 key 原写法为 `secrets.LLM_FALLBACK_API_KEY || github.token`——secret 未配置时会把带 `contents: write` / `pages: write` 权限的仓库令牌作为 Bearer 头 POST 给第三方匿名端点（Pollinations，且该服务本就无需真 key，config 注释明言「只需任意非空占位值」）。改为回落字面 `'anonymous'` 占位值：fallback 功能不变、令牌外发路径清零，`github.token` 仅保留官方 GitHub API 用途（抓取数据、失败开 issue）。`interpret.mjs` 备用 provider 密钥同步收紧：只认 `LLM_FALLBACK_API_KEY` 与 config 显式 `apiKeyEnv`，绝不回落主密钥 `LLM_API_KEY`（此前若 config 未写 apiKeyEnv，会把主服务密钥发往备用第三方端点）。同时 workflow 权限按 job 最小化：顶层收敛为 `contents: read`（原为 contents / pages / id-token / models 全量声明），fetch job 单独 `contents: write`（提交数据）、build job 单独 `pages: write` + `id-token: write`，移除无用且误导的 `models: read`（fallback 端点是 Pollinations 非 GitHub Models）；三处 `npm ci || npm install` 改为 `npm ci` 硬失败，lockfile 不同步不再静默降级为未验证依赖版本。

### 验证

- `npm test` **94/94 通过**；`npm run check`（test + validate + build）通过，构建产物含 `sitemap-index.xml` 且 URL 前缀正确（线上 `sitemap-index.xml` 已 200）。
- dispatch 实跑：重试链路按设计退避（retry 1/2 → 8s → retry 2/2 → 16s）、主备切换正常触发；Pollinations 备用通道经本机端到端实测（10 条目完整 JSON、34.5s、finish stop），云端 dispatch 结果见后续 run 记录。`npm test` **95/95**（新增 extraBody 透传用例）。
- **SEO / 无障碍修复轮验证**：`npm test` **96/96 通过**（含 LLM 重试退避的真实等待，全量约 7 分钟）；`npm run build` 通过（**1722 页** + 22 张 OG 图）。canonical 抽查：日榜 / 项目详情 / 检索（含 `/search/s/stars/`、`/search/p/rising/` 视图）/ 周榜 / 月榜 / 归档 / 分类 / 话题 / 对比 / 导出 / 评分方法论的中英页面均指向各自真实 URL，首页保持语言首页（`/` 与 `/en/`）；`dist` 落盘确认 `.seg.active` / `.fchip.active` / `.btn` / `.skip-link` / `.tb-new` 全部引用 `--accent-contrast`（暗色 `#14161d`、浅色 `#ffffff`），`aria-current="page"` 生效且全站无 `role="tablist"` / `role="tab"` 残留。

---

## [0.9.2] — 2026-10-10

修复中文页卡片一行「显示英文自述且被截断」的问题。规则兜底版把仓库自述同时写进中英两侧，而英文自述进中文页既读不通、又会被 90 显示单位截断（如 `Makes your AI agent think like the laziest senior dev in the room. The best code is the…`）。CI 未配置 LLM 密钥，2026-10-05 起连续 5 天产出的日榜全部命中该问题。

### 修复

- **仓库自述按语言分侧（`ruleCardLine`）**：自述只出现在读得懂它的语言那一侧 —— 中文页优先用中文自述，拿不到就退回中文方向标签（如「方向：Agent 技能、AI Agent、Claude」）；英文页维持自述原文。此前两侧共用同一段英文自述，中文页因此出现整行英文并被截断。
- **卡片来源徽标按语言判定（`cardLineTag`）**：新增 `lang` 参数，英文页的英文自述仍标「仓库自述」，中文页的方向标签标「规则生成」，不再只比对 `zh` 一侧而误判；徽标说明去掉「未翻译」措辞（中文页已不存在未翻译内容）。
- **10-05 至 10-09 中文解读回填（数据）**：5 天、50 条记录经本机网关重新生成 LLM 解读（13 个去重仓库，其中 10 条命中 README 哈希缓存；`description` 字段未改动），中文页卡片恢复为 45 字中文一句话（如「让 AI 编码助手少写代码的技能：先读现有代码，能复用就不新写」）。
- **解读缓存不入库**：`src/data/snapshots/interpret-cache.json` 是本机回填的派生缓存，按 README 哈希复用，纳入 `.gitignore`。

### 验证

- `npm test` **94/94 通过**（改写 3 项、新增 1 项）：覆盖「英文自述不进中文页」「中文自述直接进中文页」「截断只发生在英文侧」「来源徽标按语言判定」。
- `npm run validate` 通过（27 天日榜 / 18 个项目）。
- `npm run build` 通过：**740 页** + 22 张 OG 图。
- 回填抽查：10-05 至 10-09 全部 50 条 `interpretationSource` 为 `llm`，中文卡片行为完整中文句子。

---

## [0.9.1] — 2026-10-06

依据 [PLAN.md](PLAN.md) A2（运维项）完成 `scoringVersion` 历史补齐。**本轮无任何代码变更**，仅数据与文档。

### 变更（数据）

- **历史日榜补齐评分口径标记（A2）**：执行 `npm run rescore:safe`，将 13 天（2026-09-23 至 2026-10-05，共 130 条记录）重算至当前口径 **v2.1.0**，文档级与条目级 `scoringVersion` 全部落盘并记录 `rescoredAt`。此前 23 天数据中 0 天带该字段，「跨口径提示」只有「历史口径（未知版本）」一种表现。
  - 重算前原文件自动备份至 `.rescored-backup/`（13 份，已 gitignore），支持整体回滚。
  - **10 天早期回填数据（2026-09-13 至 09-22）按安全设计跳过**：其指标不完整（`partial`），强行重算会把 community / practical / health 误判成缺数据、改坏历史分数。这些日期保持回填时口径，由周期榜的跨口径提示如实标注。
  - 重算后综合分平均变动均在熔断阈值（平均 |Δoverall| ≤ 25）内，无熔断触发；分值变化来自 v2.1.0 引擎相对历史口径的规则演进（T1.2 ruleCons 修正、T1.7 保守下界、T2.13 增速分母改基线等），属于口径对齐的预期结果。
- 今日（2026-10-06）起由 `daily-update` 定时抓取自然产出的日榜自带 `scoringVersion`，无需再人工干预。

### 验证

- `npm run check` 全绿：**93/93 测试通过**、数据校验 23 天通过、644 页构建 + 22 张 OG 图。
- 落盘实测：文档级 `scoringVersion: "2.1.0"`、条目级标记与 `rescoredAt` 均正确写入；git 变动恰好为 13 个日榜文件。

---

## [0.9.0] — 2026-10-05

依据 [PLAN.md](PLAN.md)（对原方案 Phase 3 做过可行性清理后的版本）实施其中的 **T3.1 / T3.2 / T3.3 与新增项 A1**。本轮不新增任何运行时依赖，全部功能保持纯静态与渐进增强。

### 新增（产品能力）

- **评分历史追踪（T3.2）**：详情页新增「评分趋势」—— 8 个维度各一张迷你折线（小倍数图），展示该项目自上榜以来的评分变化，标注最新分值与首末期差值。
  - 只在**连续在榜 ≥3 期**时展示；不足则显示说明性空态，而不是拿 2 个点硬画一条「趋势」。
  - 维度数据量不均时**不补零、不连线**：`forksGrowth` / `activity` 是后来才引入的维度（230 条记录中仅 130 条有值），缺失期直接跳过，对应格子显示「该维度早期未采集」。
- **检索增强（T3.1）**：排序由 0 种增加到 **6 种**（累计增量 / 综合分 / 热度 / 创新 / 生态 / Stars），新增 **3 种快捷筛选**（本周新星 / 生态强者 / 高完成度），且排序与预设可叠加。
  - **实现方式刻意选型**：排序与预设做成**独立静态路由**（`/search/s/<sort>/`、`/search/p/<preset>/`、两者可组合），而不是 `?sort=` query。纯静态站点在构建期读不到 query——若挂在 query 上，无 JS 时点击排序只会重新加载同一份 HTML，排序等于失效。改用真实路径后整页跳转即生效，**关闭 JS 完全可用**，且链接可直接分享。默认视图不进路径，避免同一内容出现两条 URL。
- **社区参与入口（T3.3）**：页脚新增「在 GitHub 上反馈 / 贡献」链接（全站可达）；新增 `.github/ISSUE_TEMPLATE/` 三类模板（数据纠错 / 功能建议 / 项目推荐）与 `config.yml`，模板内含候选池入选条件、纯静态约束等前置说明，减少无效 issue。

### 修复（可观测性）

- **`gainCapped` 未落盘（A1）**：`capWeeklyGain` 的裁剪结果此前算了但从未写入日榜文件（实测 0/230 条带有该标记）。一旦真的发生裁剪，站点与后续分析都无从察觉——原计划 T3.11 想统计的「capped 比例」在当前数据结构下根本取不到。
  - `fetch-daily.mjs` 落盘 `gainCapped`；`schema.mjs` 校验其为可选布尔；触发裁剪时输出 `::warning` 摘要；详情页对该条目标注「已封顶」并说明真实增量可能更高。

### 文档

- 新增 [PLAN.md](PLAN.md)：对原《优化开发方案及实施计划》Phase 3 逐条核验可行性的清理版，删除 7 项前提不成立的任务、合并 3 项、新增 2 项，并记录了「`largeRepoStarThreshold` 复核后确认正确、勿改」的结论。
- `HANDOFF.md` 待办章节改为指向 PLAN.md，避免两份计划并存产生分歧。

### 测试

- 新增 `tests/search-view.test.mjs`（4 项），覆盖排序种类数、降序方向、缺失分数排最后、三种预设的过滤语义、路径构建与解析（含非法值回落）。测试总数 89 → **93**。
- 评分趋势与检索视图在构建产物中实测验证：详情页 8 个维度格子与空态均正确渲染；644 页构建通过。

---

## [0.8.0] — 2026-10-05

依据《ai-agent-top10 优化开发方案及实施计划》Phase 2（T2.1–T2.14）实施。本轮聚焦「口径修复 + 体验增强 + 采集效率」：修正三处会让周期分位与增长率失真的口径问题，补齐趋势标识、相关推荐、维度对比与社交分享图，并把扩展指标的采集降频以削减 API 预算。同时补齐 Phase 1 的遗留验收项。

### 修复（口径与正确性）

- **周期榜 `metricsComplete` 语义错误（T2.7，P1-C5）**：此前用 `any`（只要有一个项目指标完整就为真），会让「部分项目缺指标」的榜单被误报为完整。改为 `records.every(...)`，语义变为「所有入选项目都有完整指标」。
- **`dailyGain` 口径不一致（T2.9，P1-C7）**：此前按各期不同的 `coverageDays` 做分母，窗口覆盖天数不同的项目在 heat 维度上分位不可比。统一改为按**请求窗口** `requestedDays` 标准化。
- **`growthRate` 分母错误（T2.13，P1-C11）**：此前分母是**当前** star 总量，不符合标准增长率定义。改为**基线** star 存量；`forksGrowthRate` 同步改用基线 fork 数。
- **backfill 解读字段缺失（T2.8，P1-C6）**：`toProject()` 只映射了核心指标，导致回填出的 highlights / cons 比原始抓取少一大截（例如永远误报「缺少官网」）。现合并快照中的扩展指标（`licensePermissive` / `hasDocs` / `hasHomepage` / `hasExamples` / `ageDays` / `orgVerified` / `ownerType` / `downloadsSignal`）。
- **LLM 返回结构未校验（T2.14，P1-C12）**：`parsed.entries ?? []` 会把结构错误静默吞掉、产出 0 条。现显式要求 `entries` 为数组，否则记日志并回落规则版；同时对非 JSON 响应单独兜底。
- **两处 Phase 1 验收补漏**：
  - **解读服务前置检查（T1.3）**：workflow 新增前置检查步骤。默认输出 `::warning` 并继续；把仓库变量 `LLM_REQUIRED` 设为 `true` 即在缺少 `secrets.LLM_API_KEY` 时**硬失败阻断部署**（因当前仓库尚未配置任何密钥，默认硬失败会中断每日流水线，故以变量门控，详见 HANDOFF）。
  - **contributors 分页深度与异常降级（T1.4）**：页数上限由 2 页提到 **5 页（上限 500 人）**；分页中途报错时降级为「已累计的下界」并标记 `partial`，不再整轮中断；首页即失败仍交由调用方标记为「测不到」。
  - **评分口径 UI 标注（T1.8）**：`caliberTag` 在详情页展示「评分口径 / 最新口径 / 历史口径 vX」，周期榜顶部展示整榜口径，混用多版本时改走原有的跨口径提示。

### 新增（体验与效率）

- **趋势标识系统（T2.2）**：卡片新增 `NEW`（首次上榜）、`上升 N 位`（排名上升 >5）、`连榜 N 期`（连续在榜 ≥3 期）三类标识，色值全部取自设计令牌、暗色模式可读；一屏最多两种标识以免视觉噪声。首次出现日期与连榜期数取自构建期索引，不依赖条目自带的 `firstSeen`。
- **详情页相关项目推荐（T2.3）**：构建期按「同分类 +2 / topics 交集 +1」计算相似度，给出 3 个「同类项目」+ 2 个「同期热门」（同一天增量最高），复用首页紧凑卡片直链详情页；30 天聚合结果在构建期缓存，避免逐页重复计算。
- **对比页维度对比模式（T2.1）**：新增第三种模式「维度对比」，并排展示 8 维评分条形与 6 项关键指标卡（Stars / Forks / 窗口增量 / 增速 / 贡献者 / PR 30d）；模式切换写入 URL query（`?mode=dimensions`），分享链接可还原视图；无 JS 时基础列表与链接仍可用。
- **OG 社交分享图（T2.4）**：新增 `scripts/generate-og.mjs`，构建期用 SVG 模板 + `sharp` 栅格化为 1200×630 PNG，输出 `dist/og/`（中英首页各一张 + 最新一期 Top10 各项目各一张，共 22 张）；`Base.astro` 输出 `og:*` / `twitter:card` / `canonical` 元标签，历史期回落到首页分享图。
- **GitHub API 多 token 轮询（T2.5）**：新增 `resolveTokens()`，支持 `GITHUB_TOKEN_1` / `GITHUB_TOKEN_2` 轮询；遇到 403 / 429 / 限流错误时**先换 token**（通常可立即恢复）再退避，`stats()` 暴露 `tokens` 与 `rotations`。
- **扩展指标分级采集（T2.5）**：核心指标（stars / forks / license / 文档 / 示例 / 年龄等）来自 Search API 结果，**零额外调用**；扩展指标（contributors / releases / PR / issue）按 `metrics.extendedIntervalDays`（默认 3 天）降频采集，未到期时复用上一份快照并标记 `metricsStale`，绝不把「没采」当成「是 0」。预计削减扩展调用约 2/3。
- **Search API 独立限流（T2.10，P1-C8）**：search 额度（30/分钟）低于 `minSearchRemainingBeforeWait`（默认 5）时先等待，且不再把 search 余额误记成 core 余额。

### 优化（校验与测试）

- **快照内部结构校验（T2.11，P1-C9）**：`validate-data.mjs` 新增 `stars.json[date][repo]` 必须为有限数字、`metrics.json[date][repo]` 关键字段必须为数字或 null、`partial` 必须为布尔的检查——此前只校验到「是不是对象」，一个被写成字符串的 star 数会让增量计算静默产出 NaN。
- **测试拆分与覆盖率（T2.12）**：测试拆为 `tests/pipeline.test.mjs`（主回归）+ `tests/growth.test.mjs` + `tests/metrics.test.mjs` + `tests/periods.test.mjs`，`npm test` 改为自动发现（88 → 89 项）；新增 `npm run test:coverage`。实测行覆盖率：`growth.mjs` 74.9%、`metrics.mjs` 90.4%、`timewindow.mjs` 96.6%，均 >70%；`periods.ts` 因静态 import 构建产物暂时无法被测试运行器加载（详见「未完成项」）。

### 未完成项（Phase 2 内明确延后，已记录在 HANDOFF）

- **T2.5 的 GraphQL 批量查询**：多 token 轮询与分级采集已落地，GraphQL 客户端（单次取 stars/forks/issues/PRs/releases，失败回落 REST）尚未实现。经评估，分级采集已削减大部分调用，GraphQL 边际收益下降且引入第二套 API 面；延后至 Phase 3 与采集侧改动一并处理。
- **T2.6 快照分片与增量存储**：计划原文风险节明确指出该任务应与 T3.4（daily 分层归档）一并推进；且读者侧（`periods.ts` 静态 import 快照）需先完成 T3.8 的「编译期 import → 运行时按需读取」改造，否则分片会直接打断构建。故延后至 Phase 3 与 T3.4 / T3.8 同批实施。

### 测试

- 新增 12 项回归测试（77 → 89），覆盖：趋势标识阈值与数量上限、相关项目相似度与去重、LLM 结构校验回落、search 限流不污染 core、口径定义（增长率分母 / 日均分母）、分级采集 stale 标记与零扩展请求、贡献者分页降级、原子写入、缓存降级。

---

## [0.7.0] — 2026-10-05

依据《ai-agent-top10 优化开发方案及实施计划》Phase 1（T1.1–T1.8，8 项 P0）实施。本轮聚焦「止血与可信度」：修复会让数据静默失真或页面错误的阻塞级缺陷，让流水线在异常时降级可解释、可回滚，并为评分口径建立版本化管理。

### 修复（阻塞级 · 数据可信度）

- **危险块级标签只删标签、内容残留（P0-C3）**：`sanitizeText` / `sanitizeMultiline` 此前仅剥离标签本身，`<script>alert(1)</script>` 会留下 `alert(1)`。现对 `script` / `style` / `iframe` / `svg` / `math` / `form` 等危险元素**连同内容整块剥离**（含未闭合形态），普通标签（如 `<b>`）仍只删标签、保留文字。同时新增**伪协议断链**：文本中的 `javascript:` / `vbscript:` / `data:text/html` 一律改写成 `javascript :` 形式，使任何解析器都不再识别为可执行 scheme。
- **JSON 非原子写入（P0-C2）**：`writeJson` 直接 `writeFileSync`，写到一半被中断会留下半截 JSON，而日榜文件是构建输入，会导致整轮 build 失败。现改为**同目录临时文件 + `renameSync` 原子替换**，并在异常时清理临时文件；interpret-cache 同步改用该实现。
- **超大仓库增速直接跳过（P0-C4）**：事件流覆盖率低于阈值时 `resolveStarGrowth` 返回 `null`，超大仓库（stargazers 翻不过 400 页）永远进不了榜。现改为**保守下界**：覆盖率低于 `minCoverage` 但高于新配置 `unreliableMinCoverageFloor`（默认 5%）时，直接采用**观测到的真实条数、不做任何外推**，标记 `gainUnreliable` / `gainLowerBound` 后照常参与排名；覆盖率低于地板值才放弃出数。
- **contributors 采集截断（P0-C1）**：贡献者接口只取第 1 页，超过 100 人的仓库全部被截断成同一个数，社区 / 创新维度失去区分度。现按 `metrics.contributorPages`（默认 2 页，上限 200）**分页采集**，并区分「数完」与「翻到上限被截断」（`contributorsCapped`）；接口不可用时返回 `null`（"测不到"）而非 `0`（"没有贡献者"），避免错误扣分。
- **规则解读给出错误的「缺少官网」结论（P0）**：`ruleCons` 此前未实际判定 `hasHomepage` / `hasDocs`。现严格区分两者，仅在官网与文档门户均缺失时才提示；有官网但缺文档、且规模较大时给出更准确的措辞。
- **`fitFor` 适用群体千篇一律（P0）**：改为 **category + topics 双重映射**，新增 RAG / 多智能体 / 编程辅助 / 浏览器自动化 / 评测 / CLI / 本地部署 / 多模态八类话题定向，跨项目重叠率低于 30%。

### 新增（可靠性与口径管理）

- **LLM 解读备用 provider（T1.3）**：主服务超时、报错或返回空时自动切换备用 provider（`config.interpretation.fallback`，可用 `LLM_FALLBACK_BASE_URL` / `LLM_FALLBACK_MODEL` / `LLM_FALLBACK_API_KEY` 覆盖）。
- **解读缓存（T1.3）**：新增 `scripts/lib/interpret-cache.mjs`，按「仓库全名 + README 摘要哈希」缓存 LLM 解读至 `src/data/snapshots/interpret-cache.json`。README 摘要未变的仓库直接复用，既省 token 又降低单点失败概率；摘要变化即自动失效。
- **解读降级信号分级（T1.3）**：整轮退回模板文案时输出 `::error` 级 Actions 注解，部分降级维持 `::warning`，并把来源构成写入 step summary。
- **评分引擎版本化（T1.8）**：新增 `config.scoringVersion`（当前 `2.1.0`）。日榜文档与每个条目在生成时落盘 `scoringVersion`，读侧据此判断历史数据是否同一口径。
- **`rescore --safe` 与口径熔断（T1.8）**：重算脚本新增 `--safe`（跳过已是当前版本的日期）与 `--since-version=N`（只重算低于 N 的版本）；重算前自动备份原文件到 `.rescored-backup/`；若某天平均 `|Δoverall|` 超过 25 分，视为配置写错，**拒绝写盘**并列入人工复核。新增 `npm run rescore` / `npm run rescore:safe`。
- **跨口径提示（T1.8）**：周榜 / 月榜聚合若混用多个评分引擎版本，榜单顶部展示中性色口径提示。

### 优化（CI 与校验）

- **数据校验门禁增强（T1.6）**：`validate-data.mjs` 新增**伪协议拦截**（`javascript:` / `vbscript:` / `data:text/html`），并把检查范围从 description / why / 亮点 / 缺点扩展到 `intro` / `cardLine` / `fitFor`。
- **CI 环境变量补齐（T1.3）**：`daily.yml` 透传备用 provider 的三个变量。

### 文档（T1.1）

- **README 版本号修正**：`README.md` 尾部版本号由过期的 `0.2.0` 修正为当前版本，并在顶部增加 `shields.io` 版本徽章与**数据覆盖范围**说明（当前已连续收录 23 天、聚合 17+ 独立项目）。
- **配置项文档同步**：README 补充 `contributorPages`、`growth.unreliableGainMode`、`scoringVersion` 与 `interpretation.fallback` 的说明。

### 测试

- 新增 15 项回归测试（62 → 77），覆盖：危险块级标签内容剥离、伪协议断链、contributors 分页与截断标记、原子写入无残留、缓存命中与损坏降级、备用 provider 切换、事件流保守下界、评分版本校验与 error 级降级信号。

---

## [0.6.0] — 2026-10-05

依据《AgentTop10-UI设计提升方案》对全站 UI/UX 进行系统级规范化重构，并整合解读文案与归因增强。重点解决 WCAG 2.1 AA 对比度违规阻塞项、收敛字体排版基线、化解排名与综合分认知冲突、优化首屏信息密度，并建立完整轻量无依赖的设计系统规范。

### 修复（阻塞级 · WCAG 对比度与排版基线）

- **涨跌徽章对比度合规（P0）**：浅色模式新增 `--good-ink: #036c50`，修复 `.gain-chip` 与 `.rank-change.up` 实测对比度从 3.40:1 提升至 5.81:1（PASS）；暗色模式维持高对比墨色（7.19:1 PASS）。
- **下降徽章对比度合规（P0）**：`.rank-change.down` 切换为 `--warn-ink: #8a4b06`，实测对比度由严重失效的 2.90:1 提升至 6.18:1（PASS）。
- **分类标签前景色修复（P0）**：`.cat-tag` 切换为 `--cat-tag-ink: #52525b`，实测对比度由 4.36:1 提升至 6.98:1（PASS）。
- **持平徽章语义错位（P0）**：`.rank-change.same` 修复误用品牌紫底，切换为中性灰底（`background: var(--card-2); color: var(--muted);`），形成绿/橙/灰语义闭环。
- **字号基线收口至 12px（P0）**：彻底清理全站 10.5px、11px、11.5px 杂乱小字，解决中文笔画粘连糊化问题；白名单保留 `.logo-text small` 11px 并补充 `letter-spacing: .02em`。
- **等宽数字与防断裂排版（P0）**：全局注入 `font-variant-numeric: tabular-nums` 确保 Star 垂直对齐；仓库名与统计数值采用 `word-break: normal; overflow-wrap: anywhere;` 防单词乱断。
- **详情页「首次收录」日期修正**：条目首次收录日期以索引最早出现日期为准，避免连续上榜项目被重置为当天日期。

### 新增（核心体验与架构）

- **列表工具栏（List Toolbar，P1）**：在榜单上方增加说明栏，明确“排名依据：近 N 天 Star 增量；综合分为独立的 8 维评估，与排名无关”，并提供评分体系跳转入口。
- **卡片 / 表格多视图切换（P1）**：工具栏集成卡片与紧凑表格双视图切换，支持客户端状态与 `localStorage` 本地偏好记忆。
- **Sparkline 趋势线替代雷达图（P1）**：将 132px 静态雷达图完整收敛至项目详情页；榜单卡片右侧重构为轻量 SVG Sparkline 折线图（近 21 天 Star 增量趋势）+ 紧凑综合分，单卡高度由 150px 压减至 ~110px，首屏信息容量提升 35% 以上。
- **零依赖矢量 SVG 图标系统（Icon.astro，P1）**：建立 16×16 内联矢量图标体系替代全站 Emoji，解决跨 OS 渲染差异与屏幕阅读器朗读噪音。
- **顶部导航精简与移动端单行横滚（P1）**：移除顶栏日/周/月重复链接（保留在下方 PeriodSwitch 控制器）；在 ≤700px 移动视口下实现导航单行平滑横向轻触滚动。
- **触控目标尺寸热区补齐（P1）**：通过伪元素 `::after` 为主题切换、导航链接扩展隐形点击热区至 ≥44×44px（符合 WCAG 2.5.8 与 Apple HIG 触控规范）。
- **检索页空态设计（Empty State，P2）**：增加友好的无匹配插图、引导文案与一键清除筛选条件按钮。
- **「为什么现在上榜」与 fork/star 异常提示**：详情页增加上榜归因分析与 fork 比例异常提醒。
- **快速上手抽取真实命令**：从 README 中自动抽取真实安装代码块，兜底才退回 git clone。

### 优化（规范体系与细节质感）

- **Design Tokens 标尺收敛（P2）**：规范四档圆角标尺（`--radius-sm` 至 `--radius-full`）、4px 乘数间距标尺与全局分层阴影。
- **数据可视化色彩解耦（P2）**：拆分 `--data-primary` 专属色（#6366f1 / #818cf8），避免数据图表与交互主色混淆。
- **Top 3 荣誉层级塑造（P2）**：前三名赋予微描边高亮与金银铜牌标（金 `#b45309`、银 `#64748b`、铜 `#b4552d`），去除斜体保证数字端正。
- **原生 HTML Popover 提示（P2）**：差值计算口径使用原生 HTML Popover 替换原生 `title`，兼顾触屏点击与键盘 Tab+Enter 激活。
- **键盘全可达反馈（P2）**：完善全局 `--focus-ring` 与卡片 `:focus-within` 选中外框。

---

## [0.5.1] — 2026-09-29

详情页上线后的三处视觉修正。

### 修复

- **副标题中文化**：中文页项目名下的一句简介此前直接显示 GitHub 的英文 description，现改用
  LLM 解读文案的首句（取「它能做什么？」第一句）；英文页保持原始描述不变。
- **「核心亮点」回归常规卡底色**：0.5.0 的深色强调卡与整体风格不协调，恢复与其它板块一致的
  白卡底色与标题样式（spot 相关的设计令牌一并移除）。
- **雷达图维度标签溢出面板**：8 维全名 + 数值单行过长会压出左栏右缘。现改为「维度名 / 数值」
  两行布局（数值用主题色加粗），`Radar` 组件新增 `pad` 属性加大外圈留白，详情页雷达加宽至
  262px，所有标签完整收进面板；小尺寸雷达（列表卡 104/132px）不受影响。

---

## [0.5.0] — 2026-09-29

项目详情页信息架构改版，参照卡片式设计稿（统计卡 + 「它能做什么？」/「核心亮点」/「谁适合用？」三卡结构）。

### 变更

- **统计区改为四大数字卡**：Stars / 主语言 / 本周新增 / Forks 四张等宽卡（标签在上、大数字在下），
  排名、增速、新增 fork、贡献者、PR / Issue 活跃收敛为卡下一行小字，信息不丢失。
- **「为什么上榜」板块移除**：其内容原是纯数字流水账，与统计卡完全重复；指标数字改由统计卡承载，
  数据文件中的 `why` 字段仍按规则生成，仅作卡片文案兜底。
- **「谁适合用？」顶替其位**：原「适合谁」从胶囊标签改为一段话，位置前移到核心亮点之后；
  「项目介绍」更名为「它能做什么？」「亮点」更名为「核心亮点」，后者升级为深色底强调卡（金色小标题），
  板块顺序调整为：它能做什么？ → 核心亮点 → 谁适合用？ → 局限 → star 趋势 → 快速上手。
- **板块标题统一去掉 emoji**，中英文文案同步（What it does / Highlights / Who is it for），
  README 的特性表与截图说明、`docs/detail.jpg` / `docs/dark.jpg` 配图一并更新。

### 修复

- 英文详情页此前缺少 `intro` 文案键，「项目介绍」标题渲染为空；随本次文案整理一并修复。

---

## [0.4.1] — 2026-09-28

### 修复

- **CI 上解读调不到 LLM**：`interpretation.baseUrl` 默认指向本机 Command Code 代理（`127.0.0.1:9090`），
  而每日抓取跑在 GitHub Actions 上，该地址在 runner 里不可达 —— 线上每天自动更新的解读会静默退回
  模板腔的规则文案。现在 `LLM_BASE_URL` / `LLM_MODEL` 环境变量可覆盖配置项，workflow 也已接上
  `vars.LLM_BASE_URL` / `vars.LLM_MODEL`。在仓库里配好这两个变量与 `secrets.LLM_API_KEY`
  （任一 OpenAI 兼容服务），CI 也能生成读 README 的通俗解读；未配置时依旧安全回落到规则版。

---

## [0.4.0] — 2026-09-28

解读从「模板拼装」升级为「读 README 说人话」。

### 新增

- **项目介绍**：详情页新增「📖 项目介绍」区块，讲清这是什么、解决什么问题、怎么用，并带一个典型使用场景。
- **卡片一行版**：列表页那行改为独立的 `cardLine`（中文不超过 45 字），不再与详情页共用一段长文案。
- **README 素材抓取**：新增 `scripts/lib/readme.mjs`，把 README 抽成纯文本摘要 —— 去徽章 / 图片 / 代码块，按句子边界截断，默认 2600 字。
- **LLM 接入本机网关**：`config/scoring.json` 的 `interpretation` 默认指向本机 Command Code 代理
  （`http://127.0.0.1:9090/v1`，OpenAI 兼容网关），密钥读 `COMMANDCODE_API_KEY`，不需要外部 API key。
- **回填脚本升级**：`scripts/backfill-why.mjs` → `scripts/backfill-interpretations.mjs`，新增 `--llm`，
  按仓库去重调用（同一项目连续多天上榜只花一次）。已回填 15 天 / 150 条 / 17 个仓库。

### 变更

- **「为什么上榜」回归指标口径**：`why` 改为回答「凭什么进榜」（窗口增量、增速、fork、活跃度、贡献者），
  并且**固定由规则版生成** —— 这些数字必须与数据文件逐一对得上，不适合交给模型复述。
- **亮点改成「能干什么」**：`highlights` 由 LLM 依据 README 写成「能力 + 具体场景」，
  不再只是「100 位公开贡献者」这类指标；规则版仍以指标兜底。
- 解读拆成 `why` / `intro` / `cardLine` / `highlights` 四个字段，schema 与 `Entry` 类型同步；
  周榜 / 月榜复用该项目最近一期日榜的 LLM 解读，不再退回模板腔。
- 详情页的页面描述（SEO description）改用「项目介绍」而非指标句。

---

## [0.3.0] — 2026-09-28

榜单条目的解读从"指标复述"改为"项目定位"。

### 变更

- **解读改为项目定位**：条目的 `why` 此前是"近 7 天新增 N star（日均约 M）、累计 X star / Y fork、采用 Z 协议、
  最近一次提交在 K 天前"——这些数字在卡片下方的数据行（⭐Stars / 🍴Forks / 📈日均 / 🚀增速）里已经出现过一遍，
  等于把同一份数据说了两次，却始终没有回答"这项目是干什么的"。
  现在改为定位解读：说明它属于哪类项目、用来做什么、聚焦哪些方向、主要语言是什么。
- **仓库描述落进日榜数据**：`description` 原先只在抓取阶段参与分类判定，没有写入 `src/data/daily/*.json`，
  构建期读不到。现在随条目落盘，英文定位解读直接引用仓库原始描述；中文由于缺少可靠的翻译来源，
  改用子分类 + 话题标签拼装，未收录的标签保留原始 slug（`claude-code` 不硬译成不存在的说法）。
- **话题标签双语映射**：新增 `src/lib/topic-labels.mjs`，收录约 100 条常见 AI Agent 话题的中英显示名。
- **历史回填**：新增 `scripts/backfill-why.mjs`，重算历史日榜的 `why`，并可用 `--descriptions`
  补采缺失的仓库描述。已回填 15 天 / 150 条历史条目（17 个仓库）。
- 定位解读只陈述已采集的客观信息，不做主观评价；指标仍完整保留在卡片数据行与 `highlights` / `cons` 中。

---

## [0.2.0] — 2026-09-23

按《ai-agent-top10 优化提升开发计划》实施。核心目标是先止血（两个让历史数据失效的阻断级缺陷）、
再补能力（时间维度与趋势可视化）、后做架构加固与体验增强。

### 修复（阻断级）

- **项目详情页 slug 冲突**：路由由 `/project/<slug>/` 改为 `/project/<date>/<slug>/`。
  此前 50 个榜单条目只有 16 个唯一 slug，Astro 静默覆盖，除最后一天外的历史详情页全部丢失
  （构建产物 104 页，其中大量是重复路径的覆盖结果）。
- **归档页链接全部指向今日榜单**：归档每一行此前都链接到首页，用户点任何日期都只能看到今天。
  现在每一行链接到 `/day/<date>/` 自己的榜单页；归档页另提供卡片 / 表格两种视图。
- **实用完成度评分恒为 0 的子项**：`practical` 维度读取了并不存在的 `metrics.topics`，
  导致话题标签子项（占该维度 20 分）恒为 0。改为读取条目自身的 `topics` 字段，并补了回归测试。
- **超大仓库增速被放大 20 倍**：事件流覆盖率下限被写成 `0.05`，
  意味着只观测到 5% 窗口的仓库会被乘以 20 倍外推。改为：覆盖率低于 30% 时**拒绝出数并跳过该项目**，
  外推倍数上限 3 倍，另加"周增量不超过仓库总量 8%"的合理性上限。
- **快照口径与实际窗口不符**：原先无论快照是几天前，都把它当作 7 天增量再除以 7，
  导致日均增量被系统性低估（快照为 1 天前时低估 7 倍）。现在按真实相隔天数换算，
  并记录 `gainSource` 便于追溯。
- **评分量纲缺陷（继承自 0.1.0，波及 5 个维度）**：多个维度把 0-100 的分位值直接乘系数
  （如 `35 * percentile(stars, ...)`），结果恒大于 100、被 `clamp` 成满分常量 ——
  `innovation` / `ecosystem` / `health` / `forksGrowth` / `activity` 五个维度实际上毫无区分度，
  8 维评分里只有 3 维真正在起作用。这也解释了旧数据里综合分全部挤在 85-98 的现象。
  现在统一改用 0-1 归一化的分位 / 对数因子（系数之和为 100），并补了回归测试：
  断言强弱项目在每个维度上都拉得开，且不会出现"两端都是满分"。
- **指标缺失时产生 NaN 分数**：`log10(undefined)` → `NaN` 会一路污染 `overall`，页面直接显示 NaN 分。
  现在所有非有限值在进入分数前被丢弃，该维度按不可靠处理。
- **交互活跃度的两处口径问题**：
  1）部分仓库（镜像仓或关闭了 issues/pulls）这两个接口返回 404，"活跃度 = 0"是错误结论 ——
  改标为未知并让该维度退出总分，而不是按"很冷清"扣分；
  2）按列表页计数且只翻 1 页时上限为 100，会让活跃仓库全部顶格 —— 改为默认翻 2 页（上限 200）。

### 新增（功能）

- **日 / 周 / 月三种榜单周期**：周榜与月榜在构建期由历史快照聚合，不额外调用 API。
  历史不足一个完整窗口时显式标注实际覆盖天数，**不做线性外推**。
- **star 历史趋势图**：项目详情页展示快照序列折线（含窗口增量与百分比），纯 SVG 手写，无图表库依赖。
- **雷达图增强**：维度数量自适应（6 维旧数据与 8 维新数据共用同一组件），
  大尺寸图直接标注数值，hover 顶点显示维度名、分值与计算口径。
- **评分从 6 维扩展到 8 维**：新增**分叉增速**与**迭代活跃度**；总分权重按维度重新分配。
- **子分类榜**：框架 / SDK、工具 / 平台、应用 / 产品、数据 / 评测，规则见 `categories` 配置。
- **项目检索页**：关键字 + 语言 + 子分类组合筛选；无 JS 时表格仍然完整可用，筛选为渐进增强。
- **话题标签页**：按 topic 聚合项目。
- **多仓库对比工具**：2–5 个项目 star 走势对比，支持绝对值与相对起点两种模式，选择结果写入 URL 可分享。
- **数据导出**：`/data/latest.json`、`/data/latest.csv`、`/data/history.csv`、`/data/projects.json`。
- **RSS 订阅**：`/rss.xml` 与 `/en/rss.xml`，最近 30 期。
- **排名变化标识**：榜单对比上一期显示上升 / 下降 / 持平。
- **暗色模式**：跟随系统偏好，首屏绘制前应用，无白屏闪烁。
- **可选的 LLM 解读**：配置 `interpretation.provider` 并提供 `LLM_API_KEY` 后由 LLM 生成解读，
  任何失败都自动回落到规则化文案；LLM 输出与人工文案共用同一套校验与净化。

### 变更（架构与工程）

- **流水线模块化**：原本约 320 行的单文件拆为 `github` / `candidates` / `growth` / `metrics` /
  `interpret` / `persist` 六个模块加一个编排层。
- **评分规则配置化**：权重、阈值、关键词、分类规则、窗口天数全部移入 `config/scoring.json`，
  流水线与构建期聚合共用同一份配置与同一个评分引擎。
- **显式限流与重试**：API 客户端增加调用预算、指数退避重试、请求超时，并把 `search` 与 `core` 两套独立额度分开记账。
  其中**请求超时是必需的**：Node 原生 `fetch` 没有默认超时，连接一旦停滞就会永久挂住整条流水线；
  本地调试时确实出现过流水线长时间零 API 活动、无任何输出的情况，加上超时与逐仓库进度日志后才能定位到卡点。
- **可重算历史评分的 `scripts/rescore.mjs`**：评分规则配置化之后，规则一改就需要让历史数据跟上同一口径，
  但不能为此重跑抓取（依赖网络与 API 额度）。该脚本用指标快照离线重算已落盘日期的分数，
  并且只处理"指标完整"的日期 —— 回填出来的 partial 记录缺 contributors / license 等字段，
  重算会把历史分数改坏，因此默认跳过并列出。
- **单仓库墙钟上限**：单个候选的处理由多次请求组成，只要其中任意一次在底层连接上永久挂住，
  整轮抓取就会静默停住。现在每个候选都有 `repoTimeoutMs` 墙钟上限（可用 `REPO_TIMEOUT_MS` 覆盖），
  超时即跳过该仓库并记录，而不是拖死整轮。
- **增速计算改为优先使用快照序列**：每天的快照已经构成序列，直接取"约 7 天前那一期"做差即可得到真实增量，
  零 API 调用；仅当基线缺失时才回落到 stargazers / 事件流接口。
- **构建性能**：新增聚合索引 `src/data/index.json`（日期、摘要、slug 列表），
  归档页与周期页只读索引，详情页按需加载单日 JSON，不再全量 eager 加载历史。
- **CI 流程拆分**：抓取与构建拆成两个 job，抓取后先做数据校验，校验不通过不会提交、也不会部署。
  另新增 push 触发构建（此前推代码不会重建站点）。
- **输入净化层**：仓库描述、topics、homepage 与解读文本统一经过净化（剥离 HTML 标签与注释、
  清除零宽与双向控制字符、仅放行 http(s) 协议、限长限量）后才写入数据文件。
- **双语路由去重**：`src/pages/en/` 整份复制被移除，改用可选路由段 `[...lang]`，中英共用同一份页面文件。
- **移动端适配**：媒体查询从 3 条扩展到 4 档断点（900 / 700 / 520 / 380），
  修复卡片、雷达图与元信息行在窄屏下的溢出重叠。
- **信息密度**：新增表格视图与聚合项目表，归档页 / 分类页 / 检索页首屏信息量显著提升。

### 测试

- 新增 `tests/pipeline.test.mjs`（`npm test`，28 个用例），覆盖评分、增速、净化、CSV 转义、
  分类与数据结构校验，其中包含针对上述两个阻断级缺陷的专门回归用例。

### 兼容性说明

- **路由变更为破坏性变更**：`/project/<slug>/` 不再存在，请使用 `/project/<date>/<slug>/`。
- **分数水平不可跨版本比较**：2026-09-23 之前的期数保留当时发布的分数（受量纲缺陷影响普遍偏高，
  综合分集中在 85-98），自本版本起使用修正后的归一化公式（综合分分布扩展到 50-85）。
  这些历史期数缺少 contributors / license 等字段，强行重算只会换成另一种失真，因此不做回溯改写。
- 新增的 `forksGrowth` 与 `activity` 两个维度自本版本起记录；早期期数仍为 6 维，
  页面按数据自适应渲染，缺失维度不参与总分计算。
- 数据文件新增字段：`category`、`openIssues`、`contributors`、`releases90d`、`prActivity`、
  `issueActivity`、`forksGain`、`gainSource`、`rankChange`、`poolSize`。
- 快照新增 `snapshots/metrics.json`（保留最近 120 天），`snapshots/stars.json` 结构不变。

---

## [0.1.0] — 初始版本

- Astro 5 静态站 + Node 数据流水线 + GitHub Actions 每日构建部署。
- 每日按 7 天 star 增速产出 Top10，6 维评分，中英双语页面与解读。
- 页面：`/`、`/en/`、`/archive`、`/project/<slug>`。
