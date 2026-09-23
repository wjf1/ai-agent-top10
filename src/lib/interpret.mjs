/**
 * 规则化解读 + 解读结构校验（无外部依赖，流水线与构建期共用）。
 *
 * 规则版只陈述已采集的客观指标，不做主观评价；LLM 版（scripts/lib/interpret.mjs）
 * 和人工版都必须过同一套 normalize 校验，不合格就退回规则版。
 */
import { categoryLabel } from "./categorize.mjs";
import { config } from "./config.mjs";
import {
  sanitizeBilingualList,
  sanitizeBilingualText,
  sanitizeMultiline,
  sanitizeText,
} from "./sanitize.mjs";

const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");

export function fitForCategory(category) {
  switch (category) {
    case "framework":
      return [
        { zh: "要把 Agent 能力嵌进自己产品的开发者", en: "Developers embedding agent capabilities into their own product" },
        { zh: "需要可扩展抽象层而非端到端方案的团队", en: "Teams wanting an extensible abstraction layer rather than a turnkey app" },
      ];
    case "tool":
      return [
        { zh: "想给现有工作流加一层 Agent 自动化的团队", en: "Teams adding an agent-automation layer to an existing workflow" },
        { zh: "偏工具链方向、重视可观测性的工程师", en: "Engineers on the tooling side who value observability" },
      ];
    case "app":
      return [
        { zh: "希望开箱即用、直接上手体验的终端用户", en: "End users who want something usable out of the box" },
        { zh: "在做同类产品、需要参考交互与架构的团队", en: "Teams building a similar product and looking for reference UX and architecture" },
      ];
    case "data":
      return [
        { zh: "需要评测基准或数据集选型的研究者", en: "Researchers selecting benchmarks or datasets" },
        { zh: "要给 Agent 做自动化回归评测的工程团队", en: "Engineering teams adding automated regression evaluation for agents" },
      ];
    default:
      return [
        { zh: "关注 AI Agent 生态、想快速了解新项目的从业者", en: "Practitioners tracking the AI agent ecosystem" },
      ];
  }
}

/**
 * 生成规则化解读。
 * @param {object} project 至少需要 metrics / weeklyGain / dailyGain / category / windowDays
 */
export function ruleBasedInterpretation(project, { lang = "zh" } = {}) {
  const m = project.metrics;
  const windowDays = project.windowDays ?? 7;
  const gain = project.weeklyGain ?? 0;
  const perDay = Math.round(project.dailyGain ?? gain / windowDays);
  const metricsComplete = m.contributors != null;

  const why = {
    zh: `近 ${windowDays} 天新增 ${fmt(gain)} star（日均约 ${perDay}），累计 ${fmt(m.stars)} star、${fmt(m.forks)} fork。${
      m.license ? `采用 ${m.license} 协议` : "许可证尚未标注"
    }${metricsComplete ? `，最近一次提交在 ${m.pushDaysAgo} 天前，近 30 天新建 PR ${m.prActivity} 个、issue ${m.issueActivity} 个` : ""}。`,
    en: `Gained ${fmt(gain)} stars over the last ${windowDays} days (~${perDay}/day), now at ${fmt(m.stars)} stars and ${fmt(
      m.forks
    )} forks. ${m.license ? `Licensed under ${m.license}` : "No license declared"}${
      metricsComplete
        ? `; last push ${m.pushDaysAgo} day(s) ago, with ${m.prActivity} PRs and ${m.issueActivity} issues opened in the last 30 days`
        : ""
    }.`,
  };

  const highlights = [];
  if (m.contributors >= 10) highlights.push({ zh: `${m.contributors} 位公开贡献者`, en: `${m.contributors} public contributors` });
  if (m.releases90d > 0) highlights.push({ zh: `近 90 天发布 ${m.releases90d} 个版本`, en: `${m.releases90d} release(s) in the last 90 days` });
  if (m.licensePermissive) highlights.push({ zh: `宽松许可证（${m.license}），商用门槛低`, en: `Permissive license (${m.license}) — easy commercial use` });
  if (project.forksGain > 0) highlights.push({ zh: `${windowDays} 天内新增 ${fmt(project.forksGain)} 次 fork`, en: `${fmt(project.forksGain)} new forks in the window` });
  if (m.ageDays != null && m.ageDays < 365) highlights.push({ zh: `新仓库，创建至今仅 ${m.ageDays} 天`, en: `Young project — only ${m.ageDays} days old` });

  const cons = [];
  if (m.pushDaysAgo > 30) cons.push({ zh: `最近 ${m.pushDaysAgo} 天没有提交，维护可能停滞`, en: `No commits for ${m.pushDaysAgo} days — maintenance may have stalled` });
  if (!m.license) cons.push({ zh: "未声明开源许可证，商用存在法务不确定性", en: "No open-source license declared — legal uncertainty for commercial use" });
  if (m.stars > 0 && m.openIssues / m.stars > 0.02) {
    cons.push({ zh: `开放 issue ${fmt(m.openIssues)} 个，相对 star 规模偏高`, en: `${fmt(m.openIssues)} open issues — high relative to its star count` });
  }
  if (m.contributors != null && m.contributors <= 3) {
    cons.push({ zh: `贡献者仅 ${m.contributors} 人，存在单点依赖风险`, en: `Only ${m.contributors} contributor(s) — bus-factor risk` });
  }
  if (!m.hasHomepage && !m.hasDocs) cons.push({ zh: "缺少官网与文档入口，上手成本较高", en: "No homepage or docs site — steeper onboarding" });

  const quickstart = project.url
    ? `# ${project.full_name}\n$ git clone ${project.url}.git\n$ cd ${project.name}\n# 具体安装与运行方式请参考仓库 README`
    : "";

  return { why, highlights, cons, fitFor: fitForCategory(project.category), quickstart, source: "rules" };
}

/** 校验并净化任意来源的解读对象；不合法返回 null */
export function normalizeInterpretation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const why = sanitizeBilingualText(raw.why, config.sanitize?.maxWhyLength);
  if (!why) return null;
  return {
    why,
    highlights: sanitizeBilingualList(raw.highlights),
    cons: sanitizeBilingualList(raw.cons),
    fitFor: sanitizeBilingualList(raw.fitFor),
    quickstart: sanitizeMultiline(raw.quickstart, config.sanitize?.maxQuickstartLength),
    firstSeen: typeof raw.firstSeen === "string" ? sanitizeText(raw.firstSeen, 10) : undefined,
  };
}

export { categoryLabel };
