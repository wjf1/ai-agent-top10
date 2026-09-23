/**
 * 构建期周期聚合（P1-F1）：用已有的每日数据 + star / 指标快照算出周榜与月榜，
 * 不额外调用任何 API。
 *
 * 口径说明（重要）：
 *   - 增量取“基线快照 → 窗口结束日”的真实差值，不做线性外推到 7/30 天。
 *     当历史数据不足一个完整窗口时，榜单会显式标注实际覆盖天数，
 *     而不是把 6 天的增量放大成 30 天。
 *   - 当前指标优先取窗口内最近一份“完整”指标快照；只有回填出来的
 *     partial 记录时，依赖这些字段的维度会从总分里剔除（权重重新归一），
 *     而不是按 0 计入。
 */
import metricsData from "../data/snapshots/metrics.json";
import starsData from "../data/snapshots/stars.json";

import { config } from "./config.mjs";
import { ruleBasedInterpretation } from "./interpret.mjs";
import { index, loadDay, type Entry, type ScoreSet } from "./load-days";
import { buildPoolContext, recomputeOverall, scoreProject } from "./scoring.mjs";
import { daysBetween, pickBaselineForWindow } from "./timewindow.mjs";

export type PeriodKind = "weekly" | "monthly";

const stars = starsData as Record<string, Record<string, number>>;
const metricSnapshots = metricsData as Record<string, Record<string, any>>;

/** 回填出来的记录只有 stars/forks/topics，不能当作完整指标使用 */
function isFullMetrics(m: any): boolean {
  return !!m && !m.partial && typeof m.contributors === "number" && typeof m.prActivity === "number";
}

/** 维度剔除清单：partial 指标下这些维度没有可信输入 */
const DIMS_NEEDING_FULL_METRICS = ["community", "innovation", "practical", "health", "activity"];

export interface PeriodBoard {
  kind: PeriodKind;
  available: boolean;
  reason?: string;
  endDate: string;
  baselineDate: string | null;
  /** 实际覆盖天数（可能小于请求窗口） */
  coverageDays: number;
  requestedDays: number;
  entries: Entry[];
  poolSize: number;
  metricsComplete: boolean;
}

function emptyBoard(kind: PeriodKind, endDate: string, requestedDays: number, reason: string): PeriodBoard {
  return {
    kind,
    available: false,
    reason,
    endDate,
    baselineDate: null,
    coverageDays: 0,
    requestedDays,
    entries: [],
    poolSize: 0,
    metricsComplete: false,
  };
}

/** 取某项目在 <= endDate 的最近一份指标快照 */
function latestMetrics(fullName: string, endDate: string): { metrics: any; date: string; full: boolean } | null {
  const candidates = Object.keys(metricSnapshots)
    .filter((d) => d <= endDate)
    .sort()
    .reverse();
  for (const d of candidates) {
    const rec = metricSnapshots[d]?.[fullName];
    if (rec) return { metrics: rec, date: d, full: isFullMetrics(rec) };
  }
  return null;
}

/** 项目首次出现在榜单上的日期 */
function firstSeenDate(slug: string): string | undefined {
  const hits = index.days.filter((d) => d.slugs?.includes(slug)).map((d) => d.date);
  return hits.length ? hits.sort()[0] : undefined;
}

export async function buildPeriodBoard(
  kind: PeriodKind,
  { endDate }: { endDate?: string } = {}
): Promise<PeriodBoard> {
  const requestedDays = config.window?.[kind] ?? (kind === "weekly" ? 7 : 30);
  const dates = index.dates;
  const end = endDate ?? dates[0];
  if (!end) return emptyBoard(kind, "", requestedDays, "no daily data");

  const snapshotDates = Object.keys(stars).sort();
  const baselineDate = pickBaselineForWindow(snapshotDates, { endDate: end, windowDays: requestedDays });
  if (!baselineDate) {
    return emptyBoard(kind, end, requestedDays, `no snapshot close to ${requestedDays} days before ${end}`);
  }

  const coverageDays = daysBetween(baselineDate, end) ?? 0;
  const baselineStars = stars[baselineDate] ?? {};
  const baselineForks = Object.fromEntries(
    Object.entries(metricSnapshots[baselineDate] ?? {}).map(([k, v]: [string, any]) => [k, v?.forks])
  );

  // 窗口内出现过的所有项目，取最近一次出现的条目作为身份信息
  const windowDates = dates.filter((d) => d > baselineDate && d <= end);
  const latestEntryByProject = new Map<string, { entry: Entry; date: string }>();
  for (const date of windowDates) {
    const doc = await loadDay(date);
    for (const entry of doc?.entries ?? []) {
      if (!latestEntryByProject.has(entry.full_name)) {
        latestEntryByProject.set(entry.full_name, { entry, date });
      }
    }
  }

  const records: any[] = [];
  let anyComplete = false;
  for (const [fullName, { entry, date: lastSeenDate }] of latestEntryByProject) {
    const base = baselineStars[fullName];
    if (typeof base !== "number") continue; // 没有基线就没有窗口增量，不猜

    const current = latestMetrics(fullName, end);
    const topics = current?.metrics?.topics ?? entry.topics ?? [];
    const metrics = {
      stars: entry.stars,
      forks: entry.forks,
      openIssues: current?.metrics?.openIssues ?? entry.openIssues ?? 0,
      contributors: current?.metrics?.contributors,
      releases90d: current?.metrics?.releases90d,
      prActivity: current?.metrics?.prActivity,
      issueActivity: current?.metrics?.issueActivity,
      license: current?.metrics?.license ?? null,
      licensePermissive: current?.metrics?.licensePermissive ?? false,
      hasDocs: current?.metrics?.hasDocs ?? false,
      hasHomepage: current?.metrics?.hasHomepage ?? !!entry.homepage,
      hasExamples: current?.metrics?.hasExamples ?? false,
      ageDays: current?.metrics?.ageDays,
      pushDaysAgo: current?.metrics?.pushDaysAgo,
      orgVerified: current?.metrics?.orgVerified ?? false,
      ownerType: current?.metrics?.ownerType ?? "User",
      downloadsSignal: false,
      topics,
    };

    const full = current?.full ?? false;
    if (full) anyComplete = true;

    const gain = Math.max(0, entry.stars - base);
    const forksBase = baselineForks[fullName];
    const forksGain =
      typeof forksBase === "number" ? Math.max(0, entry.forks - forksBase) : null;

    records.push({
      full_name: fullName,
      entry,
      lastSeenDate,
      metrics,
      metricsComplete: full,
      topics,
      weeklyGain: gain,
      dailyGain: coverageDays > 0 ? gain / coverageDays : gain,
      growthRate: Math.round((gain / Math.max(1, entry.stars)) * 1000) / 10,
      forksGain,
      forksGrowthRate:
        typeof forksGain === "number" && entry.forks > 0
          ? Math.round((forksGain / Math.max(1, entry.forks)) * 1000) / 10
          : null,
      windowDays: coverageDays,
    });
  }

  if (!records.length) {
    return emptyBoard(kind, end, requestedDays, "no project had a baseline snapshot in this window");
  }

  const ctx = buildPoolContext(records);
  for (const r of records) {
    // 注意三参数签名：(record, pool, 预计算的分位上下文)
    const scores: ScoreSet = scoreProject(r, records, ctx) as unknown as ScoreSet;
    if (!r.metricsComplete) {
      for (const key of DIMS_NEEDING_FULL_METRICS) delete (scores as any)[key];
      recomputeOverall(scores as any);
    }
    r.scores = scores;
  }

  const topN = config.pool?.topN ?? 10;
  const ranked = records
    .sort((a, b) => b.weeklyGain - a.weeklyGain || b.growthRate - a.growthRate)
    .slice(0, topN);

  const entries: Entry[] = ranked.map((r, i) => {
    const e = r.entry;
    const interpretation = ruleBasedInterpretation(
      { ...r, category: e.category, url: e.url, name: e.name, windowDays: coverageDays },
      { lang: "zh" }
    );
    return {
      rank: i + 1,
      slug: e.slug,
      full_name: e.full_name,
      name: e.name,
      owner: e.owner,
      url: e.url,
      homepage: e.homepage,
      language: e.language,
      category: e.category,
      topics: e.topics,
      description: e.description ?? "",
      stars: e.stars,
      forks: e.forks,
      openIssues: r.metrics.openIssues,
      contributors: r.metrics.contributors,
      releases90d: r.metrics.releases90d,
      prActivity: r.metrics.prActivity,
      issueActivity: r.metrics.issueActivity,
      weeklyGain: r.weeklyGain,
      dailyGain: Math.round(r.dailyGain * 10) / 10,
      growthRate: r.growthRate,
      forksGain: r.forksGain,
      forksGrowthRate: r.forksGrowthRate,
      gainSource: "snapshot-window",
      gainExact: true,
      rankChange: null,
      scores: r.scores,
      why: interpretation.why,
      highlights: interpretation.highlights,
      cons: interpretation.cons,
      fitFor: interpretation.fitFor,
      quickstart: interpretation.quickstart,
      interpretationSource: "rules",
      firstSeen: firstSeenDate(e.slug),
      // 详情页链接必须落在该项目实际出现过的日期上
      lastSeenDate: r.lastSeenDate,
    };
  });

  return {
    kind,
    available: entries.length > 0,
    endDate: end,
    baselineDate,
    coverageDays,
    requestedDays,
    entries,
    poolSize: records.length,
    metricsComplete: anyComplete,
  };
}

/** 所有可用的周榜 / 月榜窗口（用于归档页与互链） */
export function periodWindows(kind: PeriodKind) {
  const requestedDays = config.window?.[kind] ?? (kind === "weekly" ? 7 : 30);
  const snapshotDates = Object.keys(stars).sort();
  const out: { endDate: string; baselineDate: string | null; coverageDays: number }[] = [];
  for (const endDate of index.dates) {
    const baselineDate = pickBaselineForWindow(snapshotDates, { endDate, windowDays: requestedDays });
    if (!baselineDate) continue;
    out.push({ endDate, baselineDate, coverageDays: daysBetween(baselineDate, endDate) ?? 0 });
  }
  return out;
}

/** 相邻周期窗口（用于上一期 / 下一期导航） */
export function periodNeighbours(kind: PeriodKind, endDate: string) {
  const windows = periodWindows(kind);
  const i = windows.findIndex((w) => w.endDate === endDate);
  if (i < 0) return { prev: null as string | null, next: null as string | null };
  return {
    prev: windows[i + 1]?.endDate ?? null, // 更早
    next: windows[i - 1]?.endDate ?? null, // 更新
  };
}

/** 所有快照日期（升序），作为对比图的统一横轴 */
export function snapshotDates(): string[] {
  return Object.keys(stars).sort();
}

/** 项目在每个快照日期的 star / fork 序列（趋势图数据源） */
export function starSeries(fullName: string, { limit = 90 }: { limit?: number } = {}) {
  const points: { date: string; stars: number | null; forks: number | null }[] = [];
  const allDates = Object.keys(stars).sort();
  for (const date of allDates) {
    const s = stars[date]?.[fullName];
    const f = metricSnapshots[date]?.[fullName]?.forks;
    if (typeof s !== "number" && typeof f !== "number") continue;
    points.push({ date, stars: typeof s === "number" ? s : null, forks: typeof f === "number" ? f : null });
  }
  return points.slice(-limit);
}
