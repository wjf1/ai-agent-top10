#!/usr/bin/env node
/**
 * 数据校验（CI 门禁，P1-A3）。
 *
 * 检查项：
 *   - 每个 daily/*.json 的结构、字段类型、评分范围、排名连续性（lib/schema.mjs）
 *   - index.json 与 daily/ 目录一致，latest 指向真实存在的日期
 *   - 快照文件可解析、日期键与日榜不矛盾
 *   - 外部输入未夹带 HTML 标签 / 伪协议 URL
 *
 * 检查逻辑本体在 lib/validate-core.mjs（纯函数，tests/validate-core.test.mjs 钉住行为，
 * 门禁自身回归时 CI 也会变红）；本文件只负责文件系统读取与退出码。
 *
 * 退出码非 0 时 CI 必须停止，不得推送数据。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkDailyFile } from "./lib/schema.mjs";
import { dataPaths, listDailyDates, readJson } from "./lib/persist.mjs";
import {
  checkEntryTextSafety,
  checkIndexConsistency,
  checkMetricSnapshot,
  checkStarSnapshot,
} from "./lib/validate-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = dataPaths(ROOT);

const problems = [];
const warnings = [];

const dates = listDailyDates(paths);
if (!dates.length) problems.push("src/data/daily/ has no JSON files");

const docByDate = new Map();
for (const date of dates) {
  const doc = readJson(path.join(paths.dailyDir, `${date}.json`));
  docByDate.set(date, doc);
  if (!doc) continue;
  const { ok, errors } = checkDailyFile(doc, { expectedDate: date });
  if (!ok) errors.forEach((e) => problems.push(`${date}: ${e}`));
  const safety = checkEntryTextSafety(doc, date);
  problems.push(...safety.problems);
  warnings.push(...safety.warnings);
}

const index = readJson(paths.indexFile);
if (!index) {
  problems.push("src/data/index.json missing or unreadable");
} else {
  const idx = checkIndexConsistency(dates, index);
  problems.push(...idx.problems);
  warnings.push(...idx.warnings);
}

problems.push(...checkStarSnapshot(readJson(paths.starsFile, {})));
problems.push(...checkMetricSnapshot(readJson(paths.metricsFile, {})));

// 跨日期重复 slug 不再产生冲突（路由已带日期），但值得记录
const slugDates = new Map();
for (const date of dates) {
  for (const e of docByDate.get(date)?.entries ?? []) {
    if (!slugDates.has(e.slug)) slugDates.set(e.slug, []);
    slugDates.get(e.slug).push(date);
  }
}

for (const w of warnings) console.warn(`warn  ${w}`);
console.log(`checked ${dates.length} daily file(s), ${slugDates.size} unique project slug(s)`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("data validation passed");
