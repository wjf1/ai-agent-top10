#!/usr/bin/env node
/**
 * 数据校验（CI 门禁，P1-A3）。
 *
 * 检查项：
 *   - 每个 daily/*.json 的结构、字段类型、评分范围、排名连续性
 *   - index.json 与 daily/ 目录一致，latest 指向真实存在的日期
 *   - 快照文件可解析、日期键与日榜不矛盾
 *   - 外部输入未夹带 HTML 标签 / 伪协议 URL
 *
 * 退出码非 0 时 CI 必须停止，不得推送数据。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkDailyFile } from "./lib/schema.mjs";
import { dataPaths, listDailyDates, readJson } from "./lib/persist.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = dataPaths(ROOT);

const problems = [];
const warnings = [];
const add = (list, msg) => list.push(msg);

const dates = listDailyDates(paths);
if (!dates.length) add(problems, "src/data/daily/ has no JSON files");

for (const date of dates) {
  const doc = readJson(path.join(paths.dailyDir, `${date}.json`));
  if (!doc) {
    add(problems, `${date}: unreadable JSON`);
    continue;
  }
  const { ok, errors } = checkDailyFile(doc, { expectedDate: date });
  if (!ok) errors.forEach((e) => add(problems, `${date}: ${e}`));

  for (const entry of doc.entries ?? []) {
    const texts = [
      entry.description ?? "",
      entry.why?.zh ?? "",
      entry.why?.en ?? "",
      ...(entry.highlights ?? []).flatMap((h) => [h.zh ?? "", h.en ?? ""]),
      ...(entry.cons ?? []).flatMap((c) => [c.zh ?? "", c.en ?? ""]),
    ];
    for (const text of texts) {
      if (/<\s*(script|iframe|img|svg|object|embed)\b/i.test(text)) {
        add(problems, `${date}/${entry.full_name}: raw HTML markup in text field`);
      }
      if (/\bon[a-z]+\s*=/i.test(text)) {
        add(warnings, `${date}/${entry.full_name}: suspicious inline event handler text`);
      }
    }
    for (const field of ["url", "homepage"]) {
      const value = entry[field];
      if (value && !/^https?:\/\//i.test(value)) {
        add(problems, `${date}/${entry.full_name}.${field}: non-http(s) URL (${String(value).slice(0, 40)})`);
      }
    }
  }
}

const index = readJson(paths.indexFile);
if (!index) {
  add(problems, "src/data/index.json missing or unreadable");
} else {
  if (!Array.isArray(index.dates)) add(problems, "index.dates must be an array");
  const missing = (index.dates ?? []).filter((d) => !dates.includes(d));
  if (missing.length) add(problems, `index.dates references missing daily files: ${missing.join(", ")}`);
  const unindexed = dates.filter((d) => !(index.dates ?? []).includes(d));
  if (unindexed.length) add(problems, `daily files missing from index: ${unindexed.slice(0, 5).join(", ")}`);
  if (index.latest && !dates.includes(index.latest)) {
    add(problems, `index.latest (${index.latest}) has no daily file`);
  }
  if (index.latest && index.latest !== dates[0]) {
    add(warnings, `index.latest (${index.latest}) is not the newest daily file (${dates[0]})`);
  }
}

const starSnap = readJson(paths.starsFile, {});
if (typeof starSnap !== "object" || starSnap === null) add(problems, "snapshots/stars.json unreadable");
else {
  for (const [date, repos] of Object.entries(starSnap)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) add(problems, `snapshots/stars.json: bad date key ${date}`);
    if (typeof repos !== "object" || repos === null) add(problems, `snapshots/stars.json[${date}] is not an object`);
  }
}

const metricSnap = readJson(paths.metricsFile, {});
if (metricSnap && typeof metricSnap !== "object") add(problems, "snapshots/metrics.json unreadable");

// 跨日期重复 slug 不再产生冲突（路由已带日期），但值得记录
const slugDates = new Map();
for (const date of dates) {
  const doc = readJson(path.join(paths.dailyDir, `${date}.json`));
  for (const e of doc?.entries ?? []) {
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
