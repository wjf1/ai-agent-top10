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
 * 口径管理（T1.8）：每份日榜都带生成时的 `scoringVersion`。
 *   --safe              只重算版本落后于当前引擎的日期；若某天重算后综合分剧烈变动
 *                       （平均 |Δoverall| 超过阈值），视为配置写错，该天不写盘并列入人工复核。
 *   --since-version=N   只重算版本低于 N 的日期（用于分批推进历史口径）。
 *   写盘前自动把原文件备份到 .rescored-backup/<date>.json，便于回滚。
 *
 * 用法：
 *   node scripts/rescore.mjs                    # 重算所有指标完整的日期
 *   node scripts/rescore.mjs --safe             # 只重算版本落后的日期 + 变动熔断
 *   node scripts/rescore.mjs --since-version=2.0.0
 *   node scripts/rescore.mjs --date=2026-09-23
 *   node scripts/rescore.mjs --all              # 连 partial 日期也重算（慎用）
 *   node scripts/rescore.mjs --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scoringVersion } from "../src/lib/config.mjs";
import { buildPoolContext, scoreProject } from "../src/lib/scoring.mjs";
import { dataPaths, listDailyDates, readJson, writeJson } from "./lib/persist.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = dataPaths(ROOT);

const args = process.argv.slice(2);
const onlyDate = args.find((a) => a.startsWith("--date="))?.slice(7) ?? null;
const includePartial = args.includes("--all");
const dryRun = args.includes("--dry-run");
const safe = args.includes("--safe");
const sinceVersion = args.find((a) => a.startsWith("--since-version="))?.slice(16) ?? null;

/** 综合分平均变动超过该值即认为口径变更失控，该天拒绝写盘 */
const MAX_MEAN_OVERALL_DELTA = 25;

const CURRENT_VERSION = scoringVersion();
const BACKUP_DIR = path.join(ROOT, ".rescored-backup");
const metrics = readJson(paths.metricsFile, {});

/** 语义化版本比较：a < b 返回负数，相等 0，a > b 正数；缺失版本视为最低 */
function compareVersions(a, b) {
  const parts = (v) => String(v ?? "0.0.0").split(".").map((x) => Number.parseInt(x, 10) || 0);
  const [a1, a2, a3] = parts(a);
  const [b1, b2, b3] = parts(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

/** 写盘前备份原文件，出问题可回滚 */
function backupFile(date, file) {
  if (dryRun) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.copyFileSync(file, path.join(BACKUP_DIR, `${date}.json`));
}

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
const upToDate = [];
const guarded = [];

for (const date of listDailyDates(paths)) {
  if (onlyDate && date !== onlyDate) continue;

  const file = path.join(paths.dailyDir, `${date}.json`);
  const doc = readJson(file);
  if (!doc?.entries?.length) continue;

  const docVersion = doc.scoringVersion ?? null;

  // --since-version=N：只处理版本低于 N 的日期，高于或等于的跳过
  if (sinceVersion && docVersion && compareVersions(docVersion, sinceVersion) >= 0) {
    upToDate.push(`${date}（v${docVersion} ≥ v${sinceVersion}）`);
    continue;
  }

  // --safe：已经是最新口径的日期直接跳过，避免无意义改写历史文件
  if (safe && docVersion === CURRENT_VERSION) {
    upToDate.push(date);
    continue;
  }

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
  const beforeScores = doc.entries.map((e) => e.scores?.overall ?? 0);
  const rescoredScores = pool.map((r) => scoreProject(r, pool, ctx));

  const meanDelta =
    rescoredScores.reduce((s, r, i) => s + Math.abs(r.overall - beforeScores[i]), 0) /
    Math.max(1, rescoredScores.length);

  // 熔断：口径变更导致整体分数剧烈漂移，多半是配置写错了，宁可不动历史数据
  if (safe && meanDelta > MAX_MEAN_OVERALL_DELTA) {
    guarded.push(`${date}（平均 Δoverall ${meanDelta.toFixed(1)} > ${MAX_MEAN_OVERALL_DELTA}，疑似配置错误）`);
    continue;
  }

  const before = beforeScores.join(", ");
  const after = rescoredScores.map((s) => s.overall).join(", ");

  doc.entries = doc.entries.map((e, i) => ({
    ...e,
    scores: rescoredScores[i],
    scoringVersion: CURRENT_VERSION,
  }));
  doc.rescoredAt = new Date().toISOString();
  doc.scoringVersion = CURRENT_VERSION;

  if (!dryRun) {
    backupFile(date, file);
    writeJson(file, doc);
  }
  rescored++;
  console.log(`${date}: overall ${before}  →  ${after}  [v${docVersion ?? "?"} → v${CURRENT_VERSION}]`);
}

if (upToDate.length) {
  console.log(`\n已是当前口径 v${CURRENT_VERSION}（或高于 --since-version），跳过：${upToDate.length} 天`);
}
if (guarded.length) {
  console.log(`\n⚠ 重算变动过大，已拒绝写盘（请人工复核 config）：\n  ${guarded.join("\n  ")}`);
}
if (skipped.length) {
  console.log(`\n跳过（指标不完整，重算会改坏历史分数）：\n  ${skipped.join("\n  ")}`);
  console.log("如需强制重算这些日期：--all");
}
if (rescored && !dryRun) console.log(`\n原文件已备份至 ${path.relative(ROOT, BACKUP_DIR)}/`);
console.log(`\n${dryRun ? "[dry-run] " : ""}rescored ${rescored} day(s) → v${CURRENT_VERSION}`);
