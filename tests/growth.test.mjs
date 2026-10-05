/**
 * 增速模块单元测试（T2.12 拆分自 pipeline.test.mjs）。
 *
 * 覆盖三条路径：快照优先命中 / stargazers 分页 / events 覆盖率充足与不足，
 * 以及周增量 sanity 上限与基线日期选择。
 *
 * 运行：node --test tests/
 */
import assert from "node:assert/strict";
import test from "node:test";

import { capWeeklyGain, gainFromSnapshots, gainViaEvents, resolveStarGrowth, windowDaysBetween } from "../scripts/lib/growth.mjs";
import { pickBaselineForWindow } from "../src/lib/timewindow.mjs";

test("P0-C4 回归：异常高的周增量必须被上限截断", () => {
  // 39500 star 的仓库被外推成 40000 增量（覆盖率 0.05 的旧行为）→ 必须被拦住
  const { weeklyGain, capped } = capWeeklyGain(40000, 39500);
  assert.equal(capped, true);
  assert.ok(weeklyGain <= 39500 * 0.08 + 50, `被截断到合理量级，实际 ${weeklyGain}`);
  const normal = capWeeklyGain(120, 39500);
  assert.equal(normal.capped, false);
  assert.equal(normal.weeklyGain, 120);
});

test("T1.7: 事件流覆盖率偏低时返回保守下界而非跳过，且不做外推放大", async () => {
  const now = new Date("2026-10-05T00:00:00Z");
  const since = new Date(now.getTime() - 7 * 864e5);
  const eventClient = (pageItems) => ({
    async gh(url) {
      const page = Number(new URL(url, "https://x").searchParams.get("page") ?? 1);
      return pageItems[page - 1] ?? [];
    },
  });
  const dayAgo = new Date(now.getTime() - 864e5).toISOString();
  // 事件列表按时间倒序：整页都落在最近 1 天内 → 观测窗口 ≈1 天，覆盖率 ≈1/7 ≈ 14%
  const firstPage = [
    { type: "WatchEvent", created_at: dayAgo },
    { type: "WatchEvent", created_at: dayAgo },
    { type: "WatchEvent", created_at: dayAgo },
    { type: "PushEvent", created_at: dayAgo },
  ];
  const res = await gainViaEvents(eventClient([firstPage, []]), { fullName: "acme/huge", since, now });
  assert.equal(res.gain, 3, "只取观测到的真实条数，不做任何外推");
  assert.equal(res.unreliable, true, "必须标记不可靠");
  assert.equal(res.lowerBound, true, "必须标记为保守下界");
  assert.ok(res.coverage < 0.3, `覆盖率应低于阈值，实际 ${res.coverage}`);
});

test("T1.7: 覆盖率低于下界地板时仍跳过，避免把噪声当信号", async () => {
  const now = new Date("2026-10-05T00:00:00Z");
  const since = new Date(now.getTime() - 7 * 864e5);
  const eventClient = (items) => ({ async gh() { return items; } });
  // 仅覆盖最近 4 小时 → 覆盖率 ≈ 4/24/7 ≈ 2.4%，低于下界地板 5%
  const hoursAgo = new Date(now.getTime() - 4 * 3600e3).toISOString();
  const res = await gainViaEvents(eventClient([{ type: "WatchEvent", created_at: hoursAgo }]), {
    fullName: "acme/huge",
    since,
    now,
  });
  assert.equal(res.gain, null, "覆盖率过低时必须放弃出数");
  assert.equal(res.unreliable, true);
});

test("resolveStarGrowth 传播 unreliable / lowerBound 标记", async () => {
  const now = new Date("2026-10-05T00:00:00Z");
  const since7d = new Date(now.getTime() - 7 * 864e5);
  const dayAgo = new Date(now.getTime() - 864e5).toISOString();
  const client = {
    async gh(url) {
      if (url.includes("/events")) {
        const page = Number(new URL(url, "https://x").searchParams.get("page") ?? 1);
        return page === 1 ? [{ type: "WatchEvent", created_at: dayAgo }] : [];
      }
      return [];
    },
  };
  const out = await resolveStarGrowth(client, {
    fullName: "acme/huge",
    stars: 50000,
    snapshots: {},
    snapshotDates: [],
    now,
    since7d,
    log: () => {},
  });
  assert.ok(out, "超大仓库不应再被直接跳过");
  assert.equal(out.unreliable, true);
  assert.equal(out.lowerBound, true);
  assert.ok(out.weeklyGain > 0);
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
  const now = new Date("2026-10-05T00:00:00Z");
  assert.equal(windowDaysBetween("2026-10-05", now), 1);
  assert.equal(windowDaysBetween("2026-09-28", now), 7);
});

test("基线日期只在容差范围内选取", () => {
  const now = new Date("2026-10-05T00:00:00Z");
  const near = pickBaselineForWindow(["2026-09-28"], { endDate: "2026-10-05", windowDays: 7, toleranceDays: 2 });
  assert.equal(near, "2026-09-28");
  const far = pickBaselineForWindow(["2026-09-14"], { endDate: "2026-10-05", windowDays: 7, toleranceDays: 2 });
  assert.equal(far, null, "超出容差的基线不得被采用");
  void now;
});
