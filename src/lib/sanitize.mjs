/**
 * 外部输入净化层（P1-U1）。
 *
 * GitHub 仓库描述、topics、homepage、以及人工/LLM 生成的解读文本都算"外部输入"，
 * 在进入数据文件之前统一过一遍这里，避免把控制字符、伪协议 URL、
 * 零宽 / 双向控制符（Trojan Source 类欺骗）带进页面。
 *
 * 站点最终仍依赖框架的默认转义 + 这里的净化做双层防御。
 */
import { config } from "./config.mjs";

const S = config.sanitize ?? {};

// 零宽字符与 Unicode 双向控制符：可用于视觉欺骗，直接剥除
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g;
// HTML 标签 / 注释 / 脚本片段：数据源不应带标签，出现即剥离
const TAGS = /<\/?[a-z][^>]*>/gi;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/** 通用文本净化：去标签、去不可见字符、归一空白、限长 */
export function sanitizeText(value, maxLength = S.maxDescriptionLength ?? 400) {
  if (typeof value !== "string") return "";
  let out = value
    .replace(HTML_COMMENT, " ")
    .replace(TAGS, " ")
    .replace(INVISIBLE, "")
    // 控制字符（保留换行与制表，后面会归一成空格）
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (out.length > maxLength) out = `${out.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  return out;
}

/** 多行文本（解读里的 quickstart 等）：保留换行，但仍剥离标签与控制字符 */
export function sanitizeMultiline(value, maxLength = S.maxQuickstartLength ?? 1200) {
  if (typeof value !== "string") return "";
  const out = value
    .replace(HTML_COMMENT, "")
    .replace(TAGS, "")
    .replace(INVISIBLE, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out.length > maxLength ? `${out.slice(0, maxLength).trimEnd()}…` : out;
}

/** URL 净化：仅允许 http / https，其余（javascript: / data: / vbscript: 等）一律丢弃 */
export function sanitizeUrl(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim().replace(INVISIBLE, "");
  if (!raw) return "";
  const allowed = S.allowedUrlSchemes ?? ["http:", "https:"];
  try {
    const url = new URL(raw);
    if (!allowed.includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

/** 话题标签：小写、去符号、去重、限长限量 */
export function sanitizeTopics(list) {
  if (!Array.isArray(list)) return [];
  const maxCount = S.maxTopicCount ?? 20;
  const maxLen = S.maxTopicLength ?? 50;
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const t = item
      .toLowerCase()
      .replace(INVISIBLE, "")
      .replace(/[^a-z0-9._+-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, maxLen);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= maxCount) break;
  }
  return out;
}

/** 双语列表项（highlights / cons / fitFor） */
export function sanitizeBilingualList(list) {
  if (!Array.isArray(list)) return [];
  const maxItems = S.maxListItems ?? 6;
  const maxLen = S.maxListItemLength ?? 200;
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const zh = sanitizeText(item.zh, maxLen);
    const en = sanitizeText(item.en, maxLen);
    if (!zh && !en) continue;
    out.push({ zh: zh || en, en: en || zh });
    if (out.length >= maxItems) break;
  }
  return out;
}

/** 双语长文本（why） */
export function sanitizeBilingualText(value, maxLength = S.maxWhyLength ?? 600) {
  const zh = sanitizeText(value?.zh, maxLength);
  const en = sanitizeText(value?.en, maxLength);
  if (!zh && !en) return null;
  return { zh: zh || en, en: en || zh };
}

/** XML / RSS 转义（用于手写 feed，不依赖框架转义） */
export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 安全文件名 / slug：只保留 ascii 字母数字与 . _ - */
export function sanitizeSlug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(INVISIBLE, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
}
