/**
 * 时间窗口工具：快照基线选取与窗口天数换算。
 * 流水线（抓取时算增量）与构建期（聚合周榜/月榜）共用，避免两处口径不一致。
 */
import { config } from "./config.mjs";

const DAY = 864e5;

/** 归一化到 UTC 零点，避免时区导致同日不同值 */
export function dateToUtcMs(date) {
  const t = new Date(`${date}T00:00:00Z`).getTime();
  return Number.isNaN(t) ? null : t;
}

export function utcDateString(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const ta = typeof a === "string" ? dateToUtcMs(a) : new Date(a).getTime();
  const tb = typeof b === "string" ? dateToUtcMs(b) : new Date(b).getTime();
  if (ta == null || Number.isNaN(tb)) return null;
  return Math.max(1, Math.round((tb - ta) / DAY));
}

/**
 * 在候选日期里挑最接近 targetDate 的一期。
 * @param {string[]} dates  形如 2026-09-23
 * @param {string} targetDate
 * @param {number} toleranceDays
 */
export function pickClosestDate(dates, targetDate, toleranceDays) {
  const target = dateToUtcMs(targetDate);
  if (target == null) return null;
  const tol = toleranceDays * DAY;
  let best = null;
  let bestDelta = Infinity;
  for (const d of dates) {
    const t = dateToUtcMs(d);
    if (t == null) continue;
    const delta = Math.abs(t - target);
    if (delta > tol) continue;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = d;
    }
  }
  return best;
}

/** 取“now - N 天”对应的快照基线日期 */
export function pickBaselineForWindow(dates, { endDate, windowDays, toleranceDays = null } = {}) {
  const cfg = config.growth ?? {};
  const tol = toleranceDays ?? cfg.baselineToleranceDays ?? 2;
  const end = dateToUtcMs(endDate);
  if (end == null) return null;
  const target = new Date(end - windowDays * DAY).toISOString().slice(0, 10);
  return pickClosestDate(dates, target, tol);
}
