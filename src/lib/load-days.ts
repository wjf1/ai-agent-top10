/**
 * 构建期数据加载。
 *
 * 设计目标（P1-A2）：归档页 / 周期页只读聚合索引 index.json（体积极小、恒定），
 * 需要完整条目时才按需 import 单日 JSON，避免把所有历史数据一次性 eager 进内存。
 */
import indexData from "../data/index.json";

export interface IndexDay {
  date: string;
  count: number;
  totalGain: number;
  top: { full_name: string; slug: string; weeklyGain: number };
  categories: string[];
  slugs?: string[];
}

export interface DayIndex {
  generatedAt: string;
  latest: string | null;
  dates: string[];
  days: IndexDay[];
  categories: string[];
}

export interface ScoreSet {
  heat?: number;
  community?: number;
  innovation?: number;
  practical?: number;
  ecosystem?: number;
  health?: number;
  forksGrowth?: number;
  activity?: number;
  overall: number;
}

export interface Bilingual {
  zh: string;
  en: string;
}

export interface Entry {
  rank: number;
  slug: string;
  full_name: string;
  name: string;
  owner: string;
  url: string;
  homepage?: string;
  language: string;
  category?: string;
  topics: string[];
  stars: number;
  forks: number;
  openIssues?: number;
  contributors?: number;
  releases90d?: number;
  prActivity?: number;
  issueActivity?: number;
  weeklyGain: number;
  dailyGain: number;
  growthRate: number;
  forksGain?: number | null;
  forksGrowthRate?: number | null;
  gainSource?: string;
  gainExact?: boolean;
  rankChange?: number | null;
  scores: ScoreSet;
  why: Bilingual;
  highlights: Bilingual[];
  cons: Bilingual[];
  fitFor: Bilingual[];
  quickstart?: string;
  interpretationSource?: string;
  firstSeen?: string;
  description?: string;
  /**
   * 周期榜专用：该项目在本窗口内最后一次出现在日榜的日期。
   * 详情页路由带日期，而窗口结束日当天该项目未必上榜，
   * 所以链接必须用这个日期，否则会 404。
   */
  lastSeenDate?: string;
}

export interface DailyDoc {
  date: string;
  generatedAt: string;
  windowDays: number;
  poolSize?: number;
  entries: Entry[];
}

export const index = indexData as unknown as DayIndex;

/** 懒加载：只有真正渲染某一天时才解析它的 JSON */
const dayLoaders = import.meta.glob<{ default: DailyDoc }>("../data/daily/*.json");

export async function loadDay(date: string): Promise<DailyDoc | null> {
  const loader = dayLoaders[`../data/daily/${date}.json`];
  if (!loader) return null;
  const mod = await loader();
  return mod.default;
}

/** 全部历史（仅用于确实需要全量的场景，如站点地图与 RSS） */
export async function loadAllDays(): Promise<DailyDoc[]> {
  const docs = await Promise.all(index.dates.map((d) => loadDay(d)));
  return docs.filter((d): d is DailyDoc => !!d);
}

export const dates = index.dates;
export const latestDate = index.dates[0] ?? null;

export function dayIndex(date: string): IndexDay | null {
  return index.days.find((d) => d.date === date) ?? null;
}

/** 项目 -> 出现过的日期（升序），用于趋势图与“历史排名” */
export function appearances(slug: string): string[] {
  return index.days
    .filter((d) => d.slugs?.includes(slug))
    .map((d) => d.date)
    .sort();
}

/** 相邻日期（归档页上下期导航用） */
export function neighbours(date: string): { prev: string | null; next: string | null } {
  const i = index.dates.indexOf(date);
  if (i < 0) return { prev: null, next: null };
  return {
    prev: index.dates[i + 1] ?? null, // 更早的一期
    next: index.dates[i - 1] ?? null, // 更新的一期
  };
}
