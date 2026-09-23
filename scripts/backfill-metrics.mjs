#!/usr/bin/env node
/**
 * backfill-metrics.mjs — 从已有的日榜 JSON 回填指标快照。
 *
 * 历史日榜只保存了榜单条目的 stars / forks / topics，没有 contributors、PR 活跃度
 * 等字段。回填出来的记录标 partial: true，构建期做周期聚合时只用它取基线
 * fork / star 数值，不会拿它当“当前完整指标”使用。
 *
 * 用法：node scripts/backfill-metrics.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dataPaths, listDailyDates, readJson, saveIndex, writeJson } from "./lib/persist.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = dataPaths(ROOT);

const metricSnap = readJson(paths.metricsFile, {});
let filled = 0;

for (const date of listDailyDates(paths)) {
  const doc = readJson(path.join(paths.dailyDir, `${date}.json`));
  if (!doc?.entries?.length) continue;
  metricSnap[date] ??= {};
  for (const entry of doc.entries) {
    if (metricSnap[date][entry.full_name]) continue;
    metricSnap[date][entry.full_name] = {
      stars: entry.stars,
      forks: entry.forks,
      openIssues: entry.openIssues ?? null,
      topics: entry.topics ?? [],
      partial: true,
    };
    filled++;
  }
}

writeJson(paths.metricsFile, metricSnap);
const days = Object.keys(metricSnap).length;
console.log(`backfilled ${filled} partial metric record(s) across ${days} day(s) → src/data/snapshots/metrics.json`);

// 顺带重建聚合索引：索引是派生数据，schema 变更（例如新增 slugs）后必须重新生成，
// 否则详情页的 getStaticPaths 会拿不到路由。
const index = saveIndex(paths, { dates: listDailyDates(paths) });
console.log(`rebuilt index.json: ${index.days.length} day(s), latest ${index.latest}`);
