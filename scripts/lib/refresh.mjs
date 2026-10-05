/**
 * 历史文案回填的判定部分（与 backfill-interpretations.mjs 分开，便于单测）。
 *
 * 规则版文案（intro / cardLine / highlights）是模板拼装，重算不会丢人工内容；
 * LLM 与人工解读是编辑性内容，任何情况下都不覆盖。缺 interpretationSource 的
 * 老数据分不清是人写的还是模板拼的，默认不动。
 */
import { ruleBasedInterpretation } from "../../src/lib/interpret.mjs";

/**
 * 就地把规则条目的文案换成当前模板口径。
 * @returns {{changed: boolean}} changed 为 true 表示确实改动了内容
 */
export function refreshRuleEntry(entry, project, windowDays) {
  if (!entry || entry.interpretationSource !== "rules") return { changed: false };
  const rule = ruleBasedInterpretation({ ...project, windowDays });
  const before = JSON.stringify([entry.intro, entry.cardLine, entry.highlights]);
  entry.intro = rule.intro;
  entry.cardLine = rule.cardLine;
  entry.highlights = rule.highlights;
  return { changed: JSON.stringify([entry.intro, entry.cardLine, entry.highlights]) !== before };
}
