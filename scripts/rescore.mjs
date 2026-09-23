#!/usr/bin/env node
/**
 * rescore.mjs — 用快照里的指标重算已落盘日期的评分（不重新抓取、不调用网络）。
 *
 * 存在意义：评分规则被抽到 config/scoring.json 之后，规则一改就需要能让历史数据
 * 跟上同一套口径。没有这个脚本就只能重跑抓取，而抓取依赖网络与额度。
 *
 * 安全边界：只重算"指标完整"的日期。回填出来的 partial 指标缺 contributors /
 * prActivity / license，重算会把 community / practical / health 误判成缺数据，
 * 反而把历史分数改坏 —— 这类日期默认跳过并列出。
 *
 * 用法：
 *   node scripts/rescore.mjs                 # 重算所有指标完整的日期
 *   node scripts/rescore.mjs --date=2026-09-23
 *   node scripts/rescore.mjs --all           # 连 partial 日期也重算（慎用）
 *   node scripts/rescore.mjs --dry-run
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPoolContext, scoreProject } from "../src/lib/scoring.mjs";
import { dataPaths, listDailyDates, readJson, writeJson } from "./lib/persist.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = dataPaths(ROOT);

const args = process.argv.slice(2);
const onlyDate = args.find((a) => a.startsWith("--date="))?.slice(7) ?? null;
const includePartial = args.includes("--all");
const dryRun = args.includes("--dry-run");

const metrics = readJson(paths.metricsFile, {});

/** 指标是否完整到足以支撑全部维度 */
function metricsComplete(record) {
  if (!record || record.partial) return false;
  return (
    typeof record.contributors === "number" &&
    typeof record.prActivity === "number" &&
    typeof record.issueActivity === "number" &&
    typeof record.ageDays === "number" &&
    typeof record.pushDaysAgo === "number"
  );
}

let rescored = 0;
const skipped = [];

for (const date of listDailyDates(paths)) {
  if (onlyDate && date !== onlyDate) continue;

  const file = path.join(paths.dailyDir, `${date}.json`);
  const doc = readJson(file);
  if (!doc?.entries?.length) continue;

  const snapshot = metrics[date] ?? {};
  const complete = doc.entries.filter((e) => metricsComplete(snapshot[e.full_name])).length;
  if (!includePartial && complete < doc.entries.length) {
    skipped.push(`${date}（完整指标 ${complete}/${doc.entries.length}）`);
    continue;
  }

  // 用条目自身承载身份字段、用快照承载指标字段，拼出评分引擎需要的记录
  const pool = doc.entries.map((e) => {
    const m = snapshot[e.full_name] ?? {};
    return {
      ...e,
      metrics: { ...m, topics: e.topics ?? m.topics ?? [] },
      forksGain: typeof e.forksGain === "number" ? e.forksGain : null,
    };
  });

  const ctx = buildPoolContext(pool);
  const before = doc.entries.map((e) => e.scores?.overall ?? 0).join(", ");
  const rescoredScores = pool.map((r) => scoreProject(r, pool, ctx));
  const after = rescoredScores.map((s) => s.overall).join(", ");

  doc.entries = doc.entries.map((e, i) => ({ ...e, scores: rescoredScores[i] }));
  doc.rescoredAt = new Date().toISOString();

  if (!dryRun) writeJson(file, doc);
  rescored++;
  console.log(`${date}: overall ${before}  →  ${after}`);
}

if (skipped.length) {
  console.log(`\n跳过（指标不完整，重算会改坏历史分数）：\n  ${skipped.join("\n  ")}`);
  console.log("如需强制重算这些日期：--all");
}
console.log(`\n${dryRun ? "[dry-run] " : ""}rescored ${rescored} day(s)`);
