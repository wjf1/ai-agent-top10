/**
 * 评分历史序列（T3.2）。
 *
 * 从每日日榜聚合某项目的各维度评分时间序列，供详情页「评分趋势」使用。
 *
 * 两条硬约束：
 *   1. 缺失期不补零、不连线 —— 早期数据只有 6 个维度（forksGrowth / activity
 *      是后来才引入的），补零会伪造出「该维度曾经是 0 分」的假象。
 *   2. 只在项目连续在榜 >= 3 期时才展示 —— 2 个点画不出趋势，反而误导。
 */
import { appearances, loadDay } from "./load-days";

export interface ScorePoint {
  date: string;
  value: number;
}

/** 展示门槛：连续在榜期数 */
export const SCORE_TREND_MIN_STREAK = 3;

export function meetsScoreTrendGate(streak: number, minStreak = SCORE_TREND_MIN_STREAK): boolean {
  return Number.isFinite(streak) && streak >= minStreak;
}

/**
 * 聚合指定维度的评分序列。
 * 只收录该期确实带该维度分数的日期，缺失期直接跳过。
 */
export async function scoreSeriesForDims(
  slug: string,
  dimKeys: string[]
): Promise<Record<string, ScorePoint[]>> {
  const byKey: Record<string, ScorePoint[]> = {};
  for (const key of dimKeys) byKey[key] = [];

  for (const date of appearances(slug)) {
    const day = await loadDay(date);
    const entry = day?.entries?.find((e) => e.slug === slug);
    const scores = entry?.scores;
    if (!scores) continue;
    for (const key of dimKeys) {
      const value = scores[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        byKey[key].push({ date, value });
      }
    }
  }
  return byKey;
}

/** 只保留至少 2 个点（够画一条线）的维度 */
export function usableDims(series: Record<string, ScorePoint[]>): string[] {
  return Object.keys(series).filter((k) => series[k].length >= 2);
}
