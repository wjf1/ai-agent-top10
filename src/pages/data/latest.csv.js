/** 最新一期日榜的 CSV（W4-2） */
import { toCsv } from "../../lib/csv";
import { dimensionKeys } from "../../lib/config.mjs";
import { index, loadDay } from "../../lib/load-days";

const DIMS = [...dimensionKeys, "overall"];

export async function GET() {
  const date = index.dates[0];
  const doc = date ? await loadDay(date) : null;
  const rows = [
    [
      "date",
      "rank",
      "full_name",
      "category",
      "language",
      "stars",
      "forks",
      "weekly_gain",
      "daily_gain",
      "growth_rate_pct",
      "forks_gain",
      "contributors",
      "pr_30d",
      "issues_30d",
      ...DIMS.map((d) => `score_${d}`),
      "url",
    ],
  ];

  for (const e of doc?.entries ?? []) {
    rows.push([
      doc.date,
      e.rank,
      e.full_name,
      e.category ?? "",
      e.language,
      e.stars,
      e.forks,
      e.weeklyGain,
      e.dailyGain,
      e.growthRate,
      e.forksGain ?? "",
      e.contributors ?? "",
      e.prActivity ?? "",
      e.issueActivity ?? "",
      ...DIMS.map((d) => e.scores?.[d] ?? ""),
      e.url,
    ]);
  }

  return new Response(toCsv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8" },
  });
}
