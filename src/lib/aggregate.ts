/**
 * 跨期聚合：把最近若干期的榜单条目按项目合并，供子分类榜（P2-F1）、
 * 话题页与检索页（P2-F3）使用。
 *
 * 增量口径：累计每一天的 dailyGain（= 当日 7 天增速 / 7），
 * 而不是把每一天的 weeklyGain 相加 —— 后者会让重叠的 7 天窗口重复计数。
 */
import { index, loadDay, type Entry } from "./load-days";

export interface AggregatedProject {
  entry: Entry;
  /** 最近一次出现的日期 */
  lastDate: string;
  firstDate: string;
  appearances: number;
  bestRank: number;
  /** 窗口内累计增量（按天累加，不重复计数） */
  gain: number;
  /** 每日 rank 序列（升序日期），用于迷你走势 */
  rankSeries: { date: string; rank: number }[];
}

export async function recentProjects({ window = 30 }: { window?: number } = {}): Promise<AggregatedProject[]> {
  const dates = index.dates.slice(0, window);
  const byProject = new Map<string, AggregatedProject>();

  // 从最早到最近遍历，保证 entry 最终保存的是最新一期
  for (const date of [...dates].reverse()) {
    const doc = await loadDay(date);
    for (const entry of doc?.entries ?? []) {
      const existing = byProject.get(entry.full_name);
      if (!existing) {
        byProject.set(entry.full_name, {
          entry,
          lastDate: date,
          firstDate: date,
          appearances: 1,
          bestRank: entry.rank,
          gain: entry.dailyGain ?? 0,
          rankSeries: [{ date, rank: entry.rank }],
        });
        continue;
      }
      existing.entry = entry;
      existing.lastDate = date;
      existing.appearances += 1;
      existing.bestRank = Math.min(existing.bestRank, entry.rank);
      existing.gain += entry.dailyGain ?? 0;
      existing.rankSeries.push({ date, rank: entry.rank });
    }
  }

  return [...byProject.values()].sort((a, b) => b.gain - a.gain);
}

export function filterByCategory(projects: AggregatedProject[], key: string) {
  return projects.filter((p) => (p.entry.category ?? "other") === key);
}

export function filterByTopic(projects: AggregatedProject[], tag: string) {
  const needle = tag.toLowerCase();
  return projects.filter((p) => (p.entry.topics ?? []).some((t) => t.toLowerCase() === needle));
}

/** 所有出现过的标签（按出现频次降序） */
export async function allTopics({ window = 30, limit = 80 }: { window?: number; limit?: number } = {}) {
  const projects = await recentProjects({ window });
  const counts = new Map<string, number>();
  for (const p of projects) {
    for (const topic of p.entry.topics ?? []) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

export interface SearchRecord {
  slug: string;
  full_name: string;
  name: string;
  language: string;
  category: string;
  topics: string[];
  stars: number;
  gain: number;
  bestRank: number;
  appearances: number;
  lastDate: string;
  haystack: string;
}

/** 检索用的扁平化记录：把可搜索字段预先拼成一个字符串，客户端只做 includes */
export function toSearchRecords(projects: AggregatedProject[]): SearchRecord[] {
  return projects.map((p) => ({
    slug: p.entry.slug,
    full_name: p.entry.full_name,
    name: p.entry.name,
    language: p.entry.language,
    category: p.entry.category ?? "other",
    topics: p.entry.topics ?? [],
    stars: p.entry.stars,
    gain: Math.round(p.gain),
    bestRank: p.bestRank,
    appearances: p.appearances,
    lastDate: p.lastDate,
    haystack: [
      p.entry.full_name,
      p.entry.name,
      p.entry.owner,
      p.entry.language,
      p.entry.category ?? "",
      ...(p.entry.topics ?? []),
      p.entry.description ?? "",
    ]
      .join(" ")
      .toLowerCase(),
  }));
}
