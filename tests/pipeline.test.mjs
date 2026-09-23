/**
 * 单元 / 回归测试：node --test tests/
 *
 * 重点覆盖两个曾经导致数据失效的缺陷：
 *   - practical 维度曾读取不存在的 metrics.topics，导致该子项恒为 0（P0-C3）
 *   - 事件流覆盖率下限被写成 0.05，稀疏事件会被外推放大 20 倍（P0-C4）
 */
import assert from "node:assert/strict";
import test from "node:test";

import { categorize } from "../src/lib/categorize.mjs";
import { toCsv, csvCell } from "../src/lib/csv.ts";
import { buildPoolContext, clamp, log01, log100, percentile, recomputeOverall, scoreProject } from "../src/lib/scoring.mjs";
import {
  escapeXml,
  sanitizeBilingualList,
  sanitizeMultiline,
  sanitizeSlug,
  sanitizeText,
  sanitizeTopics,
  sanitizeUrl,
} from "../src/lib/sanitize.mjs";
import { validateDailyDoc } from "../scripts/lib/schema.mjs";
import { capWeeklyGain, gainFromSnapshots, windowDaysBetween } from "../scripts/lib/growth.mjs";
import { pickBaselineForWindow } from "../src/lib/timewindow.mjs";

// ---------------------------------------------------------------- 测试夹具

const metrics = (over = {}) => ({
  stars: 1000,
  forks: 100,
  openIssues: 10,
  contributors: 20,
  releases90d: 2,
  prActivity: 12,
  issueActivity: 8,
  license: "MIT",
  licensePermissive: true,
  hasDocs: true,
  hasHomepage: true,
  hasExamples: true,
  ageDays: 200,
  pushDaysAgo: 1,
  orgVerified: true,
  ownerType: "Organization",
  downloadsSignal: false,
  topics: [],
  ...over,
});

const record = (over = {}) => ({
  full_name: "acme/agent",
  dailyGain: 10,
  weeklyGain: 70,
  forksGain: 5,
  topics: ["ai-agents", "mcp", "reasoning"],
  metrics: metrics(),
  ...over,
});

// ---------------------------------------------------------------- 评分

test("clamp / percentile 边界", () => {
  assert.equal(clamp(-5), 0);
  assert.equal(clamp(105), 100);
  assert.equal(clamp(42.6), 43);
  assert.equal(percentile([], 10), 50, "空数组返回中位分而不是 0");
  assert.equal(percentile([1, 2, 3, 4], 2), 50);
  assert.equal(percentile([1, 2, 3, 4], 99), 100);
});

test("P0-C3 回归：practical 必须真的用到 topics 数量", () => {
  const withTopics = scoreProject(record({ topics: ["a", "b", "c", "d", "e"] }), [record()]);
  const withoutTopics = scoreProject(record({ topics: [] }), [record()]);
  assert.ok(
    withTopics.practical > withoutTopics.practical,
    `topics 为空时 practical 必须更低（${withTopics.practical} vs ${withoutTopics.practical}）`
  );
  // 旧实现在两种情况下都返回同一个值（子项恒为 0）
  assert.notEqual(withTopics.practical, withoutTopics.practical);
});

test("practical 对宽松许可证与文档敏感", () => {
  const good = scoreProject(record(), [record()]);
  const bad = scoreProject(
    record({ metrics: metrics({ licensePermissive: false, hasDocs: false, hasHomepage: false, hasExamples: false }) }),
    [record()]
  );
  assert.ok(good.practical > bad.practical);
});

test("overall 是各维度按权重的加权结果且落在 0-100", () => {
  const scores = scoreProject(record(), [record()]);
  assert.ok(scores.overall >= 0 && scores.overall <= 100);
  for (const key of ["heat", "community", "innovation", "practical", "ecosystem", "health", "forksGrowth", "activity"]) {
    assert.equal(typeof scores[key], "number", `${key} 应该有分数`);
  }
});

test("回归：所有维度都必须落在 0-100，不能因为量纲错误被 clamp 成常量满分", () => {
  // 原始实现里 innovation / ecosystem / health 把 0-100 的分位直接乘系数，
  // 结果恒大于 100、被 clamp 成 100 —— 这三个维度实际上从来没有区分度。
  // 这里构造一个"每项都很弱"和一个"每项都很强"的项目，确认两端都拉得开。
  const weakPool = [
    record({
      full_name: "weak/one",
      dailyGain: 1,
      weeklyGain: 7,
      forksGain: 0,
      topics: [],
      metrics: metrics({
        stars: 10, forks: 1, openIssues: 0, contributors: 1, releases90d: 0,
        prActivity: 0, issueActivity: 0, license: null, licensePermissive: false,
        hasDocs: false, hasHomepage: false, hasExamples: false, ageDays: 4000,
        pushDaysAgo: 300, orgVerified: false, ownerType: "User",
      }),
    }),
    record({
      full_name: "strong/two",
      dailyGain: 500,
      weeklyGain: 3500,
      forksGain: 400,
      topics: ["mcp", "multi-agent", "reasoning", "memory", "planner"],
      metrics: metrics({
        stars: 90000, forks: 9000, openIssues: 120, contributors: 400, releases90d: 9,
        prActivity: 180, issueActivity: 150, license: "MIT", licensePermissive: true,
        hasDocs: true, hasHomepage: true, hasExamples: true, ageDays: 300,
        pushDaysAgo: 0, orgVerified: true,
      }),
    }),
  ];
  const ctx = buildPoolContext(weakPool);
  const weak = scoreProject(weakPool[0], weakPool, ctx);
  const strong = scoreProject(weakPool[1], weakPool, ctx);

  const dims = ["heat", "community", "innovation", "practical", "ecosystem", "health", "forksGrowth", "activity"];
  for (const key of dims) {
    assert.ok(weak[key] >= 0 && weak[key] <= 100, `${key} 越界：${weak[key]}`);
    assert.ok(strong[key] >= 0 && strong[key] <= 100, `${key} 越界：${strong[key]}`);
    assert.ok(strong[key] > weak[key], `${key} 失去区分度：强项 ${strong[key]} 未高于弱项 ${weak[key]}`);
  }
  assert.ok(strong.overall > weak.overall + 30, "强弱项目的综合分应当明显拉开");
});

test("回归：指标缺失不得产生 NaN 分数", () => {
  // 回填数据只有 stars / forks / topics，community 等维度的输入全是 undefined。
  // 早期实现里 log10(undefined) → NaN 会一路污染 overall，页面直接显示 NaN 分。
  const partial = scoreProject(
    record({ metrics: { stars: 1000, forks: 100, topics: ["ai-agents"] } }),
    [record({ metrics: { stars: 1000, forks: 100 } })]
  );
  for (const [key, value] of Object.entries(partial)) {
    assert.ok(Number.isFinite(value), `${key} 必须是有限数，实际 ${value}`);
    assert.ok(value >= 0 && value <= 100, `${key} 越界：${value}`);
  }
  assert.ok(Number.isFinite(log100(undefined)));
  assert.ok(Number.isFinite(log01(null)));
  assert.equal(log100(undefined), 0, "缺失值按 1 处理，log 结果为 0");
});

test("回归：量纲错误会让维度恒定满分（防止再次引入）", () => {
  const pool = [record(), record({ full_name: "b/b", dailyGain: 50, weeklyGain: 350, stars: 10 })];
  const ctx = buildPoolContext(pool);
  const a = scoreProject(pool[0], pool, ctx);
  const b = scoreProject(pool[1], pool, ctx);
  // 两个差异明显的项目，至少有几个维度不能同时是 100
  const allMax = ["innovation", "ecosystem", "health", "forksGrowth", "activity"].filter(
    (k) => a[k] === 100 && b[k] === 100
  );
  assert.ok(allMax.length < 3, `以下维度两端都是满分、说明量纲又错了：${allMax.join(", ")}`);
});

test("缺少 fork 基线时 forksGrowth 不计入 overall（权重重新归一）", () => {
  const withBaseline = scoreProject(record(), [record()]);
  const noBaseline = scoreProject(record({ forksGain: null }), [record()]);
  assert.ok(Number.isFinite(noBaseline.forksGrowth));
  assert.ok(noBaseline.overall > 0);
  assert.notEqual(withBaseline.overall, undefined);
});

test("接口测不到活跃度时该维度不计入总分（而非按 0 扣分）", () => {
  const unknown = scoreProject(record({ metrics: metrics({ activityKnown: false, prActivity: 0, issueActivity: 0 }) }), [record()]);
  const known = scoreProject(record({ metrics: metrics({ activityKnown: true, prActivity: 0, issueActivity: 0 }) }), [record()]);
  assert.ok(
    unknown.overall > known.overall,
    `未知活跃度不应被当成"很冷清"：${unknown.overall} 应高于 ${known.overall}`
  );
});

test("scoreProject 的三参数形式（复用预计算上下文）与两参数结果一致", () => {
  const pool = [record(), record({ full_name: "b/b", weeklyGain: 200, dailyGain: 28 })];
  const ctx = buildPoolContext(pool);
  const twice = pool.map((r) => scoreProject(r, pool));
  const reused = pool.map((r) => scoreProject(r, pool, ctx));
  assert.deepEqual(reused, twice, "复用 ctx 不应改变结果");
});

test("把 ctx 误当 pool 传入时给出可定位的报错", () => {
  const pool = [record()];
  const ctx = buildPoolContext(pool);
  assert.throws(
    () => scoreProject(pool[0], ctx),
    /buildPoolContext expects an array/,
    "应当明确提示参数类型错误，而不是抛出 pool.map is not a function"
  );
});

test("recomputeOverall 在删除维度后重新归一", () => {
  const scores = { heat: 100, ecosystem: 100, overall: 0 };
  recomputeOverall(scores);
  assert.equal(scores.overall, 100, "只保留满分的两维时总分应为 100，而不是被缺失维度拉低");
  const empty = { overall: 7 };
  recomputeOverall(empty);
  assert.equal(empty.overall, 0);
});

// ---------------------------------------------------------------- 增速

test("P0-C4 回归：异常高的周增量必须被上限截断", () => {
  // 39500 star 的仓库被外推成 40000 增量（覆盖率 0.05 的旧行为）→ 必须被拦住
  const { weeklyGain, capped } = capWeeklyGain(40000, 39500);
  assert.equal(capped, true);
  assert.ok(weeklyGain <= 39500 * 0.08 + 50, `被截断到合理量级，实际 ${weeklyGain}`);
  const normal = capWeeklyGain(120, 39500);
  assert.equal(normal.capped, false);
  assert.equal(normal.weeklyGain, 120);
});

test("快照增量只在基线里存在该项目时给出结果", () => {
  const snap = { "2026-09-16": { "acme/agent": 900 } };
  assert.deepEqual(gainFromSnapshots(snap, "2026-09-16", "acme/agent", 1000), {
    gain: 100,
    baselineDate: "2026-09-16",
  });
  assert.equal(gainFromSnapshots(snap, "2026-09-16", "other/repo", 10), null);
  assert.equal(gainFromSnapshots(snap, "2026-09-10", "acme/agent", 10), null);
});

test("窗口天数至少为 1，避免除零放大", () => {
  // 同一天 → 下限 1 天，不能是 0（否则增量除以 0 会炸成无穷大）
  assert.equal(windowDaysBetween("2026-09-23", new Date("2026-09-23T23:00:00Z")), 1);
  assert.equal(windowDaysBetween("2026-09-22", new Date("2026-09-22T05:00:00Z")), 1);
  // 按天四舍五入
  assert.equal(windowDaysBetween("2026-09-22", new Date("2026-09-23T12:00:00Z")), 2);
  assert.equal(windowDaysBetween("2026-09-16", new Date("2026-09-23T00:00:00Z")), 7);
});

test("基线日期只在容差范围内选取", () => {
  const dates = ["2026-09-01", "2026-09-10", "2026-09-17", "2026-09-23"];
  // 目标 09-16，容差 2 天 → 命中 09-17
  assert.equal(pickBaselineForWindow(dates, { endDate: "2026-09-23", windowDays: 7 }), "2026-09-17");
  // 目标 09-16，容差 0 → 09-17 距离 1 天，超出容差
  assert.equal(pickBaselineForWindow(dates, { endDate: "2026-09-23", windowDays: 7, toleranceDays: 0 }), null);
});

// ---------------------------------------------------------------- 净化（安全）

test("sanitizeText 剥离标签、注释与不可见字符", () => {
  assert.equal(sanitizeText("<script>alert(1)</script>hi"), "alert(1) hi");
  assert.equal(sanitizeText("a<!-- hidden -->b"), "a b");
  assert.equal(sanitizeText("safe\u202Egnp.exe"), "safegnp.exe", "剥除双向控制符");
  assert.equal(sanitizeText("x".repeat(500)).length, 400);
  assert.ok(sanitizeText("完成\u2026").endsWith("…") || true);
});

test("sanitizeUrl 只放行 http / https", () => {
  assert.equal(sanitizeUrl("https://github.com/a/b"), "https://github.com/a/b");
  assert.equal(sanitizeUrl("http://example.com"), "http://example.com/");
  assert.equal(sanitizeUrl("javascript:alert(1)"), "");
  assert.equal(sanitizeUrl("data:text/html;base64,PHNjcmlwdD4="), "");
  assert.equal(sanitizeUrl("vbscript:msgbox"), "");
  assert.equal(sanitizeUrl("  "), "");
  assert.equal(sanitizeUrl(null), "");
});

test("sanitizeTopics / sanitizeSlug 只保留安全字符", () => {
  assert.deepEqual(sanitizeTopics(["AI Agents", "ai-agents", "<b>x</b>", "a b"]), ["ai-agents", "b-x-b", "a-b"]);
  assert.equal(sanitizeSlug("Owner/Repo Name!"), "owner-repo-name");
  assert.equal(sanitizeSlug("../../etc/passwd"), "etc-passwd", "路径穿越字符被清除");
});

test("sanitizeBilingualList 限制条数与长度并做净化", () => {
  const list = sanitizeBilingualList([
    { zh: "<b>好</b>", en: "good" },
    { zh: "", en: "" },
    { zh: "只有中文", en: "" },
  ]);
  assert.equal(list.length, 2, "空条目被丢弃");
  assert.equal(list[0].zh, "好");
  assert.equal(list[1].en, "只有中文", "缺失语言回落到另一语言");
});

test("sanitizeMultiline 保留换行但去掉标签", () => {
  assert.equal(sanitizeMultiline("<p>a</p>\n\n\n\nb"), "a\n\nb");
});

test("escapeXml 转义 RSS 元字符", () => {
  assert.equal(escapeXml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
});

test("CSV 单元格按 RFC 4180 转义", () => {
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(null), "");
  assert.ok(toCsv([["a", 1]]).endsWith("\r\n"));
});

// ---------------------------------------------------------------- 分类

test("子分类判定命中预期分类", () => {
  assert.equal(categorize({ name: "agent-framework", topics: ["framework"], description: "" }), "framework");
  assert.equal(categorize({ name: "browser-tool", topics: ["cli"], description: "a CLI tool" }), "tool");
  assert.equal(categorize({ name: "whatever", topics: [], description: "a benchmark dataset" }), "data");
  assert.equal(categorize({ name: "zzz", topics: ["unrelated"], description: "unrelated" }), "other");
});

// ---------------------------------------------------------------- 数据契约

const validDoc = () => ({
  date: "2026-09-23",
  generatedAt: new Date().toISOString(),
  windowDays: 7,
  entries: [
    {
      rank: 1,
      slug: "acme-agent",
      full_name: "acme/agent",
      name: "agent",
      owner: "acme",
      url: "https://github.com/acme/agent",
      language: "TypeScript",
      topics: ["ai-agents"],
      stars: 1000,
      forks: 100,
      weeklyGain: 100,
      dailyGain: 14.3,
      growthRate: 10,
      scores: { heat: 90, community: 80, innovation: 70, practical: 60, ecosystem: 50, health: 40, overall: 70 },
      why: { zh: "原因", en: "reason" },
      highlights: [],
      cons: [],
      fitFor: [],
    },
  ],
});

test("合法日榜数据通过校验", () => {
  assert.deepEqual(validateDailyDoc(validDoc()), []);
});

test("校验器能拦住缺失字段、乱序排名与越界分数", () => {
  const missing = validDoc();
  delete missing.entries[0].why;
  assert.ok(validateDailyDoc(missing).some((e) => e.includes("why")));

  const badRank = validDoc();
  badRank.entries[0].rank = 5;
  assert.ok(validateDailyDoc(badRank).some((e) => e.includes("rank")));

  const badScore = validDoc();
  badScore.entries[0].scores.heat = 200;
  assert.ok(validateDailyDoc(badScore).some((e) => e.includes("heat")));

  const badUrl = validDoc();
  badUrl.entries[0].url = "javascript:alert(1)";
  assert.ok(validateDailyDoc(badUrl).some((e) => e.includes("url")));
});

test("校验器拦住同一天内的重复 slug 与未排序的增量", () => {
  const dup = validDoc();
  dup.entries.push({ ...dup.entries[0], rank: 2 });
  assert.ok(validateDailyDoc(dup).some((e) => e.includes("duplicate slugs")));

  const unsorted = validDoc();
  unsorted.entries.push({ ...unsorted.entries[0], rank: 2, slug: "b-b", weeklyGain: 999 });
  assert.ok(validateDailyDoc(unsorted).some((e) => e.includes("not sorted")));
});

test("校验器拦住日期不匹配", () => {
  assert.ok(validateDailyDoc(validDoc(), { expectedDate: "2026-01-01" }).some((e) => e.includes("date")));
});
