/**
 * Star / fork 增速计算。
 *
 * 策略优先级（越靠前越准、越省 API 额度）：
 *   1. 快照序列  —— snapshots/stars.json 里已有每日 star 数，直接取“约 7 天前”那一期做差，
 *                    得到的是真实增量，且零 API 调用。这是默认路径。
 *   2. stargazers 精确分页 —— 快照缺基线时的回填，直接数 starred_at 落在窗口内的条目。
 *   3. events 降级 —— 超大仓库（stargazers 接口翻不过 400 页）用事件流估算，
 *                    并按覆盖率做外推上限约束；覆盖率过低直接拒绝出数（P0-C4）。
 */
import { config } from "../../src/lib/config.mjs";
import { daysBetween, pickBaselineForWindow } from "../../src/lib/timewindow.mjs";

const DAY = 864e5;

const growthCfg = () => config.growth ?? {};

/** 在快照日期列表里挑最接近“now - 7 天”的一期作为基线 */
export function pickBaselineDate(dates, { now = new Date() } = {}) {
  const cfg = growthCfg();
  return pickBaselineForWindow(dates, {
    endDate: new Date(now).toISOString().slice(0, 10),
    windowDays: cfg.baselineTargetDays ?? 7,
    toleranceDays: cfg.baselineToleranceDays ?? 2,
  });
}

/** 从快照序列取真实增量；基线里没有该项目则返回 null（交由 API 路径处理） */
export function gainFromSnapshots(snapshot, baselineDate, fullName, currentValue) {
  if (!baselineDate || !snapshot?.[baselineDate]) return null;
  const prev = snapshot[baselineDate][fullName];
  if (typeof prev !== "number" || !Number.isFinite(prev)) return null;
  if (typeof currentValue !== "number" || !Number.isFinite(currentValue)) return null;
  return { gain: Math.max(0, currentValue - prev), baselineDate };
}

/** 观察窗口天数（基线日期 → 现在），至少 1 天，避免除零放大 */
export function windowDaysBetween(baselineDate, now = new Date()) {
  return daysBetween(baselineDate, now);
}

/** 路径 2：stargazers 精确分页统计窗口内新增 */
export async function gainViaStargazers(client, { fullName, stars, since }) {
  const cfg = growthCfg();
  const pageSize = 100;
  const budget = cfg.stargazerPageBudget ?? 8;
  const lastPage = Math.min(400, Math.ceil(stars / pageSize) || 1);
  let recent = 0;
  let reachedWindowStart = false;

  for (let p = lastPage; p > Math.max(0, lastPage - budget); p--) {
    const items = await client.gh(`/repos/${fullName}/stargazers?per_page=${pageSize}&page=${p}`);
    if (!Array.isArray(items) || items.length === 0) break;
    const inWindow = items.filter((s) => new Date(s.starred_at) >= since);
    recent += inWindow.length;
    if (inWindow.length < items.length) {
      reachedWindowStart = true;
      break;
    }
  }
  // 翻到页尾仍未触达窗口起点，说明窗口比可翻页范围还长，结果只是下界
  return { gain: recent, exact: reachedWindowStart, source: "stargazers" };
}

/** 路径 3：事件流估算（超大仓库），带覆盖率闸门与外推上限 */
export async function gainViaEvents(client, { fullName, since, now = new Date() }) {
  const cfg = growthCfg();
  const budget = cfg.eventPageBudget ?? 3;
  const minCoverage = cfg.minCoverage ?? 0.3;
  const maxFactor = cfg.maxExtrapolationFactor ?? 3;

  let recent = 0;
  let oldest = new Date(now);
  let sawAny = false;

  for (let p = 1; p <= budget; p++) {
    const items = await client.gh(`/repos/${fullName}/events?per_page=100&page=${p}`);
    if (!Array.isArray(items) || items.length === 0) break;
    sawAny = true;
    recent += items.filter(
      (e) => (e.type === "WatchEvent" || e.type === "StarEvent") && new Date(e.created_at) >= since
    ).length;
    oldest = new Date(items[items.length - 1].created_at);
    if (oldest <= since) break;
  }

  const targetMs = now - since;
  const observedMs = sawAny ? Math.max(0, now - oldest) : 0;
  const coverage = targetMs > 0 ? Math.min(1, observedMs / targetMs) : 0;

  // 覆盖率不足：不外推。此前这里用 max(0.05, ...) 兜底，稀疏事件会被放大到 20 倍。
  if (coverage < minCoverage) {
    return {
      gain: null,
      coverage,
      exact: false,
      source: "events",
      unreliable: true,
      reason: `event coverage too low (${(coverage * 100).toFixed(1)}% < ${(minCoverage * 100).toFixed(0)}%)`,
    };
  }

  const factor = Math.min(1 / coverage, maxFactor);
  return {
    gain: Math.round(recent * factor),
    coverage,
    exact: coverage >= 0.999,
    estimated: coverage < 0.999,
    source: "events",
  };
}

/** 最终 sanity 网：一周新增不可能超过仓库总量的一定比例，超出说明估算失真 */
export function capWeeklyGain(weeklyGain, stars) {
  const maxRatio = growthCfg().maxWeeklyGainRatio ?? 0.08;
  const cap = Math.max(50, Math.round(stars * maxRatio));
  if (weeklyGain > cap) return { weeklyGain: cap, capped: true };
  return { weeklyGain, capped: false };
}

/**
 * 统一入口：算出该项目在“归一化 7 天窗口”下的新增 star。
 *
 * @returns {{weeklyGain:number, observedGain:number, observedDays:number,
 *            source:string, exact:boolean, coverage:number|null, capped:boolean}|null}
 *          返回 null 表示该项目无法得到可信增速，应跳过排名。
 */
export async function resolveStarGrowth(client, { fullName, stars, snapshots, snapshotDates, now = new Date(), since7d, log = () => {} }) {
  const baselineDate = pickBaselineDate(snapshotDates, { now });
  const fromSnap = gainFromSnapshots(snapshots, baselineDate, fullName, stars);

  let observed = null;
  let observedDays = null;
  let source = null;
  let exact = false;
  let coverage = null;

  if (fromSnap) {
    observed = fromSnap.gain;
    observedDays = windowDaysBetween(baselineDate, now);
    source = "snapshot";
    // 快照本身就是真实增量，误差只来自取样日期偏差，视为精确
    exact = Math.abs(observedDays - (growthCfg().baselineTargetDays ?? 7)) <= (growthCfg().baselineToleranceDays ?? 2);
  } else {
    const threshold = growthCfg().largeRepoStarThreshold ?? 39500;
    try {
      const via = stars > threshold
        ? await gainViaEvents(client, { fullName, since: since7d, now })
        : await gainViaStargazers(client, { fullName, stars, since: since7d });

      if (via.unreliable || via.gain == null) {
        log(`  ~ ${fullName}: skipped (${via.reason ?? "no reliable growth signal"})`);
        return null;
      }
      observed = via.gain;
      observedDays = via.exact ? (growthCfg().baselineTargetDays ?? 7) : 7;
      source = via.source;
      exact = !!via.exact;
      coverage = via.coverage ?? null;
    } catch (e) {
      log(`  ~ ${fullName}: skipped (${e.message})`);
      return null;
    }
  }

  const targetDays = growthCfg().baselineTargetDays ?? 7;
  const normalized = Math.round((observed * targetDays) / Math.max(1, observedDays));
  const { weeklyGain, capped } = capWeeklyGain(normalized, stars);

  return { weeklyGain, observedGain: observed, observedDays, source, exact, coverage, capped };
}

/** fork 增速：与 star 同源，从快照序列取差 */
export function resolveForkGrowth({ forkSnapshots, forks, fullName, snapshotDates, now = new Date() }) {
  const baselineDate = pickBaselineDate(snapshotDates, { now });
  const snap = forkSnapshots ?? {};
  const hit = gainFromSnapshots(snap, baselineDate, fullName, forks);
  if (!hit) return { forksGain: null, forksBaselineDate: null, forksWindowDays: null };
  return {
    forksGain: hit.gain,
    forksBaselineDate: baselineDate,
    forksWindowDays: windowDaysBetween(baselineDate, now),
  };
}
