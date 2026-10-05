/**
 * 详情页 / 卡片的呈现决策：哪个字段出现在哪个位置、区块该怎么称呼。
 *
 * 与文案生成（interpret.mjs）分开放，组件就只负责渲染，这些"读起来像什么"的规则也能被单测覆盖。
 */
import { clipToOneLine, textWidth } from "./interpret.mjs";
import { sanitizeText } from "./sanitize.mjs";
import type { Lang, Strings } from "./data.ts";

const BOUNDARY = /[。！？!?\n]/;

/** 取首句做一行导语；太短的碎句（如 "v2." ）不配当导语，交回上层回落 */
function firstSentence(text: string): string {
  const s = String(text ?? "").trim();
  if (!s) return "";
  for (let i = 0; i < s.length; i++) {
    if (BOUNDARY.test(s[i])) {
      const head = s.slice(0, i + 1).trim();
      return textWidth(head) >= 8 ? head : s;
    }
  }
  return textWidth(s) >= 8 ? s : "";
}

/**
 * 详情页头图下那行：给「一句话定位」（卡片一行版本就为此设计），
 * 而不是介绍的首句 —— 介绍首句当导语时，头图和「它能做什么？」会显示同一句话。
 */
export function detailLead(entry: any, lang: Lang): string {
  const line = entry?.cardLine?.[lang];
  if (typeof line === "string" && line.trim()) return line.trim();
  return firstSentence(entry?.intro?.[lang] ?? "") || String(entry?.description ?? "").trim();
}

/** 规则兜底版的"亮点"其实是指标复述，不该顶着「核心亮点」的名义 */
export function highlightsTitle(entry: any, t: Strings): string {
  return entry?.interpretationSource === "rules" ? t.dataPoints : t.highlights;
}

interface InterpretationTag {
  label: string;
  note: string;
}

/** 解读来源徽标：让读者知道这段文字是人写的、模型读的 README，还是模板拼的 */
export function interpretationTag(entry: any, t: Strings): InterpretationTag | null {
  switch (entry?.interpretationSource) {
    case "llm":
      return { label: t.tagLlm, note: t.tagLlmNote };
    case "manual":
      return { label: t.tagManual, note: t.tagManualNote };
    case "rules":
      return { label: t.tagRules, note: t.tagRulesNote };
    default:
      return null;
  }
}

/**
 * 卡片那一行的来源标注，只在规则兜底时出现（有编辑解读就别再加噪）。
 * 这一行如果是仓库作者自己的描述，标「仓库自述」比标「规则生成」更准确 ——
 * 读者据此知道这句话来自项目本身，而不是我们拼出来的模板腔。
 */
export function cardLineTag(entry: any, t: Strings): InterpretationTag | null {
  if (entry?.interpretationSource !== "rules") return null;
  const fromDescription = clipToOneLine(sanitizeText(entry?.description), 90);
  if (fromDescription && entry?.cardLine?.zh === fromDescription) {
    return { label: t.cardFromRepo, note: t.cardFromRepoNote };
  }
  return { label: t.tagRules, note: t.tagRulesNote };
}

/**
 * 增速来源：读者真正关心的是"这个增量是数出来的还是估出来的"，
 * 快照差值 / 事件流估算这类内部叫法收进悬停说明。
 */
export function gainSourceTag(entry: any, t: Strings): InterpretationTag {
  const events = entry?.gainSource === "events";
  const exact = entry?.gainExact !== undefined ? entry.gainExact === true : !events;
  const term = events
    ? t.sourceEvents
    : entry?.gainSource === "stargazers"
      ? t.sourceStargazers
      : entry?.gainSource === "snapshot-window"
        ? t.sourceWindow
        : t.sourceSnapshot;
  return { label: exact ? t.sourceExactLabel : t.sourceEstimateLabel, note: `${t.gainSource}：${term}。${t.gainSourceNote}` };
}

export interface ScoreFactor {
  key: string;
  label: string;
  value: number;
}

/** 与综合分相差 5 分以上才算"明显拉低 / 抬高"，否则不硬凑话 */
const FACTOR_GAP = 5;

/**
 * 把"综合分 74"翻译成读者能用的信息：分数被哪两个维度压低、被哪两个抬高。
 * 历史数据只有 6 维、且部分维度缺分数 —— 缺分数的维度不能当 0 分参与归因。
 */
export function scoreFactors(
  scores: any,
  dims: { key: string; label: string }[]
): { low: ScoreFactor[]; high: ScoreFactor[] } {
  const overall = Number(scores?.overall);
  if (!Number.isFinite(overall)) return { low: [], high: [] };
  const scored = dims
    .map((d) => ({ key: d.key, label: d.label, value: Number(scores?.[d.key]) }))
    .filter((d) => Number.isFinite(d.value));
  return {
    low: scored
      .filter((d) => d.value <= overall - FACTOR_GAP)
      .sort((a, b) => a.value - b.value)
      .slice(0, 2),
    high: scored
      .filter((d) => d.value >= overall + FACTOR_GAP)
      .sort((a, b) => b.value - a.value)
      .slice(0, 2),
  };
}
