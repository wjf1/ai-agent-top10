# ⚡ Agent Top10 — 每日 AI Agent 项目解读

每日从 GitHub 上千个 AI Agent 相关项目中，按 **star 增速**选出最热的 10 个，并以 6 个维度给出综合评分与深度解读。中英双语。

**线上地址**：`https://<用户名>.github.io/ai-agent-top10/`（启用 GitHub Pages 后）

## 功能

- 🏆 **每日 Top10**：严格按近 7 天 star 增速排名（增速 = 每日新增 star）
- 📊 **6 维评分卡**：热度趋势 20% · 社区活跃 15% · 技术创新 20% · 实用完成度 20% · 生态潜力 15% · 健康可持续 10%（综合分仅供参考，不影响排名）
- 💡 **深度解读**：为什么上榜 / 亮点 / 局限 / 适合谁 / 快速上手，中英双语
- 🌐 **双语**：`/` 中文，`/en/` English，右上角切换
- 🗂 **历史归档**：按日期回看往期榜单
- ☁️ **全自动更新**：GitHub Actions 每天 14:00（北京时间）抓取数据 → 评分 → 重建 → 部署 Pages

## 快速开始

```bash
npm install
npm run fetch     # 抓取今日数据（需 GITHUB_TOKEN 或已登录 gh CLI）
npm run dev       # 本地预览
npm run build     # 构建到 dist/
```

## 目录结构

```
scripts/fetch-daily.mjs      # 数据流水线：候选发现 → star 增速 → 6 维评分 → Top10
src/data/daily/YYYY-MM-DD.json  # 每日榜单数据
src/data/interpretations/       # 人工/AI 解读文案（可选，缺失时自动生成模板文案）
src/data/snapshots/stars.json   # star 快照，用于次日增量计算
src/pages/                      # Astro 页面（zh + en）
.github/workflows/daily.yml     # 每日自动更新 + Pages 部署
```

## 部署到 GitHub Pages（一次性）

1. 新建 GitHub 仓库并推送本项目
2. 仓库 Settings → Pages → Source 选 **GitHub Actions**
3. 手动触发 `daily-update` workflow（或等每天 14:00 自动跑）

## 评分口径说明

- **排名**只看 star 增速（近 7 天日均新增），对标 GitHub Trending / Trendshift
- 6 个维度由抓取到的客观指标（贡献者、release 频率、license、文档、组织背景、维护活跃度等）规则化计算；大仓库（>4 万星）star 增速通过事件流估算并降级
- 解读文案由 AI/人工写入 `src/data/interpretations/`，自动流水线无 LLM 时回退为模板文案
