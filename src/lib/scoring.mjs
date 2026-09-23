/**
 * 评分引擎（纯函数，无副作用）。
 *
 * 被两处复用：
 *   - scripts/fetch-daily.mjs  —— 每日抓取后为候选池打分
 *   - src/lib/periods.ts       —— 构建期用快照重算周榜 / 月榜
 *
 * 所有维度权重、公式系数、关键词都来自 config/scoring.json。
 * 新增维度：在配置的 dimensions 里加一项，并在 CALCULATORS 里补一个同名函数。
 */
import { config, dimensions, param } from "./config.mjs";

export function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/** 数值在数组中的分位（0-100）。空数组返回中位分，避免小样本被极端放大。 */
export function percentile(arr, v) {
  const xs = (arr ?? []).filter((x) => typeof x === "number" && Number.isFinite(x));
  if (!xs.length) return 50;
  return (xs.filter((x) => x <= v).length / xs.length) * 100;
}

/**
 * 分位归一化到 0-1。
 *
 * 必须用它而不是原始的 percentile（0-100）：维度公式是"系数 × 因子"的加和，
 * 系数之和已经是 100，因子必须落在 0-1；否则 `35 * percentile(...)` 会直接
 * 冲到 3500，被 clamp 成恒等于 100 —— 原始实现对 innovation / ecosystem /
 * health 都犯了这个问题，三个维度实际上一直是满分常量。
 */
export function pct01(arr, v) {
  return percentile(arr, v) / 100;
}

/** log10(v)/2：100 → 1，10000 → 2，用于把长尾量级压到 0-2 区间。缺失值按 1 处理。 */
export function log100(v) {
  return Math.log10(Math.max(1, finite(v))) / 2;
}

/** 同上但压到 0-1（10000 及以上视为封顶），供"系数 × 因子"公式使用。 */
export function log01(v) {
  return Math.min(1, log100(v) / 2);
}

const num = (v, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** 分位/对数函数的输入可能缺失（回填数据、新维度刚启用），必须先收敛成有限数 */
const finite = (v, fallback = 1) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** 从候选池预计算分位所需的数组，避免每个项目重复遍历。 */
export function buildPoolContext(pool) {
  // 显式报错：scoreProject 是三参数 (record, pool, ctx)，把 ctx 当 pool 传进来
  // 只会得到 "pool.map is not a function" 这种无从下手的报错。
  if (!Array.isArray(pool)) {
    throw new TypeError(
      `buildPoolContext expects an array of scored records, received ${pool === null ? "null" : typeof pool}`
    );
  }
  const pick = (fn) => pool.map(fn).filter((x) => typeof x === "number" && Number.isFinite(x));
  return {
    dailyGains: pick((p) => p.dailyGain),
    weeklyGains: pick((p) => p.weeklyGain),
    forksGains: pick((p) => p.forksGain),
    prActivities: pick((p) => p.metrics?.prActivity),
    issueActivities: pick((p) => p.metrics?.issueActivity),
    contributors: pick((p) => p.metrics?.contributors),
    ages: pick((p) => p.metrics?.ageDays),
    pushAges: pick((p) => p.metrics?.pushDaysAgo),
    forks: pick((p) => p.metrics?.forks),
    stars: pick((p) => p.metrics?.stars),
  };
}

const innovationRe = () => new RegExp(config.keywords?.innovation ?? "mcp", "i");

const CALCULATORS = {
  /** 热度趋势：增速分位（base 是下限，不是额外加分） */
  heat(p, _pool, ctx) {
    const weighted =
      param("heat", "dailyGainWeight", 60) * pct01(ctx.dailyGains, p.dailyGain) +
      param("heat", "weeklyGainWeight", 40) * pct01(ctx.weeklyGains, p.weeklyGain);
    return Math.max(param("heat", "base", 10), weighted);
  },

  community(p, _pool, ctx) {
    const m = p.metrics;
    const recencyDays = param("community", "pushRecencyDays", 14);
    return (
      param("community", "contributors", 30) * log01(m.contributors) +
      param("community", "pushRecency", 20) * (1 - Math.min(1, num(m.pushDaysAgo, 99) / recencyDays)) +
      param("community", "releases", 15) * (num(m.releases90d) > 0 ? 1 : param("community", "releasesMissFactor", 0.3)) +
      param("community", "openIssues", 15) * param("community", "issuesScale", 0.8) * log01(num(m.openIssues, 1)) +
      param("community", "age", 20) * pct01(ctx.ages, m.ageDays)
    );
  },

  innovation(p, _pool, ctx) {
    const m = p.metrics;
    const re = innovationRe();
    const topics = p.topics ?? m.topics ?? [];
    return (
      param("innovation", "weeklyGainWeight", 30) * pct01(ctx.weeklyGains, p.weeklyGain) +
      param("innovation", "freshness", 25) * (1 - Math.min(1, num(m.ageDays) / param("innovation", "freshnessDays", 730))) +
      param("innovation", "contributors", 20) * log01(m.contributors) +
      param("innovation", "topicWeight", 25) * (topics.some((t) => re.test(t)) ? 1 : param("innovation", "topicMissFactor", 0.4))
    );
  },

  /**
   * 实用完成度。
   * 注意：话题标签数取自条目自身的 topics 字段，而不是 metrics.topics ——
   * 后者在历史版本中并不存在，导致该子项恒为 0（P0-C3）。
   */
  practical(p) {
    const m = p.metrics;
    const topicCount = (p.topics ?? m.topics ?? []).length;
    return (
      param("practical", "license", 35) * (m.licensePermissive ? 1 : param("practical", "licenseMissFactor", 0.4)) +
      param("practical", "docs", 25) * (m.hasDocs ? 1 : param("practical", "docsMissFactor", 0.3)) +
      param("practical", "topics", 20) * Math.min(1, topicCount / param("practical", "topicsTarget", 5)) +
      param("practical", "examples", 20) *
        (m.hasExamples || m.hasHomepage ? 1 : param("practical", "examplesMissFactor", 0.4))
    );
  },

  ecosystem(p, _pool, ctx) {
    const m = p.metrics;
    return (
      param("ecosystem", "stars", 35) * pct01(ctx.stars, m.stars) +
      param("ecosystem", "forks", 25) * pct01(ctx.forks, m.forks) +
      param("ecosystem", "org", 20) * (m.orgVerified || m.ownerType === "Organization" ? 1 : param("ecosystem", "orgMissFactor", 0.4)) +
      param("ecosystem", "downloads", 20) * (m.downloadsSignal ? 1 : param("ecosystem", "downloadsMissFactor", 0.4))
    );
  },

  health(p, _pool, ctx) {
    const m = p.metrics;
    const ratioTarget = param("health", "issueRatioTarget", 0.02);
    const ratio = num(m.openIssues) / Math.max(1, num(m.stars, 1) * ratioTarget);
    return (
      param("health", "license", 35) * (m.license ? 1 : param("health", "licenseMissFactor", 0.2)) +
      param("health", "pushRecency", 25) * (1 - Math.min(1, num(m.pushDaysAgo, 99) / param("health", "pushRecencyDays", 30))) +
      param("health", "issueRatio", 20) * (1 - Math.min(1, ratio)) +
      param("health", "age", 20) * pct01(ctx.ages, m.ageDays)
    );
  },

  /** 分叉增速：窗口内 fork 增量。缺少基准快照时退化为“分叉规模分位”并标注不可靠。 */
  forksGrowth(p, _pool, ctx) {
    const m = p.metrics;
    const gain = p.forksGain;
    if (typeof gain !== "number" || !Number.isFinite(gain)) {
      return { value: percentile(ctx.forks, m.forks) * 0.5, reliable: false };
    }
    const rate = num(m.forks) > 0 ? gain / m.forks : 0;
    return (
      param("forksGrowth", "gainPercentile", 55) * pct01(ctx.forksGains, gain) +
      param("forksGrowth", "relativeRate", 25) * Math.min(1, rate / param("forksGrowth", "relativeRateTarget", 0.01)) +
      param("forksGrowth", "activityPercentile", 20) * pct01(ctx.forks, m.forks)
    );
  },

  /**
   * 迭代活跃度：近 30 天新建 PR / issue 数量分位。
   * 两个接口都拿不到数据时（镜像仓 / 关闭了 issues 的仓库返回 404）标记为不可靠，
   * 从总分里剔除——"测不到"不等于"不活跃"。
   */
  activity(p, _pool, ctx) {
    const m = p.metrics;
    if (m.activityKnown === false) return { value: 50, reliable: false };
    if (typeof m.prActivity !== "number" || typeof m.issueActivity !== "number") {
      return { value: 50, reliable: false };
    }
    return (
      param("activity", "prPercentile", 55) * pct01(ctx.prActivities, m.prActivity) +
      param("activity", "issuePercentile", 45) * pct01(ctx.issueActivities, m.issueActivity)
    );
  },
};

/**
 * 为单个项目打分。
 * @returns 形如 { heat, community, ..., overall } 的扁平对象。
 *          不可靠的维度仍给出数值（用于展示），但不计入 overall（权重按可靠维度重新归一）。
 */
export function scoreProject(record, pool, ctx = buildPoolContext(pool)) {
  const scores = {};
  const reliable = {};

  for (const d of dimensions) {
    const fn = CALCULATORS[d.key];
    if (!fn) continue;
    const out = fn(record, pool, ctx);
    const raw = out && typeof out === "object" ? out.value : out;
    // 任何非有限数都不允许进入分数：缺失指标曾经通过 log10(undefined) 变成 NaN
    // 一路污染 overall，最后页面显示 NaN 分。
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    scores[d.key] = clamp(raw);
    reliable[d.key] = !(out && typeof out === "object") || out.reliable !== false;
  }

  let weighted = 0;
  let weightSum = 0;
  for (const d of dimensions) {
    if (scores[d.key] == null || !reliable[d.key]) continue;
    weighted += scores[d.key] * d.weight;
    weightSum += d.weight;
  }
  scores.overall = weightSum > 0 ? clamp(weighted / weightSum) : 0;
  return scores;
}

/**
 * 按现有维度重新归一化 overall。
 * 用于构建期聚合：某维度数据缺失时把它从分数里摘掉，而不是按 0 计入。
 */
export function recomputeOverall(scores) {
  let weighted = 0;
  let weightSum = 0;
  for (const d of dimensions) {
    const value = scores[d.key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    weighted += value * d.weight;
    weightSum += d.weight;
  }
  scores.overall = weightSum > 0 ? clamp(weighted / weightSum) : 0;
  return scores;
}

/** 供 UI 渲染维度说明表 */
export function describeDimensions(lang = "zh") {
  const zh = lang === "zh";
  return dimensions.map((d) => ({
    key: d.key,
    label: zh ? d.zh : d.en,
    /** 小尺寸雷达图用的短名，避免 8 维时标签互相压住 */
    short: (zh ? d.shortZh : d.shortEn) ?? (zh ? d.zh : d.en),
    desc: zh ? d.descZh : d.descEn,
    weight: d.weight,
  }));
}
