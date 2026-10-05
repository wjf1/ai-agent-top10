/**
 * 检索视图的排序与快捷筛选（T3.1）。
 *
 * 抽成独立模块的原因：
 *   1. search.astro 与 search/[...view].astro 都要用，放组件里会形成循环依赖；
 *   2. 纯函数，可被 Node 测试直接覆盖（.astro 组件不行）。
 */

export interface SortSpec {
  key: string;
  zh: string;
  en: string;
}

export interface PresetSpec {
  key: string;
  zh: string;
  en: string;
  noteZh: string;
  noteEn: string;
}

/** 排序方式（验收要求 ≥3 种，实际 6 种） */
export const SORTS: SortSpec[] = [
  { key: "gain", zh: "累计增量", en: "Total gain" },
  { key: "overall", zh: "综合分", en: "Overall" },
  { key: "heat", zh: "热度", en: "Momentum" },
  { key: "innovation", zh: "创新", en: "Innovation" },
  { key: "ecosystem", zh: "生态", en: "Ecosystem" },
  { key: "stars", zh: "Stars", en: "Stars" },
];

/** 快捷筛选（验收要求 ≥2 种，实际 3 种） */
export const PRESETS: PresetSpec[] = [
  {
    key: "rising",
    zh: "本周新星",
    en: "Rising",
    noteZh: "上榜不超过 3 期、且窗口内仍在增量的项目",
    noteEn: "Listed no more than 3 periods while still gaining",
  },
  {
    key: "ecosystem",
    zh: "生态强者",
    en: "Ecosystem leaders",
    noteZh: "生态潜力维度 ≥ 70 分",
    noteEn: "Ecosystem score ≥ 70",
  },
  {
    key: "complete",
    zh: "高完成度",
    en: "High completeness",
    noteZh: "实用完成度维度 ≥ 70 分",
    noteEn: "Practicality score ≥ 70",
  },
];

export const DEFAULT_SORT = "gain";
export const PRESET_SCORE_FLOOR = 70;
export const RISING_MAX_APPEARANCES = 3;

const scoreOf = (p: any, key: string): number => {
  const v = p?.entry?.scores?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : -1;
};

/** 构建期排序：分数缺失的项目排在最后，而不是当成 0 分 */
export function sortProjects(projects: any[], key: string): any[] {
  const out = [...projects];
  switch (key) {
    case "overall":
    case "heat":
    case "innovation":
    case "ecosystem":
      return out.sort((a, b) => scoreOf(b, key) - scoreOf(a, key) || b.gain - a.gain);
    case "stars":
      return out.sort((a, b) => (b.entry?.stars ?? 0) - (a.entry?.stars ?? 0));
    case DEFAULT_SORT:
    default:
      return out.sort((a, b) => b.gain - a.gain);
  }
}

export function applyPreset(projects: any[], key: string | null | undefined): any[] {
  switch (key) {
    case "rising":
      return projects.filter((p) => (p.appearances ?? 0) <= RISING_MAX_APPEARANCES && (p.gain ?? 0) > 0);
    case "ecosystem":
      return projects.filter((p) => scoreOf(p, "ecosystem") >= PRESET_SCORE_FLOOR);
    case "complete":
      return projects.filter((p) => scoreOf(p, "practical") >= PRESET_SCORE_FLOOR);
    default:
      return projects;
  }
}

/**
 * 由排序 + 预设拼出静态路径片段数组（不含默认排序，避免同一内容出现两条 URL）。
 * 返回 [] 表示这是默认视图，应交给 /search/ 处理。
 */
export function viewParts({ sort, preset }: { sort?: string; preset?: string | null }): string[] {
  const parts: string[] = [];
  if (preset) parts.push("p", preset);
  if (sort && sort !== DEFAULT_SORT) parts.push("s", sort);
  return parts;
}

/** 解析路径片段 → { sort, preset }；非法值回落到默认 */
export function parseView(params: { view?: string; segments?: string[] }): { sort: string; preset: string | null } {
  const raw = params.segments ?? (params.view ? String(params.view).split("/").filter(Boolean) : []);
  let sort = DEFAULT_SORT;
  let preset: string | null = null;
  for (let i = 0; i < raw.length; i += 2) {
    const kind = raw[i];
    const value = raw[i + 1];
    if (kind === "s" && SORTS.some((s) => s.key === value)) sort = value;
    if (kind === "p" && PRESETS.some((p) => p.key === value)) preset = value;
  }
  return { sort, preset };
}

export const isSortKey = (v: string): boolean => SORTS.some((s) => s.key === v);
export const isPresetKey = (v: string): boolean => PRESETS.some((p) => p.key === v);
