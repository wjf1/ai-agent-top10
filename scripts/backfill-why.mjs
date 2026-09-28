#!/usr/bin/env node
/**
 * backfill-why.mjs — 把历史日榜的 why 重算为"定位解读"。
 *
 * 背景：why 曾经是指标复述（近 7 天新增 N star、累计 M fork…），与卡片下方的
 * 数据行重复。规则模板改为定位解读后，历史数据里的旧文案需要就地重算。
 *
 * 用法：
 *   node scripts/backfill-why.mjs                  # 只用条目里已有的字段重算 why
 *   node scripts/backfill-why.mjs --descriptions   # 先补采仓库描述，再重算（需要 GitHub 访问）
 *   DRY_RUN=1 node scripts/backfill-why.mjs        # 只打印将发生的改动，不写文件
 *
 * --descriptions 只补 description 与 why，不动 category：分类页与详情页路由都挂在
 * category 上，重算分类会造成历史链接漂移。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../src/lib/config.mjs";
import { positioningWhy } from "../src/lib/interpret.mjs";
import { sanitizeText } from "../src/lib/sanitize.mjs";

import { createClient, resolveToken, withTimeout } from "./lib/github.mjs";
import { dataPaths, listDailyDates, readJson, saveDaily } from "./lib/persist.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 日榜条目的扁平字段 → positioningWhy 期望的项目形状 */
function toProject(entry) {
  return {
    full_name: entry.full_name,
    name: entry.name,
    category: entry.category,
    language: entry.language,
    topics: entry.topics ?? [],
    description: entry.description ?? "",
    metrics: {
      stars: entry.stars,
      forks: entry.forks,
      openIssues: entry.openIssues,
      contributors: entry.contributors,
      releases90d: entry.releases90d,
      prActivity: entry.prActivity,
      issueActivity: entry.issueActivity,
    },
  };
}

async function fetchDescriptions(client, fullNames, log) {
  const out = new Map();
  for (const [i, fullName] of fullNames.entries()) {
    log(`  [${i + 1}/${fullNames.length}] ${fullName} …`);
    try {
      const repo = await withTimeout(client.gh(`/repos/${fullName}`), 20000, fullName);
      out.set(fullName, sanitizeText(repo?.description, config.sanitize?.maxDescriptionLength));
    } catch (e) {
      // 单个仓库失败不该中断整轮回填；该条目英文解读会退回模板句
      log(`  ! ${fullName}: ${e.message}`);
    }
  }
  return out;
}

async function main() {
  const paths = dataPaths(ROOT);
  const withDescriptions = process.argv.includes("--descriptions");
  const dryRun = !!process.env.DRY_RUN;
  const dates = listDailyDates(paths).sort();

  console.log(`# backfill-why: ${dates.length} day(s)${withDescriptions ? ", fetching descriptions" : ""}${dryRun ? ", DRY_RUN" : ""}`);

  let descriptions = new Map();
  if (withDescriptions) {
    const token = resolveToken();
    const client = createClient({ token });
    const missing = new Set();
    for (const date of dates) {
      const doc = readJson(path.join(paths.dailyDir, `${date}.json`));
      for (const entry of doc?.entries ?? []) {
        if (!entry.description) missing.add(entry.full_name);
      }
    }
    const targets = [...missing].sort();
    console.log(`descriptions to fetch: ${targets.length} (token: ${token ? "yes" : "no"})`);
    descriptions = await fetchDescriptions(client, targets, console.log);
    const stats = client.stats();
    console.log(`API calls: ${stats.calls} (retries ${stats.retries}, timeouts ${stats.timeouts})`);
  }

  let daysChanged = 0;
  let whyChanged = 0;
  let descAdded = 0;

  for (const date of dates) {
    const file = path.join(paths.dailyDir, `${date}.json`);
    const doc = readJson(file);
    if (!doc?.entries?.length) continue;

    let touched = false;
    for (const entry of doc.entries) {
      if (descriptions.has(entry.full_name)) {
        const value = descriptions.get(entry.full_name) ?? "";
        if (value && value !== entry.description) {
          entry.description = value;
          descAdded++;
          touched = true;
        }
      }
      const next = positioningWhy(toProject(entry));
      if (next.zh !== entry.why?.zh || next.en !== entry.why?.en) {
        entry.why = next;
        whyChanged++;
        touched = true;
      }
    }

    if (!touched) continue;
    daysChanged++;
    if (dryRun) {
      const sample = doc.entries[0];
      console.log(`  ~ ${date}: ${sample.full_name}\n      ${sample.why.zh}`);
      continue;
    }
    saveDaily(paths, doc);
  }

  console.log(
    `changed: ${daysChanged} day(s), ${whyChanged} why, ${descAdded} description(s)${dryRun ? " (dry run, nothing written)" : ""}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
