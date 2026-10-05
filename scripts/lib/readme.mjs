/**
 * README 摘要抓取。
 *
 * 仓库 description 只有一句话，写不出"这东西怎么用、解决什么问题"；
 * 解读要通俗就得读 README。这里只抽一段纯文本摘要素材喂给 LLM，
 * 不做结构化解析 —— 徽章、图片、代码块对"这是什么"没有信息量，先去干净，
 * 再按句子边界截断，避免把单词切一半。
 */
import { sanitizeMultiline, sanitizeText } from "../../src/lib/sanitize.mjs";
import { withTimeout } from "./github.mjs";

export const MAX_EXCERPT = 2600;
/** 快速上手只放安装命令，超过这个长度基本说明抽到的不是安装段 */
export const MAX_QUICKSTART = 600;

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
 * 抓取某个仓库的 README 原文；任何失败都返回空串（调用方回落到规则解读）。
 * @returns {Promise<string>}
 */
export async function fetchReadmeMarkdown(client, fullName, { timeoutMs = 20000 } = {}) {
  try {
    const data = await withTimeout(client.gh(`/repos/${fullName}/readme`), timeoutMs, `${fullName} readme`);
    if (!data?.content) return "";
    return Buffer.from(String(data.content), "base64").toString("utf8");
  } catch {
    // 无 README 或读取失败都不该中断整轮抓取
    return "";
  }
}

/**
 * 抓取某个仓库的 README 摘要；任何失败都返回空串（调用方回落到规则解读）。
 * @returns {Promise<string>}
 */
export async function fetchReadmeExcerpt(client, fullName, { limit = MAX_EXCERPT, timeoutMs = 20000 } = {}) {
  return excerptFromMarkdown(await fetchReadmeMarkdown(client, fullName, { timeoutMs }), limit);
}

// 安装段既可能写在标题里（## Installation / 快速开始），也可能直接以命令自证。
const INSTALL_HEADING = /(install|getting started|quick\s*start|setup|安装|部署|快速开始|快速上手|如何使用)/i;
const INSTALL_COMMAND =
  /^\s*(?:\$ |&gt; )?(?:npm\s+(?:install|i|add)|pnpm\s+add|yarn\s+add|bun\s+add|npx\s|pip[3]?\s+install|uv\s+pip\s+install|poetry\s+add|cargo\s+install|go\s+install|brew\s+install|conda\s+install|apt(-get)?\s+install|docker\s+(?:run|pull)|curl\b.*\|\s*(?:ba|z)?sh|wget\b.*\|\s*(?:ba|z)?sh|git\s+clone)/im;

/** 按行扫出围栏代码块，并带上它前面最近的标题（用于判断这段是干什么的） */
function fencedBlocks(markdown) {
  const out = [];
  let heading = "";
  let current = null;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const title = /^#{1,6}\s+(.+)$/.exec(line);
    if (title && !current) {
      heading = title[1];
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      if (current) {
        out.push({ heading, body: current.join("\n").trim() });
        current = null;
      } else {
        current = [];
      }
      continue;
    }
    if (current) current.push(line);
  }
  if (current) out.push({ heading, body: current.join("\n").trim() });
  return out;
}

/**
 * 从 README 里取第一个"安装段"代码块，供详情页「快速上手」使用。
 *
 * excerptFromMarkdown 会把代码块整体删掉（对"这是什么"没信息量），
 * 但安装命令恰恰是读者上手时唯一想看的那几行，所以单独抽出来。
 * @returns {string} 净化后的命令文本；找不到安装段时为空串
 */
export function extractInstallSnippet(markdown, limit = MAX_QUICKSTART) {
  if (typeof markdown !== "string" || !markdown.trim()) return "";
  const hit = fencedBlocks(markdown).find((b) => INSTALL_HEADING.test(b.heading) || INSTALL_COMMAND.test(b.body));
  if (!hit?.body) return "";
  return sanitizeMultiline(hit.body, limit);
}
