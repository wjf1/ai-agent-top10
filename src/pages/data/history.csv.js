/** 全部历史榜单的 CSV（W4-2） */
import { toCsv } from "../../lib/csv";
import { dimensionKeys } from "../../lib/config.mjs";
import { index, loadDay } from "../../lib/load-days";

const DIMS = [...dimensionKeys, "overall"];

/** 列与 latest.csv 保持一致，方便把两个文件直接纵向拼接 */
const COLUMNS = (e, date) => [
  date,
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
];

export async function GET() {
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

  for (const date of index.dates) {
    const doc = await loadDay(date);
    for (const e of doc?.entries ?? []) {
      rows.push(COLUMNS(e, date));
    }
  }

  return new Response(toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8" } });
}
