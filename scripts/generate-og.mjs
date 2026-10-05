#!/usr/bin/env node
/**
 * OG 社交分享图生成（T2.4）。
 *
 * 构建期用 SVG 模板 + 文字替换生成 1200×630 PNG，输出到 dist/og/。
 * 不引入新的运行时依赖：直接复用 Astro 已带的 sharp 做 SVG→PNG 栅格化。
 *
 *   node scripts/generate-og.mjs            # 生成到 dist/og/
 *   node scripts/generate-og.mjs --out=dir   # 自定义输出目录
 *
 * 生成范围：中英首页各一张 + 最新一期 Top10 各项目各一张（共约 22 张）。
 * 历史期的分享预览回落到首页图（在 Base.astro 里兜底）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith("--out="))?.slice(6);
const OUT = path.resolve(ROOT, outArg || "dist/og");

const W = 1200;
const H = 630;

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** 按宽度粗略截断（中日韩字符按 1 计，西文按 0.55 计） */
function clip(text, maxUnits) {
  const s = String(text ?? "").trim();
  let used = 0;
  let out = "";
  for (const ch of s) {
    const w = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1 : 0.55;
    if (used + w > maxUnits) return `${out.trimEnd()}…`;
    used += w;
    out += ch;
  }
  return out;
}

const BRAND = "AI Agent Top10";

function frame(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1020"/>
      <stop offset="1" stop-color="#1b1436"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="#6366f1"/>
  ${inner}
  <text x="64" y="576" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="22" fill="#8b93a7">${esc(BRAND)} · wjf1.github.io</text>
</svg>`;
}

function homeSvg({ date, lang, top }) {
  const zh = lang === "zh";
  const rows = top
    .slice(0, 3)
    .map(
      (e, i) =>
        `<text x="72" y="${248 + i * 84}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="40" font-weight="700" fill="#f8fafc">` +
        `${esc(`#${i + 1}  ${clip(e.full_name, 34)}`)}</text>` +
        `<text x="72" y="${248 + i * 84 + 32}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="24" fill="#7dd3fc">` +
        `${esc(`+${Number(e.weeklyGain ?? 0).toLocaleString("en-US")} stars / 7d`)}</text>`
    )
    .join("\n  ");
  return frame(`
  <text x="64" y="120" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="52" font-weight="800" fill="#ffffff">${esc(
    zh ? "每日 AI Agent 项目 Top 10" : "Daily Top 10 AI Agent Projects"
  )}</text>
  <text x="64" y="172" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="30" fill="#a5b4fc">${esc(date)} · ${esc(
    zh ? "按 7 天 star 增速排名" : "ranked by 7-day star growth"
  )}</text>
  ${rows}`);
}

function projectSvg({ entry, lang }) {
  const zh = lang === "zh";
  const overall = entry.scores?.overall ?? "—";
  return frame(`
  <text x="64" y="112" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="44" font-weight="800" fill="#ffffff">${esc(
    clip(entry.full_name, 40)
  )}</text>
  <text x="64" y="168" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="26" fill="#a5b4fc">${esc(
    `${zh ? "排名" : "Rank"} #${entry.rank} · ${Number(entry.weeklyGain ?? 0).toLocaleString("en-US")} ${
      zh ? "star / 7天" : "stars / 7d"
    }`
  )}</text>
  <text x="64" y="248" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="30" fill="#e2e8f0">${esc(
    clip(entry.cardLine?.[lang] ?? entry.description ?? "", 46)
  )}</text>
  <g>
    <rect x="64" y="300" width="320" height="150" rx="18" fill="#171a33" stroke="#2b2f52"/>
    <text x="88" y="352" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="24" fill="#8b93a7">${esc(
      zh ? "综合评分" : "Overall score"
    )}</text>
    <text x="88" y="424" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="64" font-weight="800" fill="#7dd3fc">${esc(
      String(overall)
    )}</text>
  </g>
  <g>
    <rect x="412" y="300" width="320" height="150" rx="18" fill="#171a33" stroke="#2b2f52"/>
    <text x="436" y="352" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="24" fill="#8b93a7">Stars</text>
    <text x="436" y="424" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="48" font-weight="800" fill="#f8fafc">${esc(
      Number(entry.stars ?? 0).toLocaleString("en-US")
    )}</text>
  </g>
  <g>
    <rect x="760" y="300" width="320" height="150" rx="18" fill="#171a33" stroke="#2b2f52"/>
    <text x="784" y="352" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="24" fill="#8b93a7">${esc(
      zh ? "增速" : "Growth"
    )}</text>
    <text x="784" y="424" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="48" font-weight="800" fill="#86efac">${esc(
      `+${entry.growthRate ?? 0}%`
    )}</text>
  </g>`);
}

async function main() {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error("generate-og: sharp 不可用，跳过 OG 图生成（og:image 将回落为首页图）");
    return;
  }

  const indexPath = path.join(ROOT, "src", "data", "index.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const latest = index.dates?.[0];
  if (!latest) {
    console.error("generate-og: index.json 没有日期，跳过");
    return;
  }
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "daily", `${latest}.json`), "utf8"));
  const entries = doc.entries ?? [];

  fs.mkdirSync(OUT, { recursive: true });
  const written = [];

  const jobs = [];
  for (const lang of ["zh", "en"]) {
    jobs.push({ file: path.join(OUT, `home-${lang}.png`), svg: homeSvg({ date: latest, lang, top: entries }) });
    for (const entry of entries) {
      jobs.push({
        file: path.join(OUT, `${lang}-${entry.slug}.png`),
        svg: projectSvg({ entry, lang }),
      });
    }
  }

  for (const job of jobs) {
    await sharp(Buffer.from(job.svg)).png({ compressionLevel: 9 }).toFile(job.file);
    written.push(path.basename(job.file));
  }

  console.log(`generate-og: ${written.length} image(s) → ${path.relative(ROOT, OUT)}/ (latest ${latest})`);
}

main().catch((e) => {
  console.error(`generate-og failed: ${e.message}`);
  process.exit(1);
});
