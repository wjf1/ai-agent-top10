#!/usr/bin/env node
/**
 * fetch-daily.mjs — 每日数据流水线（编排层）
 *
 * 具体职责已拆到 scripts/lib/ 下：
 *   github.mjs      限流 / 重试 / 调用预算
 *   candidates.mjs  候选发现
 *   growth.mjs      star / fork 增速
 *   metrics.mjs     仓库指标采集（含 PR / issue 活跃度）
 *   interpret.mjs   解读生成（人工 > LLM > 规则）
 *   persist.mjs     落盘 + 快照 + 聚合索引
 *   schema.mjs      结构校验
 *
 * 环境变量：
 *   GITHUB_TOKEN      调用 GitHub API（缺失时回落 gh CLI）
 *   LLM_API_KEY       可选，配置里 provider 非 none 时用于生成解读
 *   MAX_CANDIDATES=N  只处理前 N 个候选，用于冒烟
 *   DRY_RUN=1         跑完整流程但不写 src/data/
 *   REPO_TIMEOUT_MS=N 覆盖单个候选的墙钟上限
 *   DEBUG_REQUESTS=1  打印每次 API 请求的 URL 与耗时
 * 用法：node scripts/fetch-daily.mjs [YYYY-MM-DD]
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../src/lib/config.mjs";
import { categorize } from "../src/lib/categorize.mjs";
import { sanitizeSlug, sanitizeText, sanitizeUrl, sanitizeTopics } from "../src/lib/sanitize.mjs";
import { buildPoolContext, scoreProject } from "../src/lib/scoring.mjs";

import { createClient, resolveToken, withTimeout } from "./lib/github.mjs";
import { discoverCandidates } from "./lib/candidates.mjs";
import { resolveForkGrowth, resolveStarGrowth } from "./lib/growth.mjs";
import { collectMetrics } from "./lib/metrics.mjs";
import { llmInterpretation, normalizeInterpretation, ruleBasedInterpretation } from "./lib/interpret.mjs";
import {
  dataPaths,
  listDailyDates,
  readJson,
  saveDaily,
  saveIndex,
  saveSnapshots,
} from "./lib/persist.mjs";
import { checkDailyFile } from "./lib/schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 864e5;
const WINDOW = config.window?.weekly ?? 7;

const round1 = (n) => Math.round(n * 10) / 10;

async function main() {
  const now = new Date();
  const date = process.argv[2] || now.toISOString().slice(0, 10);
  const token = resolveToken();
  const paths = dataPaths(ROOT);
  const since7d = new Date(now.getTime() - WINDOW * DAY);

  console.log(`# fetch-daily ${date} (window: ${WINDOW}d, token: ${token ? "yes" : "no"})`);

  const client = createClient({ token });

  // ---- 1. 候选发现 ----
  const { pool: candidates } = await discoverCandidates(client, { now });

  // ---- 2. 快照（star 序列 + fork 序列）----
  const starSnapshots = readJson(paths.starsFile, {});
  const metricSnapshots = readJson(paths.metricsFile, {});
  const snapshotDates = [...new Set(Object.keys(starSnapshots))].sort().reverse();
  const forkSnapshots = Object.fromEntries(
    Object.entries(metricSnapshots).map(([d, repos]) => [
      d,
      Object.fromEntries(Object.entries(repos).map(([name, m]) => [name, m.forks])),
    ])
  );

  // ---- 3. 增速 + 指标 ----
  /** 单个候选的完整处理：增速 → 指标 → 净化 → 分类 */
  async function processCandidate(repo) {
    const growth = await resolveStarGrowth(client, {
      fullName: repo.full_name,
      stars: repo.stargazers_count,
      snapshots: starSnapshots,
      snapshotDates,
      now,
      since7d,
      log: console.log,
    });
    if (!growth) return null;

    const metrics = await collectMetrics(client, repo, { now, log: console.log });
    const forkGrowth = resolveForkGrowth({
      forkSnapshots,
      forks: metrics.forks,
      fullName: repo.full_name,
      snapshotDates,
      now,
    });

    const base = {
      slug: sanitizeSlug(repo.full_name.replace("/", "-")),
      full_name: repo.full_name,
      name: sanitizeText(repo.name, 120),
      owner: sanitizeText(repo.owner?.login ?? "", 120),
      url: sanitizeUrl(repo.html_url),
      homepage: sanitizeUrl(repo.homepage),
      description: sanitizeText(repo.description, config.sanitize?.maxDescriptionLength),
      language: sanitizeText(repo.language ?? "Other", 40) || "Other",
      topics: sanitizeTopics(repo.topics),
      created_at: repo.created_at,
      metrics,
      ...growth,
      ...forkGrowth,
      dailyGain: round1(growth.weeklyGain / WINDOW),
      growthRate: round1((growth.weeklyGain / Math.max(1, metrics.stars)) * 100),
      forksGrowthRate: round1(((forkGrowth.forksGain ?? 0) / Math.max(1, metrics.forks)) * 100),
    };
    base.category = categorize(base);
    return base;
  }

  const records = [];
  let skipped = 0;
  let timedOut = 0;
  const repoBudgetMs = Number(process.env.REPO_TIMEOUT_MS ?? config.api?.repoTimeoutMs ?? 120000);

  for (const [index, repo] of candidates.entries()) {
    // 逐个打印进度：CI 里卡在哪一步、有没有被限流，看日志就能定位
    console.log(`  [${index + 1}/${candidates.length}] ${repo.full_name} …`);
    try {
      const record = await withTimeout(processCandidate(repo), repoBudgetMs, repo.full_name);
      if (record) records.push(record);
      else skipped++;
    } catch (e) {
      // 单个仓库出问题不该拖死整轮抓取
      timedOut++;
      console.warn(`  ! ${repo.full_name}: ${e.message}`);
    }
  }

  assert(records.length > 0, "no candidate produced a usable growth figure");
  console.log(
    `scored pool: ${records.length} (skipped ${skipped} without reliable growth, ${timedOut} failed/timed out)`
  );

  // ---- 4. 评分 + 排名 ----
  const ctx = buildPoolContext(records);
  for (const r of records) r.scores = scoreProject(r, records, ctx);

  const topN = config.pool?.topN ?? 10;
  const ranked = records
    .sort((a, b) => b.weeklyGain - a.weeklyGain || b.growthRate - a.growthRate)
    .slice(0, topN);

  // ---- 4b. 排名变化（对比上一期日榜）----
  const previousDates = listDailyDates(paths).filter((d) => d < date);
  const previous = previousDates.length ? readJson(path.join(paths.dailyDir, `${previousDates[0]}.json`)) : null;
  const prevRank = new Map((previous?.entries ?? []).map((e) => [e.full_name, e.rank]));

  // ---- 5. 解读（人工 > LLM > 规则）----
  const manual = readJson(path.join(paths.interpDir, `${date}.json`), {});
  const manualCount = Object.keys(manual).length;
  let llmMap = new Map();
  if (!manualCount) llmMap = await llmInterpretation(ranked, { log: console.log });
  else console.log(`interpretation: manual file found (${manualCount} entries), skipping LLM`);

  const entries = ranked.map((p, i) => {
    const manualRaw = manual[p.full_name] ?? manual[p.slug];
    const fromManual = manualRaw ? normalizeInterpretation(manualRaw) : null;
    const fromLlm = llmMap.get(p.full_name) ?? null;
    const fallback = ruleBasedInterpretation({ ...p, windowDays: WINDOW });
    const chosen = fromManual ?? fromLlm ?? fallback;
    const source = fromManual ? "manual" : fromLlm ? "llm" : "rules";

    const rank = i + 1;
    const before = prevRank.get(p.full_name);

    return {
      rank,
      slug: p.slug,
      full_name: p.full_name,
      name: p.name,
      owner: p.owner,
      url: p.url,
      homepage: p.homepage,
      language: p.language,
      category: p.category,
      topics: p.topics.slice(0, 8),
      stars: p.metrics.stars,
      forks: p.metrics.forks,
      openIssues: p.metrics.openIssues,
      contributors: p.metrics.contributors,
      releases90d: p.metrics.releases90d,
      prActivity: p.metrics.prActivity,
      issueActivity: p.metrics.issueActivity,
      weeklyGain: p.weeklyGain,
      dailyGain: p.dailyGain,
      growthRate: p.growthRate,
      forksGain: p.forksGain,
      forksGrowthRate: p.forksGrowthRate,
      gainSource: p.source,
      gainExact: p.exact,
      rankChange: typeof before === "number" ? before - rank : null,
      scores: p.scores,
      why: chosen.why,
      highlights: chosen.highlights ?? [],
      cons: chosen.cons ?? [],
      fitFor: chosen.fitFor ?? [],
      quickstart: chosen.quickstart ?? "",
      interpretationSource: source,
      firstSeen: chosen.firstSeen ?? date,
    };
  });

  // ---- 6. 落盘 ----
  const doc = {
    date,
    generatedAt: now.toISOString(),
    windowDays: WINDOW,
    poolSize: records.length,
    entries,
  };

  const { ok, errors } = checkDailyFile(doc, { expectedDate: date, topN });
  if (!ok) {
    console.error("data validation failed:");
    for (const e of errors.slice(0, 20)) console.error(`  - ${e}`);
    throw new Error(`produced dataset failed validation (${errors.length} issue(s))`);
  }

  const dryRun = !!process.env.DRY_RUN;
  if (dryRun) {
    console.log("DRY_RUN=1 → skipping writes to src/data/");
    console.log(
      "TOP10 (dry):\n" +
        entries.map((e) => `  ${e.rank}. ${e.full_name} (+${e.weeklyGain}/7d via ${e.gainSource})`).join("\n")
    );
    return;
  }

  saveDaily(paths, doc);
  saveSnapshots(paths, {
    date,
    stars: Object.fromEntries(records.map((r) => [r.full_name, r.metrics.stars])),
    metrics: Object.fromEntries(records.map((r) => [r.full_name, r.metrics])),
    now,
  });
  const index = saveIndex(paths, { dates: [...new Set([date, ...previousDates])], now });

  const stats = client.stats();
  console.log(
    `API calls: ${stats.calls} (retries ${stats.retries}, timeouts ${stats.timeouts}, throttled ${stats.throttled}) ` +
      `core remaining ${stats.coreRemaining ?? "?"}, search remaining ${stats.searchRemaining ?? "?"}`
  );
  console.log(`index: ${index.days.length} day(s), latest ${index.latest}`);
  console.log(
    "TOP10:\n" +
      entries.map((e) => `  ${e.rank}. ${e.full_name} (+${e.weeklyGain}/7d via ${e.gainSource})`).join("\n")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
