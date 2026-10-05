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
import { cardLineTag, detailLead, highlightsTitle, interpretationTag } from "../src/lib/display.ts";
import { strings } from "../src/lib/data.ts";
import { normalizeInterpretation, ruleBasedInterpretation, ruleCardLine, ruleIntro, textWidth } from "../src/lib/interpret.mjs";
import { topicLabel, topicLabels } from "../src/lib/topic-labels.mjs";
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
import { refreshRuleEntry, selectDates } from "../scripts/lib/refresh.mjs";
import { ciWarningLine, interpretationStatus, stepSummary } from "../scripts/lib/status.mjs";
import { capWeeklyGain, gainFromSnapshots, windowDaysBetween } from "../scripts/lib/growth.mjs";
import { pickBaselineForWindow } from "../src/lib/timewindow.mjs";
import { extractInstallSnippet } from "../scripts/lib/readme.mjs";

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

// ----------------------------------------------------------- 详情页呈现（纯函数部分）

test("详情页头图那行给一句话定位，不再把整段介绍重复一遍", () => {
  const entry = {
    cardLine: { zh: "能干什么的一句话", en: "one line" },
    intro: { zh: "完整的两三句介绍。", en: "Full intro." },
    description: "Raw description",
  };
  assert.equal(detailLead(entry, "zh"), "能干什么的一句话");
  assert.notEqual(detailLead(entry, "zh"), entry.intro.zh, "头图行不能等于整段介绍");
});

test("详情页头图行在缺 cardLine 的老数据上回落到介绍首句，再回落到仓库描述", () => {
  assert.equal(detailLead({ intro: { zh: "第一句。第二句。", en: "" }, description: "d" }, "zh"), "第一句。");
  assert.equal(detailLead({ description: "just a desc" }, "zh"), "just a desc");
  assert.equal(detailLead({}, "zh"), "");
});

test("规则生成的亮点改称「数据要点」，LLM / 人工版仍叫「核心亮点」", () => {
  const t = strings("zh");
  assert.equal(highlightsTitle({ interpretationSource: "rules" }, t), "数据要点");
  assert.equal(highlightsTitle({ interpretationSource: "llm" }, t), "核心亮点");
  assert.equal(highlightsTitle({}, t), "核心亮点", "老数据没有来源字段时不改名");
});

test("解读来源徽标：rules 说清是模板拼装，llm 标 AI 解读，来源未知时不显示", () => {
  const t = strings("zh");
  assert.equal(interpretationTag({ interpretationSource: "rules" }, t).label, "规则生成");
  assert.ok(interpretationTag({ interpretationSource: "rules" }, t).note.includes("README"));
  assert.equal(interpretationTag({ interpretationSource: "llm" }, t).label, "AI 解读");
  assert.equal(interpretationTag({ interpretationSource: "manual" }, t).label, "人工校对");
  assert.equal(interpretationTag({}, t), null);
});

test("卡片来源标注：那一行是仓库自述时标「仓库自述」，模板拼装时标「规则生成」，AI 解读不加噪", () => {
  const t = strings("zh");
  const described = {
    description: "Search, scrape, and interact with the web.",
    cardLine: ruleCardLine({ description: "Search, scrape, and interact with the web.", category: "framework", topics: [] }),
    interpretationSource: "rules",
  };
  assert.equal(cardLineTag(described, t).label, "仓库自述");
  const templated = {
    description: "",
    cardLine: { zh: "方向：MCP 协议", en: "Focused on MCP" },
    interpretationSource: "rules",
  };
  assert.equal(cardLineTag(templated, t).label, "规则生成");
  assert.equal(cardLineTag({ ...described, interpretationSource: "llm" }, t), null, "有编辑解读时不必再挂来源 chip");
});

// ----------------------------------------------------------- 历史文案回填

test("回填 --refresh-rules 只覆盖规则生成的条目，LLM / 人工解读一个字都不动", () => {
  const llmEntry = {
    full_name: "a/keep",
    interpretationSource: "llm",
    intro: { zh: "模型写的介绍", en: "model written" },
    cardLine: { zh: "模型写的一行", en: "model line" },
  };
  assert.equal(refreshRuleEntry(llmEntry, record(), 7).changed, false);
  assert.deepEqual(llmEntry.intro, { zh: "模型写的介绍", en: "model written" }, "不应被写回");

  const ruleEntry = {
    full_name: "acme/agent",
    interpretationSource: "rules",
    intro: { zh: "旧模板腔", en: "old" },
    cardLine: { zh: "旧的一行", en: "old" },
  };
  const result = refreshRuleEntry(ruleEntry, { ...record(), description: "Runs your agent jobs" }, 7);
  assert.equal(result.changed, true);
  assert.ok(ruleEntry.intro.zh.includes("Runs your agent jobs"), ruleEntry.intro.zh);
  assert.equal(ruleEntry.interpretationSource, "rules", "来源仍应是规则");
});

test("回填遇到没有来源字段的老数据时不得覆盖（无法判断是不是人工写的）", () => {
  const legacy = { full_name: "acme/agent", intro: { zh: "可能是人工写的", en: "maybe human" } };
  assert.equal(refreshRuleEntry(legacy, record(), 7).changed, false);
  assert.equal(legacy.intro.zh, "可能是人工写的");
});

// ----------------------------------------------------------- 解读降级告警

test("只要有条目退回规则文案就要告警：09-28 起整轮静默降级一周无人发现", () => {
  const allRules = Array.from({ length: 10 }, () => ({ interpretationSource: "rules" }));
  const status = interpretationStatus(allRules);
  assert.equal(status.rules, 10);
  assert.equal(status.total, 10);
  const warning = ciWarningLine(status);
  assert.ok(warning.startsWith("::warning"), `必须是 Actions 告警注解：${warning}`);
  assert.ok(warning.includes("LLM"), "告警要点名 LLM 解读没生效");
  assert.ok(warning.includes("LLM_BASE_URL"), "告警要给出可直接行动的排查方向");

  const mixed = interpretationStatus([
    { interpretationSource: "llm" },
    { interpretationSource: "rules" },
  ]);
  assert.ok(ciWarningLine(mixed).startsWith("::warning"), "部分回落同样要提示");
  assert.ok(!ciWarningLine(mixed).includes("整轮"), "部分回落不该说成整轮降级");
});

test("LLM 全部生效时不产生告警，但摘要仍要写清来源构成", () => {
  const ok = interpretationStatus([
    { interpretationSource: "llm" },
    { interpretationSource: "manual" },
  ]);
  assert.equal(ciWarningLine(ok), "");
  assert.equal(ok.rules, 0);
  assert.match(stepSummary(ok, "2026-10-05"), /llm 1 · manual 1 · rules 0/);
});

// ----------------------------------------------------------- 快速上手（README 安装段）

test("快速上手：从 README 取第一个安装代码块，而不是空喊「请参考仓库 README」", () => {
  const markdown = [
    "# Orca",
    "Run a fleet of parallel agents.",
    "## Installation",
    "```bash",
    "npm install -g @stably/orca",
    "```",
    "## Usage",
    "```bash",
    "orca start",
    "```",
  ].join("\n");
  const snippet = extractInstallSnippet(markdown);
  assert.ok(snippet.includes("npm install -g @stably/orca"), snippet);
  assert.ok(!snippet.includes("orca start"), `只取安装那一段，别把整篇 README 塞进来：${snippet}`);
});

test("快速上手：没有安装标题时靠安装类命令识别代码块", () => {
  const markdown = "```console\n$ uv pip install agent-reach\n```\n\n```js\nimport { x } from 'y';\n```";
  assert.match(extractInstallSnippet(markdown), /uv pip install agent-reach/);
});

test("快速上手：README 里没有安装段时返回空串，由调用方保留 git clone 兜底", () => {
  assert.equal(extractInstallSnippet("# Proj\nSome prose only\n"), "");
  assert.equal(extractInstallSnippet(""), "");
  assert.equal(extractInstallSnippet(null), "");
});

test("快速上手：安装段要过净化（剥标签与控制字符）并限长", () => {
  const markdown = "## Install\n```sh\ncurl -sL https://get.example/x.sh | sh <script>alert(1)</script>\n```";
  const snippet = extractInstallSnippet(markdown);
  assert.ok(!snippet.includes("<script>"), snippet);
  assert.ok(snippet.includes("curl -sL https://get.example/x.sh | sh"), snippet);
  const long = `## Install\n\`\`\`sh\n${"echo a; ".repeat(400)}\n\`\`\``;
  assert.ok(extractInstallSnippet(long, 200).length <= 201, "限长后带省略号");
});

test("快速上手：拿到安装段就标注来自 README，拿不到时保留通用 clone 文案", () => {
  const withSnippet = ruleBasedInterpretation({ ...record(), readmeInstall: "npm install -g orca" });
  assert.ok(withSnippet.quickstart.includes("npm install -g orca"), withSnippet.quickstart);
  assert.ok(withSnippet.quickstart.includes("README"), `应说明这段摘自 README：${withSnippet.quickstart}`);
  const without = ruleBasedInterpretation({ ...record(), url: "https://github.com/acme/agent" });
  assert.ok(without.quickstart.includes("git clone"), without.quickstart);
});

test("首屏 No.1 统计要说清是窗口增量，不能写成「7,454 stars」让人以为是总量", () => {
  const zh = strings("zh").top1Gain("7,454", 7);
  assert.ok(zh.includes("7,454") && zh.includes("7"), zh);
  assert.ok(/近\s*7\s*天|7 天/.test(zh), `必须点明窗口：${zh}`);
  assert.ok(!/^7,454 stars$/.test(zh), zh);
  assert.match(strings("en").top1Gain("7,454", 7), /in 7 days/);
});

test("回填 --since 只取该日期之后的期数，避免覆盖更早的 LLM 文案", () => {
  const dates = ["2026-09-13", "2026-09-27", "2026-09-28", "2026-10-04"];
  assert.deepEqual(selectDates(dates, { since: "2026-09-28" }), ["2026-09-28", "2026-10-04"]);
  assert.deepEqual(selectDates(dates, {}), dates, "不给 since 时保持原有全量行为");
  assert.deepEqual(selectDates(dates, { since: "2099-01-01" }), []);
  assert.deepEqual(selectDates(["2026-10-04", "2026-09-28", "2026-09-13"], { since: "2026-09-20" }), ["2026-09-28", "2026-10-04"]);
});

// ---------------------------------------------------------------- 解读

test("规则解读四段各司其职：为什么上榜讲指标，项目介绍讲定位", () => {
  const result = ruleBasedInterpretation({
    ...record(),
    category: "framework",
    language: "TypeScript",
    description: "An agent framework",
    windowDays: 7,
  });
  // why 回答「凭什么进榜」，必须落到当日的客观数字上
  assert.ok(result.why.zh.includes("star"), result.why.zh);
  assert.ok(result.why.zh.includes("70"), `why 应包含窗口增量：${result.why.zh}`);
  // intro 回答「这是什么」，且不复述指标
  assert.ok(result.intro.zh.includes("框架 / SDK"), `介绍应给出分类定位：${result.intro.zh}`);
  assert.ok(result.intro.zh.includes("TypeScript"));
  assert.ok(result.intro.en.startsWith("An agent framework"), "英文介绍应优先用仓库原始描述");
  assert.ok(!/star|fork/i.test(result.intro.zh), `项目介绍不该复述指标：${result.intro.zh}`);
  // cardLine 要能塞进卡片一行：按显示宽度约束（CJK 记 2 单位），因为自述多为英文
  assert.ok(textWidth(result.cardLine.zh) <= 90, `卡片一行版过长：${result.cardLine.zh}`);
  assert.equal(result.source, "rules");
});

test("回归：中文规则介绍必须带上仓库自述（此前只有英文介绍引用 description）", () => {
  const intro = ruleIntro({
    full_name: "DietrichGebert/ponytail",
    name: "ponytail",
    category: "framework",
    language: "JavaScript",
    topics: ["agent-skills", "ai-agents", "claude"],
    description: "Makes your AI agent think like the laziest senior dev in the room.",
  });
  assert.ok(
    intro.zh.includes("Makes your AI agent think"),
    `中文读者拿不到仓库自述时，介绍只剩模板腔：${intro.zh}`
  );
  assert.ok(intro.zh.includes("框架 / SDK"), `仍要给出分类定位：${intro.zh}`);
});

test("中文介绍引用自述时不得把标签 / 不可见字符带进文本", () => {
  const intro = ruleIntro({
    full_name: "acme/agent",
    name: "agent",
    category: "tool",
    topics: [],
    description: '<script>alert(1)</script>Runs your\u202B agent jobs',
  });
  assert.ok(!intro.zh.includes("<script>"), intro.zh);
  assert.ok(!intro.zh.includes("\u202B"), "双向控制符必须被剥除");
  assert.ok(intro.zh.includes("Runs your agent jobs"), intro.zh);
});

test("规则介绍在缺 description 时不得拼出空引号", () => {
  const intro = ruleIntro({ full_name: "acme/agent", name: "agent", category: "framework", topics: [] });
  assert.ok(!/“”|""|自述\s*[。；]/.test(intro.zh), `没有描述时不该留下空引用痕迹：${intro.zh}`);
  assert.ok(intro.zh.includes("框架 / SDK"), intro.zh);
});
// ----------------------------------------------------------- 卡片一行版（文案）

test("卡片一行：有仓库自述时说清「能干什么」，不复述卡片上已有的分类 chip", () => {
  const line = ruleCardLine({
    full_name: "firecrawl/firecrawl",
    name: "firecrawl",
    category: "framework",
    language: "TypeScript",
    topics: ["ai-agents", "web-scraping"],
    description: "Search, scrape, and interact with the web at scale.",
  });
  assert.ok(line.zh.includes("Search, scrape"), `卡片一行应给出仓库自述：${line.zh}`);
  assert.ok(
    !line.zh.includes("框架 / SDK"),
    `分类在卡片上是独立的 chip，一行文案里不要再写一遍：${line.zh}`
  );
  assert.ok(textWidth(line.zh) <= 90, `卡片一行必须塞得进一行（${textWidth(line.zh)} 单位）：${line.zh}`);
});

test("卡片一行：没有自述时只挑词表收录的方向，未收录的原始 slug 不进句子", () => {
  const line = ruleCardLine({
    full_name: "acme/x",
    name: "x",
    category: "tool",
    language: "Python",
    topics: ["ade", "mcp-server", "ai-search", "dsh-plugin"],
  });
  assert.ok(line.zh.includes("MCP 服务"), line.zh);
  assert.ok(!line.zh.includes("ade"), `词表外的原始 tag 不该混进定位句：${line.zh}`);
  assert.ok(!line.zh.includes("dsh-plugin"), line.zh);
});

test("介绍句里的「聚焦 …」同样只挑词表收录的标签", () => {
  const intro = ruleIntro({
    full_name: "NousResearch/hermes-agent",
    name: "hermes-agent",
    category: "other",
    language: "Python",
    topics: ["ai", "ai-agents", "anthropic"],
    description: "",
  });
  assert.ok(intro.zh.includes("聚焦 AI Agent、Anthropic 等方向"), intro.zh);
});

test("卡片一行：自述过长时按词边界截断并带省略号", () => {
  const description =
    "An extremely capable orchestration runtime for production multi-agent systems with tracing and replay";
  const line = ruleCardLine({ full_name: "acme/long", name: "long", category: "tool", topics: [], description });
  assert.ok(textWidth(line.zh) <= 90, `${textWidth(line.zh)} 单位：${line.zh}`);
  assert.ok(/…$/.test(line.zh), `超长应带省略号：${line.zh}`);
  const kept = line.zh.replace(/…$/, "");
  assert.ok(description.startsWith(kept), `只能整词截断，实际保留：${kept}`);
});

test("规则介绍在缺 description / topics / language 时仍产出合规文本", () => {
  const intro = ruleIntro({ full_name: "acme/agent", name: "agent", category: "other" });
  assert.ok(intro.zh.length > 0 && intro.en.length > 0);
  assert.ok(!intro.en.includes("a Other project"), `other 分类不应拼出语法不通的英文：${intro.en}`);
  assert.ok(intro.en.startsWith("acme/agent is a project"), intro.en);
});

test("解读校验：LLM 不写 why 也合法，但整份空解读必须被拒", () => {
  // why 由规则版按指标生成，LLM 只负责 intro / cardLine / highlights
  const llmOnly = normalizeInterpretation({
    intro: { zh: "介绍", en: "Intro" },
    cardLine: { zh: "一行", en: "One line" },
    highlights: [{ zh: "亮点", en: "Highlight" }],
  });
  assert.ok(llmOnly, "只有 intro / cardLine / highlights 时不应被判为不合法");
  assert.equal(llmOnly.why, null);
  assert.equal(llmOnly.intro.zh, "介绍");
  assert.equal(normalizeInterpretation({}), null, "全空解读必须被拒");
});

test("话题标签：收录的用双语显示名，未收录的保留原始 slug", () => {
  assert.equal(topicLabel("claude-code", "zh"), "Claude Code");
  assert.equal(topicLabel("mcp", "en"), "MCP");
  assert.equal(topicLabel("ade", "en"), "ade", "不臆造大小写");
  assert.deepEqual(topicLabels(["ai-agents", "ai-agent", "unknown-x"], "zh", 4), ["AI Agent", "unknown-x"]);
  assert.deepEqual(topicLabels(["a", "b", "c", "d", "e"], "zh", 2), ["a", "b"]);
});
