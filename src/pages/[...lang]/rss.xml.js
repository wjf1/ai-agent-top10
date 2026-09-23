/**
 * RSS 2.0 feed（P2-F4）。
 * 直接手写 XML 并逐字段转义，不使用 set:html，避免把外部文本当标记注入。
 */
import { index, loadDay } from "../../lib/load-days";
import { escapeXml } from "../../lib/sanitize.mjs";

export function getStaticPaths() {
  return [{ params: { lang: undefined } }, { params: { lang: "en" } }];
}

const MAX_ITEMS = 30;

export async function GET({ params, site }) {
  const lang = params.lang === "en" ? "en" : "zh";
  const prefix = lang === "en" ? "/en" : "";
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const origin = (site?.origin ?? "https://wjf1.github.io").replace(/\/$/, "");
  const root = `${origin}${base}${prefix}`;

  const items = [];
  for (const date of index.dates.slice(0, MAX_ITEMS)) {
    const doc = await loadDay(date);
    if (!doc?.entries?.length) continue;
    const top = doc.entries[0];
    const list = doc.entries
      .map((e) => `${e.rank}. ${e.full_name} (+${e.weeklyGain} stars, ${e.scores.overall}/100)`)
      .join("\n");
    const description =
      lang === "zh"
        ? `第 1 名：${top.full_name}（近 7 天 +${top.weeklyGain} star）\n\n${list}`
        : `#1: ${top.full_name} (+${top.weeklyGain} stars / 7d)\n\n${list}`;
    items.push({
      title: `${date} · ${top.full_name}`,
      link: `${root}/day/${date}/`,
      guid: `${root}/day/${date}/`,
      pubDate: new Date(`${date}T06:00:00Z`).toUTCString(),
      description,
    });
  }

  const channelTitle = lang === "zh" ? "Agent Top10 — 每日 AI Agent 项目解读" : "Agent Top10 — Daily AI Agent Project Reviews";
  const channelDesc =
    lang === "zh"
      ? "每天按 star 增速选出 GitHub 上最热的 10 个 AI Agent 项目，并给出多维评分与解读。"
      : "The 10 hottest AI Agent projects on GitHub by star growth, with multi-dimension scores and commentary.";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${escapeXml(`${root}/`)}</link>
    <description>${escapeXml(channelDesc)}</description>
    <language>${lang === "zh" ? "zh-cn" : "en"}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(`${root}/rss.xml`)}" rel="self" type="application/rss+xml" />
${items
  .map(
    (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="true">${escapeXml(item.guid)}</guid>
      <pubDate>${item.pubDate}</pubDate>
      <description>${escapeXml(item.description)}</description>
    </item>`
  )
  .join("\n")}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}
