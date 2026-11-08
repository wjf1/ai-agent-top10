# AGENTS.md — ai-agent-top10

## 项目概览

GitHub AI Agent 项目每日 Top10 排行站：按 star 增长多维度可解释评分，中英双语页面，GitHub Pages 自动部署。
每日 CI 巡检抓取数据、回填指标、生成日榜并自动提交（`daily update YYYY-MM-DD`）。
当前版本 **v0.9.2**（2026-10-10），测试 94 项（node --test）。

## 构建与测试命令

Astro 5（唯一运行时依赖），ESM，Node 内建 test runner。以下命令均来自 `package.json` scripts 与 `.github/workflows/daily.yml`：

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发（astro dev） |
| `npm run build` | astro build + 生成 OG 图（scripts/generate-og.mjs） |
| `npm run preview` | 本地预览构建产物 |
| `npm test` | node --test（tests/） |
| `npm run validate` | 数据校验（scripts/validate-data.mjs） |
| `npm run check` | test + validate + build 一条龙（CI 门禁命令） |
| `npm run fetch` | 抓取当日榜单（scripts/fetch-daily.mjs） |
| `npm run backfill` | 回填指标快照（scripts/backfill-metrics.mjs） |
| `npm run rescore` | 重算评分（`rescore:safe` 为安全模式） |
| `npm run backfill:interpretations` | 回填 LLM 中文解读（依赖本机网关） |

CI（daily.yml）每日跑 `npm run check` → fetch → backfill → validate → 自动提交；GitHub Pages 由 validate → build → deploy-pages 发布。

## 代码风格约定

- 纯 Astro 静态站 + 零构建框架代码；数据即文件：`src/data/daily/*.json`（日榜）、`src/data/index.json`、`src/data/snapshots/`（metrics/stars 快照）为单一事实来源，改动经 `validate-data.mjs` 校验。
- 工具脚本一律 `scripts/*.mjs`（ESM，node 直跑）；测试用 `node --test`，不引入额外测试框架。
- 中英双语文案分侧：中文页中文自述/方向标签、英文页仓库自述原文（0.9.2 规则，有回归用例守护）。
- `src/data/snapshots/interpret-cache.json` 是本机派生缓存（README 哈希复用），已 gitignore，不得提交。

## 提交与发布规范

- 功能提交用 Conventional Commits + 中文描述（如 `docs(handoff): ...`）；每日数据由 CI 以 `daily update YYYY-MM-DD` 自动提交。
- **push 前四文档硬门禁**：package.json、CHANGELOG.md、README.md（中英双语）、HANDOFF.md 齐备且版本一致后方可推送发布。
- 发布走 annotated tag：`git tag -a vX.Y.Z -m "vX.Y.Z: <中文核心摘要>"`，GitHub Release 标题与正文严格对齐该格式，禁止裸版本号或纯英文标题。

## 项目专属注意

1. **Bash cwd 每条命令重置**：一律内联 `cd F:/AI/Zcode/ai-agent-top10 && <命令>`。
2. **Git 代理端口会漂移**：推送报代理连接失败时用 `git -c http.proxy= <cmd>` 临时直连，或核对当前实际监听端口。
3. **数据文件是 SSOT**：手改 `src/data/` 下任何 JSON 必须跑 `npm run validate`；重新生成日榜用 `rescore`/`backfill` 脚本而非手写。
4. **CI 无 LLM 密钥**：每日自动提交走规则兜底文案（曾致中文页英文截断事故）；中文解读回填依赖本机网关，属人工离线操作。

接力开发优先阅读 `HANDOFF.md`（§六 关键避坑）与 `PLAN.md`。
