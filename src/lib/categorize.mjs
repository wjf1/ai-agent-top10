/**
 * 子分类判定（P2-F1）：框架/SDK、工具/平台、应用/产品、数据/评测。
 *
 * 规则来自 config/scoring.json 的 categories，按配置顺序匹配
 * name + topics + description，第一个命中的分类胜出，全不命中归入 "other"。
 */
import { categoryDefs } from "./config.mjs";

const compiled = categoryDefs().map((c) => ({
  ...c,
  re: new RegExp(c.pattern, "i"),
}));

export const OTHER_CATEGORY = {
  key: "other",
  zh: "其它",
  en: "Other",
};

export function categories() {
  return [...compiled.map(({ key, zh, en }) => ({ key, zh, en })), OTHER_CATEGORY];
}

export function categoryLabel(key, lang = "zh") {
  const all = categories();
  const found = all.find((c) => c.key === key);
  if (!found) return OTHER_CATEGORY[lang === "zh" ? "zh" : "en"];
  return lang === "zh" ? found.zh : found.en;
}

/** @param {{name?:string, topics?:string[], description?:string}} entry */
export function categorize(entry) {
  const haystack = [entry.name ?? "", ...(entry.topics ?? []), entry.description ?? ""].join(" ");
  for (const c of compiled) {
    if (c.re.test(haystack)) return c.key;
  }
  return OTHER_CATEGORY.key;
}
