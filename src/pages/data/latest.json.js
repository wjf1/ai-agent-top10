/** 最新一期日榜的原始 JSON（开放数据/二次开发用，W4-2） */
import { index, loadDay } from "../../lib/load-days";

export async function GET() {
  const date = index.dates[0];
  const doc = date ? await loadDay(date) : null;
  const body = JSON.stringify(
    {
      source: "ai-agent-top10",
      generatedAt: index.generatedAt,
      date: doc?.date ?? null,
      windowDays: doc?.windowDays ?? 7,
      entries: doc?.entries ?? [],
    },
    null,
    2
  );
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8" } });
}
