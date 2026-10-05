/**
 * 单仓库指标采集（P1-F3 扩展维度）。
 *
 * 尽量用列表接口按时间倒序取少量页，而不是 Search API —— Search 有独立的
 * 30 次/分钟限制，45 个仓库 × 2 次查询会直接把它打爆。
 */
import { config } from "../../src/lib/config.mjs";
import { sanitizeTopics } from "../../src/lib/sanitize.mjs";

const DAY = 864e5;

const metricCfg = () => config.metrics ?? {};
const ACTIVITY_WINDOW_DAYS = () => metricCfg().activityWindowDays ?? 30;

const permissiveLicenses = () => new Set(config.licenses?.permissive ?? []);
const keywords = () => config.keywords ?? {};

/** 统计“最近 windowDays 天内新建”的条目数；列表已按 created 倒序，遇到更早的即可停。 */
async function countRecent(client, url, { since }) {
  const maxPages = metricCfg().activityPages ?? 1;
  let count = 0;
  for (let page = 1; page <= maxPages; page++) {
    const items = await client.gh(`${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!Array.isArray(items) || items.length === 0) break;
    let passedWindow = false;
    for (const it of items) {
      const created = it.created_at ?? it.updated_at;
      if (!created) continue;
      if (new Date(created) >= since) count++;
      else passedWindow = true;
    }
    if (passedWindow) break;
  }
  return count;
}

/**
 * 贡献者人数：分页采集并区分「数完」与「翻到上限被截断」。
 * 只取 1 页时超过 100 人的仓库会被截断成同一个数，该维度失去区分度；
 * 因此默认翻 contributorPages 页（默认 5 页 = 上限 500）。
 * 分页中途报错时降级为「当前页累计数」（partial 下界），不阻断整轮采集；
 * 第 1 页就失败则抛出，由调用方标记为「测不到」。
 */
export async function countContributors(client, fullName) {
  const pageSize = metricCfg().contributorPageSize ?? 100;
  const maxPages = metricCfg().contributorPages ?? 1;
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    let items;
    try {
      items = await client.gh(
        `/repos/${fullName}/contributors?per_page=${pageSize}&anon=false&page=${page}`
      );
    } catch (e) {
      // 已经有累计值就降级返回，避免整轮采集因单仓库分页失败而中断
      if (total > 0) return { contributors: total, capped: true, partial: true };
      throw e;
    }
    if (!Array.isArray(items) || items.length === 0) return { contributors: total, capped: false };
    total += items.length;
    if (items.length < pageSize) return { contributors: total, capped: false };
  }
  return { contributors: total, capped: true };
}

/**
 * @param {object} client  GitHub 客户端
 * @param {object} repo    Search API 返回的仓库对象
 * @returns {Promise<object>} 指标对象（不含身份字段，身份字段由日榜条目承载）
 */
/** 核心指标：全部来自 Search API 返回的仓库对象，零额外 API 调用 */
function coreFromRepo(repo, { now, permissive, kw }) {
  const topics = sanitizeTopics(repo.topics);
  const homepage = typeof repo.homepage === "string" ? repo.homepage : "";
  const spdx = repo.license?.spdx_id ?? null;
  return {
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.subscribers_count ?? repo.watchers_count ?? 0,
    openIssues: repo.open_issues_count,
    license: spdx && spdx !== "NOASSERTION" ? spdx : null,
    licensePermissive: spdx ? permissive.has(spdx) : false,
    hasDocs:
      !!repo.has_wiki ||
      !!repo.has_pages ||
      (typeof homepage === "string" && new RegExp(kw.docsHomepage ?? "docs|documentation|wiki", "i").test(homepage)) ||
      topics.some((t) => /doc|documentation|wiki/i.test(t)),
    hasHomepage: typeof homepage === "string" && homepage.trim().length > 0 && /^https?:\/\//i.test(homepage.trim()),
    hasExamples:
      !!repo.has_pages ||
      topics.some((t) => new RegExp(kw.examples ?? "example", "i").test(t)) ||
      (repo.size ?? 0) > 2000,
    ageDays: Math.round((now - new Date(repo.created_at)) / DAY),
    pushDaysAgo: Math.round((now - new Date(repo.pushed_at)) / DAY),
    orgVerified: repo.owner?.type === "Organization",
    ownerType: repo.owner?.type ?? "User",
    downloadsSignal: false,
    topics,
  };
}

export async function collectMetrics(
  client,
  repo,
  { now = new Date(), log = () => {}, coreOnly = false, previous = null } = {}
) {
  const fullName = repo.full_name;
  const activityWindowDays = ACTIVITY_WINDOW_DAYS();
  const sinceActivity = new Date(now.getTime() - activityWindowDays * DAY);
  const permissive = permissiveLicenses();
  const kw = keywords();

  // T2.5 分级采集：核心指标来自 Search API 返回的仓库对象，零额外调用；
  // 扩展指标（贡献者 / releases / PR / issue）各需 1..N 次调用，按 extendedIntervalDays
  // 降频采集。本轮不采时沿用上一份快照的值并标记 stale，绝不把「没采」当成「是 0」。
  if (coreOnly) {
    const prev = previous ?? {};
    return {
      ...coreFromRepo(repo, { now, permissive, kw }),
      contributors: prev.contributors ?? null,
      contributorsCapped: prev.contributorsCapped ?? false,
      contributorsPartial: prev.contributorsPartial ?? false,
      releases90d: prev.releases90d ?? null,
      prActivity: prev.prActivity ?? null,
      issueActivity: prev.issueActivity ?? null,
      activityWindowDays,
      activityKnown: prev.activityKnown ?? false,
      activityCapped: prev.activityCapped ?? false,
      metricsStale: true,
      extendedCollectedAt: prev.extendedCollectedAt ?? null,
    };
  }

  // contributors 采集不到时返回 null（"测不到"），而不是 0（"没有贡献者"）——
  // 后者会让社区 / 创新维度把仓库当成冷清项目错误扣分。
  let contributors = null;
  let contributorsCapped = false;
  let contributorsPartial = false;
  try {
    const c = await countContributors(client, fullName);
    contributors = c.contributors;
    contributorsCapped = c.capped;
    contributorsPartial = !!c.partial;
  } catch (e) {
    log(`  ~ ${fullName}: contributors unavailable (${e.status ?? "err"})`);
  }

  let releases90d = 0;
  try {
    const rel = await client.gh(`/repos/${fullName}/releases?per_page=${metricCfg().releasePageSize ?? 30}`);
    releases90d = (Array.isArray(rel) ? rel : []).filter(
      (x) => x.published_at && now - new Date(x.published_at) < 90 * DAY
    ).length;
  } catch (e) {
    log(`  ~ ${fullName}: releases unavailable (${e.status ?? "err"})`);
  }

  // 部分仓库（镜像仓、关闭了 issues/pulls 的仓库）这两个接口直接返回 404。
  // 此时"活跃度 = 0"是错误结论 —— 我们只是测不到。标成未知，让评分把该维度剔除，
  // 而不是当成"很冷清"去扣分。
  let prActivity = 0;
  let prKnown = false;
  try {
    prActivity = await countRecent(client, `/repos/${fullName}/pulls?state=all&sort=created&direction=desc`, {
      since: sinceActivity,
    });
    prKnown = true;
  } catch (e) {
    log(`  ~ ${fullName}: PR activity unavailable (${e.status ?? "err"})`);
  }

  let issueActivity = 0;
  let issuesKnown = false;
  try {
    issueActivity = await countRecent(
      client,
      `/repos/${fullName}/issues?state=all&sort=created&direction=desc`,
      { since: sinceActivity }
    );
    issuesKnown = true;
  } catch (e) {
    log(`  ~ ${fullName}: issue activity unavailable (${e.status ?? "err"})`);
  }

  return {
    ...coreFromRepo(repo, { now, permissive, kw }),
    contributors,
    contributorsCapped,
    contributorsPartial,
    releases90d,
    prActivity,
    issueActivity,
    activityWindowDays,
    activityKnown: prKnown || issuesKnown,
    activityCapped: prActivity >= (metricCfg().activityPages ?? 1) * 100 || issueActivity >= (metricCfg().activityPages ?? 1) * 100,
    metricsStale: false,
    extendedCollectedAt: now.toISOString(),
  };
}
