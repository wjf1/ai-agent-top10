/**
 * 路由构造集中管理。
 *
 * P0-C1 的根因就是路由散落在各组件里手拼，详情页漏掉了日期维度
 * 导致同一天不同日期的同名项目互相覆盖；归档页则把日期丢成了首页链接。
 * 统一走这里之后，任何路径都带齐自己的作用域参数。
 */
export type Lang = "zh" | "en";

/** 仓库地址：页脚「在 GitHub 上反馈 / 贡献」与 issue 模板共用 */
export const REPO_URL = "https://github.com/wjf1/ai-agent-top10";

export const base = (): string => import.meta.env.BASE_URL.replace(/\/$/, "");

function prefix(lang: Lang): string {
  return lang === "en" ? "/en" : "";
}

export function homePath(B: string, lang: Lang): string {
  return `${B}${prefix(lang)}/`;
}

export function dayPath(B: string, lang: Lang, date: string): string {
  return `${B}${prefix(lang)}/day/${date}/`;
}

export function weekPath(B: string, lang: Lang, endDate?: string | null): string {
  return endDate ? `${B}${prefix(lang)}/week/${endDate}/` : `${B}${prefix(lang)}/week/`;
}

export function monthPath(B: string, lang: Lang, endDate?: string | null): string {
  return endDate ? `${B}${prefix(lang)}/month/${endDate}/` : `${B}${prefix(lang)}/month/`;
}

/** 详情页必须带日期：/project/<date>/<slug>/ */
export function projectPath(B: string, lang: Lang, date: string, slug: string): string {
  return `${B}${prefix(lang)}/project/${date}/${slug}/`;
}

export function archivePath(B: string, lang: Lang): string {
  return `${B}${prefix(lang)}/archive/`;
}

export function topicPath(B: string, lang: Lang, tag: string): string {
  return `${B}${prefix(lang)}/topic/${encodeURIComponent(tag)}/`;
}

export function categoryPath(B: string, lang: Lang, key: string): string {
  return `${B}${prefix(lang)}/category/${key}/`;
}

export function searchPath(B: string, lang: Lang): string {
  return `${B}${prefix(lang)}/search/`;
}

export function comparePath(B: string, lang: Lang): string {
  return `${B}${prefix(lang)}/compare/`;
}

export function exportPath(B: string, lang: Lang): string {
  return `${B}${prefix(lang)}/export/`;
}

export function rssPath(B: string, lang: Lang): string {
  return `${B}${prefix(lang)}/rss.xml`;
}
