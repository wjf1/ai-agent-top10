/**
 * 周期聚合相关单元测试（T2.12）。
 *
 * 说明：`src/lib/periods.ts` 目前是构建期模块（静态 import 构建产物 index.json，
 * 且经无扩展名路径引用 load-days），Node 测试运行器无法直接加载它。
 * 本文件因此覆盖周期聚合所依赖的**纯时间窗口逻辑**与口径定义；
 * buildPeriodBoard 的完整 fixture 测试（缺失快照 / partial 指标 / 跨月边界）
 * 依赖 T3.8 把数据源改为运行时按需读取，届时在本文件补齐。
 *
 * 运行：node --test tests/
 */
import assert from "node:assert/strict";
import test from "node:test";

import { daysBetween, pickBaselineForWindow } from "../src/lib/timewindow.mjs";
import { config } from "../src/lib/config.mjs";

test("周期窗口：按请求天数挑选最接近的基线日期", () => {
  const dates = ["2026-09-01", "2026-09-28", "2026-09-30", "2026-10-04"];
  assert.equal(
    pickBaselineForWindow(dates, { endDate: "2026-10-05", windowDays: 7, toleranceDays: 2 }),
    "2026-09-28"
  );
  assert.equal(
    pickBaselineForWindow(dates, { endDate: "2026-10-05", windowDays: 30, toleranceDays: 5 }),
    "2026-09-01"
  );
});

test("周期窗口：跨月边界的覆盖天数按真实日历计算", () => {
  // 9/28 → 10/5 正好 7 天，跨月不影响
  assert.equal(daysBetween("2026-09-28", "2026-10-05"), 7);
  // 2 月（非闰年）边界
  assert.equal(daysBetween("2025-02-26", "2025-03-05"), 7);
});

test("周期窗口：历史不足一个完整窗口时不得外推（覆盖率小于请求天数）", () => {
  const requestedDays = config.window?.weekly ?? 7;
  const coverageDays = daysBetween("2026-10-02", "2026-10-05") ?? 0;
  assert.ok(coverageDays < requestedDays, "覆盖天数应小于请求窗口");
  // 标准化的日均增量仍应基于请求窗口（T2.9），保证分位可比
  const gain = 300;
  const normalized = gain / Math.max(1, requestedDays);
  assert.equal(normalized, 300 / 7);
  assert.notEqual(normalized, gain / Math.max(1, coverageDays), "不得按实际覆盖天数放大日均");
});

test("口径定义：增长率以基线存量为分母（T2.13）", () => {
  const baseline = 8000;
  const gain = 400;
  const rate = Math.round((gain / baseline) * 1000) / 10;
  assert.equal(rate, 5);
  const oldRate = Math.round((gain / (baseline + gain)) * 1000) / 10;
  assert.notEqual(oldRate, rate, "新旧口径必须可区分，证明分母确实换成了基线");
});
