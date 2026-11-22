/**
 * 数据校验核心（纯函数，供 validate-data.mjs CLI 与单测共用）。
 *
 * 输入是已读入内存的数据结构，输出 { problems, warnings } 字符串数组——不碰文件系统、
 * 不碰 process，单测可以直接喂 fixture 断言各类坏数据被拦。此前这些检查内联在
 * validate-data.mjs 主流程里，门禁自身回归时 CI 不会变红；提取后由 tests/validate-core.test.mjs 钉住行为。
 */

/** 收集一条日榜内所有用户可见文本（与净化层的字段面保持同步）。 */
export function collectEntryTexts(entry) {
  return [
    entry.description ?? "",
    entry.why?.zh ?? "",
    entry.why?.en ?? "",
    entry.intro?.zh ?? "",
    entry.intro?.en ?? "",
    entry.cardLine?.zh ?? "",
    entry.cardLine?.en ?? "",
    ...(entry.highlights ?? []).flatMap((h) => [h.zh ?? "", h.en ?? ""]),
    ...(entry.cons ?? []).flatMap((c) => [c.zh ?? "", c.en ?? ""]),
    ...(entry.fitFor ?? []).flatMap((f) => [f.zh ?? "", f.en ?? ""]),
  ];
}

/** 外部输入不得夹带 HTML 标签 / 伪协议 URL（净化层被旁路写入时 CI 必须拦住，T1.6）。 */
export function checkEntryTextSafety(doc, date) {
  const problems = [];
  const warnings = [];
  for (const entry of doc.entries ?? []) {
    for (const text of collectEntryTexts(entry)) {
      if (/<\s*(script|iframe|img|svg|object|embed|style)\b/i.test(text)) {
        problems.push(`${date}/${entry.full_name}: raw HTML markup in text field`);
      }
      if (/\b(?:javascript|vbscript|livescript)\s*:/i.test(text) || /\bdata\s*:\s*text\/html/i.test(text)) {
        problems.push(`${date}/${entry.full_name}: pseudo-protocol URL in text field`);
      }
      if (/\bon[a-z]+\s*=/i.test(text)) {
        warnings.push(`${date}/${entry.full_name}: suspicious inline event handler text`);
      }
    }
    for (const field of ["url", "homepage"]) {
      const value = entry[field];
      if (value && !/^https?:\/\//i.test(value)) {
        problems.push(`${date}/${entry.full_name}.${field}: non-http(s) URL (${String(value).slice(0, 40)})`);
      }
    }
  }
  return { problems, warnings };
}

/** index.json 与 daily/ 目录双向一致，latest 指向真实存在的日期。 */
export function checkIndexConsistency(dates, index) {
  const problems = [];
  const warnings = [];
  if (!Array.isArray(index.dates)) problems.push("index.dates must be an array");
  const missing = (index.dates ?? []).filter((d) => !dates.includes(d));
  if (missing.length) problems.push(`index.dates references missing daily files: ${missing.join(", ")}`);
  const unindexed = dates.filter((d) => !(index.dates ?? []).includes(d));
  if (unindexed.length) problems.push(`daily files missing from index: ${unindexed.slice(0, 5).join(", ")}`);
  if (index.latest && !dates.includes(index.latest)) {
    problems.push(`index.latest (${index.latest}) has no daily file`);
  }
  if (index.latest && index.latest !== dates[0]) {
    warnings.push(`index.latest (${index.latest}) is not the newest daily file (${dates[0]})`);
  }
  return { problems, warnings };
}

/** stars 快照：日期键合法、值是有限数字（字符串 star 数会让增量计算产出 NaN，T2.11）。 */
export function checkStarSnapshot(starSnap) {
  const problems = [];
  if (typeof starSnap !== "object" || starSnap === null) return ["snapshots/stars.json unreadable"];
  for (const [date, repos] of Object.entries(starSnap)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`snapshots/stars.json: bad date key ${date}`);
    if (typeof repos !== "object" || repos === null) {
      problems.push(`snapshots/stars.json[${date}] is not an object`);
      continue;
    }
    for (const [repo, value] of Object.entries(repos)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        problems.push(`snapshots/stars.json[${date}][${repo}]: expected a finite number, got ${typeof value}`);
      }
    }
  }
  return problems;
}

/** metrics 快照：日期键合法、关键字段 number|null（类型不对会让评分把「测不到」当「很冷清」，T2.11）。 */
export function checkMetricSnapshot(metricSnap) {
  const problems = [];
  if (metricSnap && typeof metricSnap !== "object") return ["snapshots/metrics.json unreadable"];
  if (!metricSnap) return problems;
  const numericOrNull = ["contributors", "prActivity", "issueActivity", "ageDays", "pushDaysAgo", "stars", "forks"];
  for (const [date, repos] of Object.entries(metricSnap)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`snapshots/metrics.json: bad date key ${date}`);
    if (typeof repos !== "object" || repos === null) {
      problems.push(`snapshots/metrics.json[${date}] is not an object`);
      continue;
    }
    for (const [repo, record] of Object.entries(repos)) {
      if (typeof record !== "object" || record === null) {
        problems.push(`snapshots/metrics.json[${date}][${repo}] is not an object`);
        continue;
      }
      for (const field of numericOrNull) {
        const value = record[field];
        if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
          problems.push(`snapshots/metrics.json[${date}][${repo}].${field}: expected number or null, got ${typeof value}`);
        }
      }
      if (record.partial !== undefined && typeof record.partial !== "boolean") {
        problems.push(`snapshots/metrics.json[${date}][${repo}].partial: expected boolean`);
      }
    }
  }
  return problems;
}
