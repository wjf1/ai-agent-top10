/**
 * validate-core 门禁逻辑的行为钉子：门禁自身回归时 CI 也必须变红。
 * 此前这些检查内联在 validate-data.mjs 主流程里零测试——门禁坏了 CI 也不会红。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkEntryTextSafety,
  checkIndexConsistency,
  checkMetricSnapshot,
  checkStarSnapshot,
} from "../scripts/lib/validate-core.mjs";

const docWith = (over) => ({
  date: "2026-11-22",
  entries: [
    {
      full_name: "a/b",
      url: "https://github.com/a/b",
      homepage: null,
      ...over,
    },
  ],
});

test("V1: 干净日榜零问题零警告", () => {
  const r = checkEntryTextSafety(docWith({}), "2026-11-22");
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.warnings, []);
});

test("V2: text 字段夹带 HTML 标签 / 伪协议必须被拦（T1.6 净化旁路面）", () => {
  const r = checkEntryTextSafety(
    docWith({ description: "see <script>alert(1)</script>", "why": { zh: "javascript:void(0)" } }),
    "2026-11-22",
  );
  assert.equal(r.problems.length, 2, JSON.stringify(r.problems));
  assert.ok(r.problems.some((p) => p.includes("raw HTML markup")));
  assert.ok(r.problems.some((p) => p.includes("pseudo-protocol")));
});

test("V3: 内联事件处理器文本降级为 warning（不阻塞）", () => {
  const r = checkEntryTextSafety(docWith({ description: "click onclick= handler" }), "2026-11-22");
  assert.deepEqual(r.problems, []);
  assert.equal(r.warnings.length, 1);
});

test("V4: url / homepage 非 http(s) 必须被拦", () => {
  const r = checkEntryTextSafety(docWith({ homepage: "ftp://example.com" }), "2026-11-22");
  assert.ok(r.problems.some((p) => p.includes("homepage: non-http(s) URL")));
});

test("V5: index 一致性——缺文件 / 漏索引 / latest 悬空 / latest 非最新", () => {
  const dates = ["2026-11-22", "2026-11-21"];
  const ok = checkIndexConsistency(dates, { dates: [...dates], latest: "2026-11-22" });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.warnings, []);

  const bad = checkIndexConsistency(dates, { dates: ["2026-11-20"], latest: "2026-11-19" });
  assert.ok(bad.problems.some((p) => p.includes("missing daily files")));
  assert.ok(bad.problems.some((p) => p.includes("missing from index")));
  assert.ok(bad.problems.some((p) => p.includes("index.latest")));
  assert.equal(bad.problems.length, 3, JSON.stringify(bad.problems));

  const stale = checkIndexConsistency(dates, { dates: [...dates], latest: "2026-11-21" });
  assert.deepEqual(stale.problems, []);
  assert.equal(stale.warnings.length, 1, "latest 非最新应只是 warning");
});

test("V6: stars 快照——坏日期键 / 非数字值 / 非对象值", () => {
  const problems = checkStarSnapshot({
    "2026-11-22": { "a/b": 123, "c/d": "999" },
    "11-22": {},
  });
  assert.equal(problems.length, 2, JSON.stringify(problems));
  assert.ok(problems.some((p) => p.includes("bad date key 11-22")));
  assert.ok(problems.some((p) => p.includes("c/d")));
});

test("V7: metrics 快照——关键字段 number|null，partial 必须布尔（T2.11）", () => {
  const problems = checkMetricSnapshot({
    "2026-11-22": {
      "a/b": { stars: 10, forks: null, contributors: "20", partial: "yes" },
      "c/d": { stars: Number.POSITIVE_INFINITY },
    },
  });
  assert.ok(problems.some((p) => p.includes("contributors: expected number or null")));
  assert.ok(problems.some((p) => p.includes("partial: expected boolean")));
  assert.ok(problems.some((p) => p.includes("c/d")), "非有限数字也必须拦下");
  assert.equal(problems.length, 3, JSON.stringify(problems));
});
