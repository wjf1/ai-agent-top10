/**
 * 检索视图排序 / 快捷筛选单元测试（T3.1）。
 *
 * 覆盖：排序种类数与预设种类数（验收要求 ≥3 / ≥2）、排序方向、缺失分数排在最后、
 * 三种预设的过滤语义、路径构建与解析的默认值回落。
 *
 * 运行：node --test
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SORT,
  PRESETS,
  SORTS,
  applyPreset,
  parseView,
  sortProjects,
  viewParts,
} from "../src/lib/search-view.ts";

const mk = (over = {}) => ({
  entry: { stars: 100, scores: { overall: 50, heat: 50, innovation: 50, ecosystem: 50, practical: 50 } },
  gain: 0,
  appearances: 1,
  ...over,
});

test("T3.1: 排序与快捷筛选的种类数满足验收门槛", () => {
  assert.ok(SORTS.length >= 3, `排序需 ≥3 种，实际 ${SORTS.length}`);
  assert.ok(PRESETS.length >= 2, `快捷筛选需 ≥2 种，实际 ${PRESETS.length}`);
  assert.ok(SORTS.some((s) => s.key === DEFAULT_SORT), "默认排序必须存在于排序列表");
});

test("T3.1: sortProjects 按维度降序，分数缺失者排最后而不是当 0 分", () => {
  const a = mk({ entry: { stars: 1, scores: { overall: 90 } }, gain: 1 });
  const b = mk({ entry: { stars: 2, scores: { overall: 60 } }, gain: 2 });
  const missing = mk({ entry: { stars: 3, scores: {} }, gain: 3 });

  const byOverall = sortProjects([b, missing, a], "overall");
  assert.deepEqual(byOverall.map((p) => p.gain), [1, 2, 3], "90 → 60 → 缺失（排最后）");

  const byGain = sortProjects([a, b, missing], "gain");
  assert.deepEqual(byGain.map((p) => p.gain), [3, 2, 1], "默认按累计增量降序");

  const byStars = sortProjects([a, b, missing], "stars");
  assert.deepEqual(byStars.map((p) => p.entry.stars), [3, 2, 1]);
});

test("T3.1: 三种快捷筛选各自的过滤语义", () => {
  const rising = mk({ appearances: 2, gain: 10 });
  const veteran = mk({ appearances: 20, gain: 10 });
  const stalled = mk({ appearances: 1, gain: 0 });
  const eco = mk({ appearances: 5, gain: 1, entry: { stars: 1, scores: { ecosystem: 80, practical: 40 } } });
  const complete = mk({ appearances: 5, gain: 1, entry: { stars: 1, scores: { ecosystem: 40, practical: 75 } } });
  const plain = mk({ appearances: 5, gain: 1, entry: { stars: 1, scores: { ecosystem: 10, practical: 10 } } });

  const all = [rising, veteran, stalled, eco, complete, plain];

  const risingOut = applyPreset(all, "rising");
  assert.deepEqual(risingOut.map((p) => p), [rising], "本周新星：上榜 ≤3 期且有增量");

  const ecoOut = applyPreset(all, "ecosystem");
  assert.deepEqual(ecoOut.map((p) => p), [eco], "生态强者：ecosystem ≥ 70");

  const completeOut = applyPreset(all, "complete");
  assert.deepEqual(completeOut.map((p) => p), [complete], "高完成度：practical ≥ 70");

  assert.equal(applyPreset(all, null).length, all.length, "无预设时不过滤");
});

test("T3.1: 路径构建与解析——默认视图不进路径，非法值回落默认", () => {
  assert.deepEqual(viewParts({ sort: "gain", preset: null }), [], "默认视图应交给 /search/");
  assert.deepEqual(viewParts({ sort: "overall", preset: null }), ["s", "overall"]);
  assert.deepEqual(viewParts({ sort: "gain", preset: "rising" }), ["p", "rising"]);
  assert.deepEqual(viewParts({ sort: "overall", preset: "rising" }), ["p", "rising", "s", "overall"]);

  assert.deepEqual(parseView({ view: "s/heat" }), { sort: "heat", preset: null });
  assert.deepEqual(parseView({ view: "p/ecosystem" }), { sort: DEFAULT_SORT, preset: "ecosystem" });
  assert.deepEqual(parseView({ view: "p/rising/s/stars" }), { sort: "stars", preset: "rising" });
  // 非法输入不得抛错，回落默认
  assert.deepEqual(parseView({ view: "s/../../etc" }), { sort: DEFAULT_SORT, preset: null });
  assert.deepEqual(parseView({ view: "" }), { sort: DEFAULT_SORT, preset: null });
});
