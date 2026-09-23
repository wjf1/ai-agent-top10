/** 跨期聚合后的项目清单 JSON（W4-2） */
import { recentProjects } from "../../lib/aggregate";

export async function GET() {
  const projects = await recentProjects({ window: 90 });
  const body = JSON.stringify(
    {
      source: "ai-agent-top10",
      window: 90,
      count: projects.length,
      projects: projects.map((p) => ({
        full_name: p.entry.full_name,
        slug: p.entry.slug,
        last_date: p.lastDate,
        first_date: p.firstDate,
        appearances: p.appearances,
        best_rank: p.bestRank,
        stars: p.entry.stars,
        forks: p.entry.forks,
        window_gain: Math.round(p.gain),
        language: p.entry.language,
        category: p.entry.category ?? "other",
        topics: p.entry.topics ?? [],
        url: p.entry.url,
        homepage: p.entry.homepage ?? "",
        rank_series: p.rankSeries,
      })),
    },
    null,
    2
  );
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8" } });
}
