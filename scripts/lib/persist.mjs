/**
 * 数据持久化层：日榜 JSON、star / 指标快照、构建期聚合索引。
 *
 * 索引（src/data/index.json）是为解决 P1-A2 而引入的：归档页与周期页只读这个
 * 聚合文件，不再把全部历史 JSON 拉进构建内存；详情页按需加载单日文件。
 */
import fs from "node:fs";
import path from "node:path";

export const RETENTION_DAYS = 120;

export function dataPaths(root) {
  const dataDir = path.join(root, "src", "data");
  return {
    dataDir,
    dailyDir: path.join(dataDir, "daily"),
    interpDir: path.join(dataDir, "interpretations"),
    snapshotsDir: path.join(dataDir, "snapshots"),
    starsFile: path.join(dataDir, "snapshots", "stars.json"),
    metricsFile: path.join(dataDir, "snapshots", "metrics.json"),
    indexFile: path.join(dataDir, "index.json"),
  };
}

export function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.warn(`  ! failed to read ${path.basename(file)}: ${e.message}`);
    return fallback;
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** 只保留最近 N 天的快照键，控制仓库体积增长 */
export function pruneByDate(obj, keepDays = RETENTION_DAYS, now = new Date()) {
  const cutoff = new Date(now.getTime() - keepDays * 864e5).toISOString().slice(0, 10);
  const out = {};
  for (const key of Object.keys(obj).sort()) {
    if (key >= cutoff) out[key] = obj[key];
  }
  return out;
}

export function saveDaily(paths, doc) {
  writeJson(path.join(paths.dailyDir, `${doc.date}.json`), doc);
}

export function saveSnapshots(paths, { date, stars, metrics, now = new Date() }) {
  const starSnap = pruneByDate(readJson(paths.starsFile, {}), RETENTION_DAYS, now);
  starSnap[date] = stars;
  writeJson(paths.starsFile, starSnap);

  const metricSnap = pruneByDate(readJson(paths.metricsFile, {}), RETENTION_DAYS, now);
  metricSnap[date] = metrics;
  writeJson(paths.metricsFile, metricSnap);

  return { starSnap, metricSnap };
}

/** 重建聚合索引：日期列表 + 每日摘要，供归档/周期页低成本读取 */
export function saveIndex(paths, { dates, now = new Date() }) {
  const days = [];
  for (const date of dates) {
    const doc = readJson(path.join(paths.dailyDir, `${date}.json`));
    if (!doc?.entries?.length) continue;
    const totalGain = doc.entries.reduce((s, e) => s + (e.weeklyGain ?? 0), 0);
    const top = doc.entries[0];
    days.push({
      date,
      count: doc.entries.length,
      totalGain,
      top: { full_name: top.full_name, slug: top.slug, weeklyGain: top.weeklyGain },
      categories: [...new Set(doc.entries.map((e) => e.category ?? "other"))],
      // 让 getStaticPaths 只用索引就能枚举路由，不必把全部历史 JSON 读进构建内存
      slugs: doc.entries.map((e) => e.slug),
    });
  }
  days.sort((a, b) => b.date.localeCompare(a.date));

  const index = {
    generatedAt: now.toISOString(),
    latest: days[0]?.date ?? null,
    dates: days.map((d) => d.date),
    days,
    categories: [...new Set(days.flatMap((d) => d.categories))].sort(),
  };
  writeJson(paths.indexFile, index);
  return index;
}

/** 扫描 daily/ 目录，得到已存在的日期（降序） */
export function listDailyDates(paths) {
  if (!fs.existsSync(paths.dailyDir)) return [];
  return fs
    .readdirSync(paths.dailyDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort()
    .reverse();
}
