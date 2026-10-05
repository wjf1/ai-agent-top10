/**
 * 指标采集单元测试（T2.12 拆分自 pipeline.test.mjs）。
 *
 * 覆盖 contributors 分页、翻到上限的截断标记、分页中途异常的降级行为。
 * PR / issue 的 404 降级与 releases 过滤通过 collectMetrics 的 try/catch 实现，
 * 需要 mock 整个 client（见下方集成式用例）。
 *
 * 运行：node --test tests/
 */
import assert from "node:assert/strict";
import test from "node:test";

import { collectMetrics, countContributors } from "../scripts/lib/metrics.mjs";

const makeClient = (pages) => ({
  calls: 0,
  async gh() {
    const items = pages[this.calls] ?? [];
    this.calls++;
    return items;
  },
});

test("T1.4: contributors 分页采集——数完即停，翻到上限则标记 capped 下界", async () => {
  const full = makeClient([Array(100).fill({ login: "u" }), Array(30).fill({ login: "u" })]);
  const done = await countContributors(full, "acme/big");
  assert.equal(done.contributors, 130, "两页相加应等于真实人数");
  assert.equal(done.capped, false, "不足一页说明已数完，不该标记截断");

  // 翻满配置上限（默认 5 页 = 500）仍未数完 → 标记为下界
  const maxPages = 5;
  const capped = makeClient(Array.from({ length: maxPages + 1 }, () => Array(100).fill({ login: "u" })));
  const hitCeiling = await countContributors(capped, "acme/huge");
  assert.equal(hitCeiling.contributors, maxPages * 100, "翻满上限时累计到上限值");
  assert.equal(hitCeiling.capped, true, "翻满上限必须标记为下界（真实人数可能更多）");

  const empty = makeClient([[]]);
  const none = await countContributors(empty, "acme/empty");
  assert.equal(none.contributors, 0);
  assert.equal(none.capped, false);
});

test("T1.4: 分页中途报错降级为累计下界；首页就失败则抛出交由调用方标为测不到", async () => {
  let call = 0;
  const flakyAfterFirst = {
    async gh() {
      call++;
      if (call === 1) return Array(100).fill({ login: "u" });
      const err = new Error("rate limited");
      err.status = 403;
      throw err;
    },
  };
  const partial = await countContributors(flakyAfterFirst, "acme/big");
  assert.equal(partial.contributors, 100, "应保留已累计的第 1 页");
  assert.equal(partial.capped, true);
  assert.equal(partial.partial, true, "必须标记为部分结果");

  const failFirst = { async gh() { throw new Error("boom"); } };
  await assert.rejects(() => countContributors(failFirst, "acme/dead"), /boom/);
});

test("collectMetrics: 贡献者接口 404 时记为 null（测不到），而非 0（没有贡献者）", async () => {
  const repo = {
    full_name: "acme/mirror",
    stargazers_count: 500,
    forks_count: 20,
    subscribers_count: 3,
    open_issues_count: 4,
    license: { spdx_id: "MIT" },
    has_wiki: false,
    has_pages: false,
    size: 100,
    created_at: "2025-01-01T00:00:00Z",
    pushed_at: "2026-10-04T00:00:00Z",
    owner: { type: "Organization" },
    topics: ["ai-agents"],
    homepage: "",
  };
  const client = {
    async gh(url) {
      if (url.includes("/contributors")) {
        const err = new Error("404");
        err.status = 404;
        throw err;
      }
      if (url.includes("/pulls") || url.includes("/issues")) {
        const err = new Error("404");
        err.status = 404;
        throw err;
      }
      return [];
    },
  };
  const m = await collectMetrics(client, repo, { now: new Date("2026-10-05T00:00:00Z"), log: () => {} });
  assert.equal(m.contributors, null, "测不到贡献者时必须为 null");
  assert.equal(m.activityKnown, false, "PR/issue 都 404 时活跃度应标记为未知");
  assert.equal(m.license, "MIT");
  assert.equal(m.ageDays > 0, true);
  assert.equal(m.metricsStale, false, "完整采集不应标记 stale");
});

test("T2.5: coreOnly 采集复用上一份扩展指标并标记 stale，且不发扩展请求", async () => {
  const repo = {
    full_name: "acme/agent",
    stargazers_count: 1234,
    forks_count: 56,
    subscribers_count: 7,
    open_issues_count: 8,
    license: { spdx_id: "Apache-2.0" },
    has_wiki: true,
    has_pages: false,
    size: 500,
    created_at: "2024-01-01T00:00:00Z",
    pushed_at: "2026-10-04T00:00:00Z",
    owner: { type: "User" },
    topics: ["ai-agents"],
    homepage: "",
  };
  const requested = [];
  const client = { async gh(url) { requested.push(url); return []; } };
  const previous = {
    contributors: 42,
    contributorsCapped: false,
    contributorsPartial: false,
    releases90d: 5,
    prActivity: 33,
    issueActivity: 21,
    activityKnown: true,
    activityCapped: false,
    extendedCollectedAt: "2026-10-03T00:00:00Z",
  };
  const m = await collectMetrics(client, repo, {
    now: new Date("2026-10-05T00:00:00Z"),
    log: () => {},
    coreOnly: true,
    previous,
  });
  assert.deepEqual(requested, [], "coreOnly 不得发起任何扩展指标请求");
  assert.equal(m.contributors, 42, "应沿用上一份扩展指标");
  assert.equal(m.prActivity, 33);
  assert.equal(m.activityKnown, true);
  assert.equal(m.metricsStale, true, "复用旧值时必须标记 stale");
  assert.equal(m.extendedCollectedAt, "2026-10-03T00:00:00Z", "应保留原始采集时间");
  // 核心指标仍来自本次 repo 对象，不得使用旧值
  assert.equal(m.stars, 1234);
  assert.equal(m.pushDaysAgo, 1);
  assert.equal(m.license, "Apache-2.0");
});
