#!/usr/bin/env node
/**
 * backfill-interpretations.mjs — 重算历史日榜的解读。
 *
 * 两种模式：
 *   默认      本地重算 why（「为什么上榜」），并给缺 intro / cardLine 的老条目补规则版；
 *             已有内容不动，不会把 LLM 写好的介绍覆盖成模板腔。
 *   --llm     抓仓库 README 并调 LLM 生成「项目介绍 / 卡片一行版 / 亮点」。
 *             按仓库去重调用 —— 同一项目连续多天上榜只花一次；why 仍由规则版按当日指标生成。
 *   --refresh-rules
 *             只把 interpretationSource === "rules" 的条目按当前模板口径重算一遍
 *             （改了 interpret.mjs 的文案规则后，用它让已落盘的历史日期跟上）。
 *             LLM / 人工解读以及缺来源字段的老数据一律不动；与 --llm 互斥。
 *
 * --since=YYYY-MM-DD 只处理该日期（含）之后的期数 —— 补某次故障的窗口时用，
 *             否则会把更早的、已经写好的 LLM 文案再覆盖一遍。
 *
 * 用法：
 *   node scripts/backfill-interpretations.mjs
 *   node scripts/backfill-interpretations.mjs --llm [--descriptions]
 *   DRY_RUN=1 node scripts/backfill-interpretations.mjs --llm
 *
 * --descriptions 只补 description 与解读，不动 category：分类页与详情页路由都挂在
 * category 上，重算分类会造成历史链接漂移。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../src/lib/config.mjs";
import { ruleBasedInterpretation } from "../src/lib/interpret.mjs";
import { sanitizeText } from "../src/lib/sanitize.mjs";

import { createClient, resolveToken, withTimeout } from "./lib/github.mjs";
import { llmInterpretation } from "./lib/interpret.mjs";
import { fetchReadmeExcerpt } from "./lib/readme.mjs";
import { dataPaths, listDailyDates, readJson, saveDaily } from "./lib/persist.mjs";
import { refreshRuleEntry, selectDates } from "./lib/refresh.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 日榜条目的扁平字段 → 解读函数期望的项目形状 */
function toProject(entry) {
  return {
    full_name: entry.full_name,
    name: entry.name,
    slug: entry.slug,
    owner: entry.owner,
    url: entry.url,
    category: entry.category,
    language: entry.language,
    topics: entry.topics ?? [],
    description: entry.description ?? "",
    weeklyGain: entry.weeklyGain,
    dailyGain: entry.dailyGain,
    growthRate: entry.growthRate,
    forksGain: entry.forksGain,
    metrics: {
      stars: entry.stars,
      forks: entry.forks,
      openIssues: entry.openIssues,
      contributors: entry.contributors,
      releases90d: entry.releases90d,
      prActivity: entry.prActivity,
      issueActivity: entry.issueActivity,
      pushDaysAgo: entry.pushDaysAgo,
      license: entry.license,
    },
  };
}

async function fetchDescriptions(client, fullNames, log) {
  const out = new Map();
  for (const [i, fullName] of fullNames.entries()) {
    log(`  [${i + 1}/${fullNames.length}] description ${fullName} …`);
    try {
      const repo = await withTimeout(client.gh(`/repos/${fullName}`), 20000, fullName);
      out.set(fullName, sanitizeText(repo?.description, config.sanitize?.maxDescriptionLength));
    } catch (e) {
      log(`  ! ${fullName}: ${e.message}`);
    }
  }
  return out;
}

async function main() {
  const paths = dataPaths(ROOT);
  const withLlm = process.argv.includes("--llm");
  const withDescriptions = process.argv.includes("--descriptions");
  const refreshRules = process.argv.includes("--refresh-rules");
  const since = process.argv.find((a) => a.startsWith("--since="))?.slice(8) ?? null;
  if (refreshRules && withLlm) {
    console.error("--refresh-rules 与 --llm 互斥：前者只动规则文案，后者会覆盖非人工条目");
    process.exit(1);
  }
  const dryRun = !!process.env.DRY_RUN;
  const dates = selectDates(listDailyDates(paths), { since });

  const docs = new Map();
  for (const date of dates) {
    const doc = readJson(path.join(paths.dailyDir, `${date}.json`));
    if (doc?.entries?.length) docs.set(date, doc);
  }
  console.log(
    `# backfill-interpretations: ${docs.size} day(s)${since ? ` since ${since}` : ""}${withLlm ? ", LLM" : ""}${
      dryRun ? ", DRY_RUN" : ""
    }`
  );

  // 同一项目多天上榜，介绍 / 亮点只算一次
  const byRepo = new Map();
  for (const doc of docs.values()) {
    for (const entry of doc.entries) {
      if (!byRepo.has(entry.full_name)) byRepo.set(entry.full_name, entry);
    }
  }

  const client = createClient({ token: resolveToken() });
  let descriptions = new Map();

  if (withDescriptions) {
    const missing = [...byRepo.keys()].filter((name) => !byRepo.get(name).description);
    console.log(`descriptions to fetch: ${missing.length}`);
    descriptions = await fetchDescriptions(client, missing, console.log);
  }

  let llmMap = new Map();
  if (withLlm) {
    const limit = config.interpretation?.readmeExcerptLength ?? 2600;
    const projects = [...byRepo.values()].map(toProject);
    for (const [i, project] of projects.entries()) {
      console.log(`  [${i + 1}/${projects.length}] readme ${project.full_name} …`);
      project.readmeExcerpt = await fetchReadmeExcerpt(client, project.full_name, { limit });
    }
    console.log(`readme: ${projects.filter((p) => p.readmeExcerpt).length}/${projects.length} excerpt(s) fetched`);
    // llmInterpretation 单次只处理 maxEntries 条，仓库多于一批时按批调用
    const batchSize = config.interpretation?.maxEntries ?? 10;
    for (let i = 0; i < projects.length; i += batchSize) {
      const batch = projects.slice(i, i + batchSize);
      const produced = await llmInterpretation(batch, { log: console.log });
      for (const [name, value] of produced) llmMap.set(name, value);
    }
  }
  const stats = client.stats();
  if (stats.calls > 0) {
    console.log(`API calls: ${stats.calls} (retries ${stats.retries}, timeouts ${stats.timeouts})`);
  }

  let daysChanged = 0;
  let counters = { why: 0, intro: 0, cardLine: 0, highlights: 0, description: 0, refreshed: 0 };

  for (const [date, doc] of docs) {
    let touched = false;
    for (const entry of doc.entries) {
      if (descriptions.has(entry.full_name)) {
        const value = descriptions.get(entry.full_name) ?? "";
        if (value && value !== entry.description) {
          entry.description = value;
          counters.description++;
          touched = true;
        }
      }

      if (refreshRules) {
        if (refreshRuleEntry(entry, toProject(entry), doc.windowDays ?? 7).changed) {
          counters.refreshed++;
          touched = true;
        }
        continue;
      }

      const rule = ruleBasedInterpretation({ ...toProject(entry), windowDays: doc.windowDays ?? 7 });
      const llm = llmMap.get(entry.full_name);

      const next = {
        why: rule.why,
        intro: llm?.intro ?? entry.intro ?? rule.intro,
        cardLine: llm?.cardLine ?? entry.cardLine ?? rule.cardLine,
        highlights: llm?.highlights?.length ? llm.highlights : entry.highlights?.length ? entry.highlights : rule.highlights,
      };

      for (const [field, value] of Object.entries(next)) {
        const current = entry[field];
        if (value.zh !== current?.zh || value.en !== current?.en || (field === "highlights" && JSON.stringify(value) !== JSON.stringify(current))) {
          entry[field] = value;
          counters[field]++;
          touched = true;
        }
      }

      if (!entry.cons?.length) entry.cons = rule.cons;
      if (!entry.fitFor?.length) entry.fitFor = rule.fitFor;
      if (!entry.quickstart) entry.quickstart = rule.quickstart;
      if (llm) entry.interpretationSource = "llm";
    }

    if (!touched) continue;
    daysChanged++;
    if (dryRun) {
      const sample = doc.entries[0];
      console.log(`  ~ ${date} ${sample.full_name}\n      卡片：${sample.cardLine?.zh}\n      介绍：${sample.intro?.zh}`);
      continue;
    }
    saveDaily(paths, doc);
  }

  console.log(
    `changed: ${daysChanged} day(s) | why ${counters.why}, intro ${counters.intro}, cardLine ${counters.cardLine}, ` +
      `highlights ${counters.highlights}, description ${counters.description}, refreshed-rules ${counters.refreshed}` +
      (dryRun ? " (dry run, nothing written)" : "")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
