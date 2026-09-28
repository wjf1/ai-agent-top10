/**
 * README 摘要抓取。
 *
 * 仓库 description 只有一句话，写不出"这东西怎么用、解决什么问题"；
 * 解读要通俗就得读 README。这里只抽一段纯文本摘要素材喂给 LLM，
 * 不做结构化解析 —— 徽章、图片、代码块对"这是什么"没有信息量，先去干净，
 * 再按句子边界截断，避免把单词切一半。
 */
import { sanitizeText } from "../../src/lib/sanitize.mjs";
import { withTimeout } from "./github.mjs";

export const MAX_EXCERPT = 2600;

/** Markdown → 纯文本摘要（导出以便单测） */
export function excerptFromMarkdown(markdown, limit = MAX_EXCERPT) {
  if (typeof markdown !== "string") return "";
  const out = markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, " ") // 徽章链接
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片
    .replace(/^\s*[|>#\-*+]+/gm, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (out.length <= limit) return sanitizeText(out, limit);
  const cut = out.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return sanitizeText(stop > limit * 0.6 ? cut.slice(0, stop + 1) : cut, limit);
}

/**
 * 抓取某个仓库的 README 摘要；任何失败都返回空串（调用方回落到规则解读）。
 * @returns {Promise<string>}
 */
export async function fetchReadmeExcerpt(client, fullName, { limit = MAX_EXCERPT, timeoutMs = 20000 } = {}) {
  try {
    const data = await withTimeout(client.gh(`/repos/${fullName}/readme`), timeoutMs, `${fullName} readme`);
    if (!data?.content) return "";
    const markdown = Buffer.from(String(data.content), "base64").toString("utf8");
    return excerptFromMarkdown(markdown, limit);
  } catch {
    // 无 README 或读取失败都不该中断整轮抓取
    return "";
  }
}
