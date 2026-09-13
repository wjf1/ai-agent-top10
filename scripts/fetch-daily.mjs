#!/usr/bin/env node
/**
 * fetch-daily.mjs — 每日数据流水线
 * 1. 发现 AI Agent 候选项目（GitHub Search API）
 * 2. 用 stargazers 时间戳计算近 7 天 / 24h star 增速（冷启动日自动回填历史）
 * 3. 规则化计算 6 维度评分，按 star 增速排出 Top10
 * 4. 合并人工/AI 解读（data/interpretations/<date>.json，可选）
 * 5. 写入 src/data/daily/<date>.json，更新 src/data/index.json 与 star 快照
 *
 * 环境变量：GITHUB_TOKEN（或已登录的 gh CLI）
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(ROOT, "src", "data");
const SNAPSHOT_FILE = path.join(DATA_DIR, "snapshots", "stars.json");
const PERIOD_DAYS = 7;

const token =
  process.env.GITHUB_TOKEN ||
  (() => {
    try {
      return execSync("gh auth token", { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  })();

let calls = 0;
async function gh(url) {
  calls++;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ai-agent-top10",
  };
  if (url.includes("stargazers"))
    headers.Accept = "application/vnd.github.star+json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${url}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const search = (q) =>
  gh(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=60`)
    .then((r) => r.items ?? [])
    .catch((e) => {
      console.warn("search failed:", e.message);
      return [];
    });

/** 近 N 天新增 star 数（精确）：从 stargazers 最后几页统计 starred_at >= since。
 * GitHub 该接口最多可翻 400 页（4 万条），超大仓库返回 404。 */
async function weeklyStars(fullName, stars, since) {
  const pageSize = 100;
  const lastPage = Math.min(400, Math.ceil(stars / pageSize) || 1);
  let recent = 0;
  for (let p = lastPage; p > Math.max(0, lastPage - 8); p--) {
    const items = await gh(`/repos/${fullName}/stargazers?per_page=${pageSize}&page=${p}`);
    if (!Array.isArray(items) || items.length === 0) break;
    const inWindow = items.filter((s) => new Date(s.starred_at) >= since);
    recent += inWindow.length;
    if (inWindow.length < items.length) break; // 本页已含窗口外数据，窗口已完整覆盖
  }
  return { weekly: recent, exact: true };
}

/** 降级方案（超大仓库）：从事件流统计近期 StarEvent/WatchEvent */
async function weeklyStarsViaEvents(fullName, since, today) {
  let recent = 0;
  let oldest = new Date(today);
  for (let p = 1; p <= 3; p++) {
    const items = await gh(`/repos/${fullName}/events?per_page=100&page=${p}`);
    if (!Array.isArray(items) || items.length === 0) break;
    const stars = items.filter(
      (e) => (e.type === "WatchEvent" || e.type === "StarEvent") && new Date(e.created_at) >= since
    );
    recent += stars.length;
    oldest = new Date(items[items.length - 1].created_at);
    if (oldest <= since) break;
  }
  // 事件流只覆盖约最近几小时~几天；未覆盖满窗口时按覆盖率外推并标记估算
  const covered = Math.max(0.05, Math.min(1, (today - oldest) / (today - since)));
  return { weekly: Math.round(recent / covered), exact: covered >= 0.999 };
}

function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
const percentile = (arr, v) => {
  if (!arr.length) return 50;
  return (arr.filter((x) => x <= v).length / arr.length) * 100;
};
const log100 = (v) => Math.log10(Math.max(1, v)) / 2; // log10(v)/log10(100) → 0..~3

function scoreProject(p, pool) {
  const dailyGains = pool.map((x) => x.dailyGain);
  const weeklyGains = pool.map((x) => x.weeklyGain);
  const contribs = pool.map((x) => x.metrics.contributors);
  const ages = pool.map((x) => x.metrics.ageDays);
  const pushAges = pool.map((x) => x.metrics.pushDaysAgo);
  const forks = pool.map((x) => x.metrics.forks);
  const stars = pool.map((x) => x.metrics.stars);

  const growthRate = p.weeklyGain / Math.max(1, p.metrics.stars); // 周相对增速
  const heat = clamp(
    0.6 * percentile(dailyGains, p.dailyGain) + 0.4 * percentile(weeklyGains, p.weeklyGain) + 10
  );

  const m = p.metrics;
  const community = clamp(
    30 * log100(m.contributors) +
      20 * (1 - Math.min(1, m.pushDaysAgo / 14)) +
      15 * (m.releases90d > 0 ? 1 : 0.3) +
      15 * log100(m.openIssues || 1) * 0.8 +
      10 * percentile(ages, m.ageDays) / 100
  );
  const practical = clamp(
    35 * (m.licensePermissive ? 1 : 0.4) +
      25 * (m.hasDocs ? 1 : 0.3) +
      20 * Math.min(1, (m.topics||[]).length / 5) +
      20 * (m.hasExamples || m.hasHomepage ? 1 : 0.4)
  );
  const ecosystem = clamp(
    35 * percentile(stars, m.stars) +
      25 * percentile(forks, m.forks) +
      20 * (m.orgVerified || m.ownerType === "Organization" ? 1 : 0.4) +
      20 * (m.downloadsSignal ? 1 : 0.4)
  );
  const health = clamp(
    35 * (m.license ? 1 : 0.2) +
      25 * (1 - Math.min(1, m.pushDaysAgo / 30)) +
      20 * (1 - Math.min(1, m.openIssues / Math.max(1, m.stars * 0.02))) +
      20 * percentile(ages, m.ageDays)
  );
  // 创新性：自动化阶段用可观测信号近似（首日由人工解读覆盖）
  const innovation = clamp(
    30 * percentile(weeklyGains, p.weeklyGain) +
      25 * (1 - Math.min(1, m.ageDays / 730)) +
      20 * log100(m.contributors) / 3 +
      25 * ((m.topics||[]).some((t) => /mcp|rl|multi|autonomous|reasoning|memory/.test(t)) ? 1 : 0.4)
  );

  return {
    heat,
    community,
    innovation,
    practical,
    ecosystem,
    health,
    overall: clamp(
      heat * 0.2 + community * 0.15 + innovation * 0.2 + practical * 0.2 + ecosystem * 0.15 + health * 0.1
    ),
  };
}

async function main() {
  const today = new Date();
  const date = process.argv[2] || today.toISOString().slice(0, 10);
  const since = new Date(today.getTime() - PERIOD_DAYS * 864e5);
  console.log(`# fetch-daily ${date} (window: ${PERIOD_DAYS}d, token: ${token ? "yes" : "no"})`);

  // 1. 候选池：AI Agent 相关话题/关键词
  const queries = [
    "topic:ai-agents stars:>300 pushed:>2026-07-01",
    "topic:ai-agent stars:>300 pushed:>2026-07-01",
    "topic:agent-framework stars:>200 pushed:>2026-07-01",
    "ai agent in:name,description stars:>800 pushed:>2026-08-01",
  ];
  const found = new Map();
  for (const q of queries) {
    for (const r of await search(q)) {
      if (r.archived || r.fork) continue;
      if (!found.has(r.full_name)) found.set(r.full_name, r);
    }
  }
  let pool = [...found.values()].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 45);
  console.log(`candidates: ${pool.length}`);

  // 2. star 增速（快照优先；无快照时回填 stargazers 历史）
  const snap = fs.existsSync(SNAPSHOT_FILE)
    ? JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"))
    : {};
  const lastSnapDate = Object.keys(snap).filter((d) => d < date).sort().pop();
  let weeklyExact = true;
  const results = [];
  for (const r of pool) {
    let weeklyGain;
    if (lastSnapDate && today - new Date(lastSnapDate) < 3 * 864e5) {
      const prev = snap[lastSnapDate][r.full_name];
      weeklyGain = prev != null ? Math.max(0, r.stargazers_count - prev) : null;
    } else {
      weeklyGain = null;
    }
    if (weeklyGain == null) {
      try {
        const w =
          r.stargazers_count > 39500
            ? await weeklyStarsViaEvents(r.full_name, since, today)
            : await weeklyStars(r.full_name, r.stargazers_count, since);
        weeklyGain = w.weekly;
        weeklyExact = w.exact;
      } catch (e) {
        console.warn(`  ! ${r.full_name}: ${e.message}`);
        continue;
      }
    }
    let contributors = 0;
    try {
      const c = await gh(`/repos/${r.full_name}/contributors?per_page=100&anon=false`);
      contributors = Array.isArray(c) ? c.length : 0;
    } catch {}
    let releases90d = 0;
    try {
      const rel = await gh(`/repos/${r.full_name}/releases?per_page=30`);
      releases90d = rel.filter(
        (x) => x.published_at && today - new Date(x.published_at) < 90 * 864e5
      ).length;
    } catch {}
    const permissive = ["MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause", "ISC", "MPL-2.0"];
    results.push({
      slug: r.full_name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"),
      full_name: r.full_name,
      name: r.name,
      owner: r.owner.login,
      ownerType: r.owner.type,
      orgVerified: r.owner?.type === "Organization",
      url: r.html_url,
      homepage: r.homepage || "",
      description: r.description || "",
      language: r.language || "Other",
      topics: r.topics || [],
      created_at: r.created_at,
      pushed_at: r.pushed_at,
      metrics: {
        stars: r.stargazers_count,
        forks: r.forks_count,
        watchers: r.subscribers_count ?? r.watchers_count,
        openIssues: r.open_issues_count,
        license: r.license?.spdx_id || null,
        licensePermissive: permissive.includes(r.license?.spdx_id),
        hasDocs: r.has_wiki || !!(r.homepage || "").includes("docs"),
        hasHomepage: !!r.homepage,
        hasExamples: (r.topics || []).some((t) => /example|demo|template/.test(t)) || r.size > 2000,
        ageDays: Math.round((today - new Date(r.created_at)) / 864e5),
        pushDaysAgo: Math.round((today - new Date(r.pushed_at)) / 864e5),
        contributors,
        releases90d,
        downloadsSignal: false,
      },
      weeklyGain,
      dailyGain: weeklyGain / PERIOD_DAYS,
      growthRate: 0,
    });
    results[results.length - 1].growthRate =
      results[results.length - 1].weeklyGain / Math.max(1, r.stargazers_count);
  }

  // 3. 评分 + 排名（严格按 star 增速）
  for (const p of results) p.scores = scoreProject(p, results);
  const ranked = results
    .sort((a, b) => b.dailyGain - a.dailyGain || b.growthRate - a.growthRate)
    .slice(0, 10)
    .map((p, i) => ({ rank: i + 1, ...p }));

  // 4. 合并解读（如有）
  const interpFile = path.join(DATA_DIR, "interpretations", `${date}.json`);
  let interpretations = {};
  if (fs.existsSync(interpFile))
    interpretations = JSON.parse(fs.readFileSync(interpFile, "utf8"));

  const entries = ranked.map((p) => {
    const it = interpretations[p.full_name] || interpretations[p.slug] || {};
    const autoWhy = {
      zh: `近 7 天新增 ${p.weeklyGain.toLocaleString()} star（日均 ${Math.round(p.dailyGain)}），${p.metrics.license ? `采用 ${p.metrics.license} 协议` : "协议待确认"}，社区近期保持活跃更新。`,
      en: `Gained ${p.weeklyGain.toLocaleString()} stars in the last 7 days (~${Math.round(p.dailyGain)}/day), ${p.metrics.license ? `licensed under ${p.metrics.license}` : "license TBD"}, with active maintenance.`,
    };
    return {
      rank: p.rank,
      slug: p.slug,
      full_name: p.full_name,
      name: p.name,
      owner: p.owner,
      url: p.url,
      homepage: p.homepage,
      language: p.language,
      topics: p.topics.slice(0, 8),
      stars: p.metrics.stars,
      forks: p.metrics.forks,
      weeklyGain: p.weeklyGain,
      dailyGain: Math.round(p.dailyGain * 10) / 10,
      growthRate: Math.round(p.growthRate * 1000) / 10, // %
      scores: p.scores,
      why: it.why || autoWhy,
      highlights: it.highlights || [],
      cons: it.cons || [],
      fitFor: it.fitFor || [],
      quickstart: it.quickstart || "",
      firstSeen: it.firstSeen ?? date,
    };
  });

  // 5. 写数据文件 + 快照
  fs.mkdirSync(path.join(DATA_DIR, "daily"), { recursive: true });
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  const doc = {
    date,
    generatedAt: new Date().toISOString(),
    windowDays: PERIOD_DAYS,
    entries,
  };
  fs.writeFileSync(path.join(DATA_DIR, "daily", `${date}.json`), JSON.stringify(doc, null, 2));
  snap[date] = Object.fromEntries(results.map((r) => [r.full_name, r.metrics.stars]));
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap, null, 2));

  const indexFile = path.join(DATA_DIR, "index.json");
  const idx = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : { dates: [] };
  idx.dates = [...new Set([date, ...idx.dates])].sort().reverse();
  fs.writeFileSync(indexFile, JSON.stringify(idx, null, 2));

  console.log(`API calls: ${calls}`);
  console.log(
    "TOP10:",
    entries.map((e) => `${e.rank}. ${e.full_name} (+${e.weeklyGain}/7d)`).join("\n      ")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
