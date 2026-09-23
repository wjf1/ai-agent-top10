/**
 * 轻量结构校验（不引入额外依赖）。
 * 用于 CI 的“数据校验”步骤：结构不完整时让 job 失败，避免脏数据被推送（P1-A3）。
 */
import { config, dimensionKeys } from "../../src/lib/config.mjs";

const isStr = (v) => typeof v === "string" && v.length > 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function validateEntry(entry, { index = 0, errors = [] } = {}) {
  const at = `entries[${index}]`;
  if (!entry || typeof entry !== "object") {
    errors.push(`${at}: not an object`);
    return errors;
  }
  for (const field of ["slug", "full_name", "name", "owner", "url"]) {
    if (!isStr(entry[field])) errors.push(`${at}.${field}: missing or not a string`);
  }
  for (const field of ["rank", "stars", "forks", "weeklyGain", "dailyGain", "growthRate"]) {
    if (!isNum(entry[field])) errors.push(`${at}.${field}: missing or not a number`);
  }
  if (!entry.why || !isStr(entry.why.zh) || !isStr(entry.why.en)) {
    errors.push(`${at}.why: requires both zh and en strings`);
  }
  if (!entry.scores || typeof entry.scores !== "object") {
    errors.push(`${at}.scores: missing`);
  } else {
    const known = new Set([...dimensionKeys, "overall"]);
    for (const [key, value] of Object.entries(entry.scores)) {
      if (!known.has(key)) errors.push(`${at}.scores.${key}: unknown dimension`);
      if (!isNum(value) || value < 0 || value > 100) errors.push(`${at}.scores.${key}: must be 0-100`);
    }
    if (!isNum(entry.scores.overall)) errors.push(`${at}.scores.overall: missing`);
  }
  if (!Array.isArray(entry.topics)) errors.push(`${at}.topics: must be an array`);
  if (typeof entry.url === "string" && !/^https?:\/\//.test(entry.url)) {
    errors.push(`${at}.url: must be http(s)`);
  }
  return errors;
}

export function validateDailyDoc(doc, { expectedDate = null, topN = null, errors = [] } = {}) {
  if (!doc || typeof doc !== "object") return [...errors, "document: not an object"];
  if (!isStr(doc.date)) errors.push("date: missing");
  if (expectedDate && doc.date !== expectedDate) errors.push(`date: expected ${expectedDate}, got ${doc.date}`);
  if (!Array.isArray(doc.entries) || doc.entries.length === 0) {
    errors.push("entries: must be a non-empty array");
    return errors;
  }
  const limit = topN ?? config.pool?.topN ?? 10;
  if (doc.entries.length > limit) errors.push(`entries: ${doc.entries.length} exceeds topN ${limit}`);

  const ranks = doc.entries.map((e) => e?.rank);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) errors.push(`entries[${i}].rank: expected ${i + 1}, got ${ranks[i]}`);
  }
  const slugs = doc.entries.map((e) => e?.slug);
  if (new Set(slugs).size !== slugs.length) errors.push("entries: duplicate slugs within the same day");

  const gains = doc.entries.map((e) => e?.weeklyGain);
  for (let i = 1; i < gains.length; i++) {
    if (!(gains[i - 1] >= gains[i])) errors.push(`entries: not sorted by weeklyGain at index ${i}`);
  }

  doc.entries.forEach((e, i) => validateEntry(e, { index: i, errors }));
  return errors;
}

export function checkDailyFile(doc, opts) {
  const errors = validateDailyDoc(doc, opts);
  return { ok: errors.length === 0, errors };
}
