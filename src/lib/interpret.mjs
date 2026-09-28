/**
 * 规则化解读 + 解读结构校验（无外部依赖，流水线与构建期共用）。
 *
 * why 是"定位解读"：说明这个项目是什么、用在哪里，素材来自仓库描述、分类与
 * 话题标签；star / fork / 提交等数字由卡片的数据行和 highlights 承担，不在这里复述。
 * 规则版只陈述已采集的客观信息，不做主观评价；LLM 版（scripts/lib/interpret.mjs）
 * 和人工版都必须过同一套 normalize 校验，不合格就退回规则版。
 */
import { categoryLabel } from "./categorize.mjs";
import { config } from "./config.mjs";
import { topicLabels } from "./topic-labels.mjs";
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

/** 分类对应的"这个项目拿来实现什么"，用于定位解读 */
const CATEGORY_PURPOSE = {
  framework: {
    zh: "可把 Agent 能力集成进自研产品或工作流",
    en: "for embedding agent capabilities into your own product or workflow",
  },
  tool: {
    zh: "常用来给现有工作流补齐 Agent 与自动化能力",
    en: "for adding agent capability and automation to an existing workflow",
  },
  app: { zh: "开箱即可上手使用", en: "usable out of the box" },
  data: {
    zh: "服务于 Agent 能力评测与数据处理",
    en: "for evaluating agent behaviour and preparing datasets",
  },
  other: { zh: "多用于 AI Agent 生态的各类场景", en: "in the AI agent ecosystem" },
};

/**
 * 定位解读：回答"这是什么项目、用来做什么"。
 *
 * 英文优先用仓库原始 description（信息量最高）；中文没有可靠的英文翻译来源，
 * 改用分类 + 话题标签拼装 —— 未收录的标签保留原始 slug，不硬译产品名。
 * description 与 topics 都缺失时仍会给出分类维度的定位句，不会产出空文本。
 */
export function positioningWhy(project) {
  const category = project.category ?? "other";
  const catZh = categoryLabel(category, "zh");
  const catEn = categoryLabel(category, "en");
  const purpose = CATEGORY_PURPOSE[category] ?? CATEGORY_PURPOSE.other;
  const name = project.full_name || project.name || "该项目";
  const language = project.language && project.language !== "Other" ? project.language : "";
  const zhTopics = topicLabels(project.topics, "zh", 4);
  const enTopics = topicLabels(project.topics, "en", 4);
  const description = typeof project.description === "string" ? project.description.trim() : "";

  const zhHead = category === "other" ? `「${name}」是 AI Agent 生态里的通用项目` : `「${name}」属于${catZh}，${purpose.zh}`;
  const zhTail = [zhTopics.length ? `聚焦 ${zhTopics.join("、")} 等方向` : "", language ? `主要使用 ${language}` : ""]
    .filter(Boolean)
    .join("；");
  const zh = `${zhHead}${zhTail ? `；${zhTail}` : ""}。`;

  // other 分类没有可读的英文名（"a Other project" 不通），改用生态描述
  const enClause =
    category === "other"
      ? `a project ${purpose.en}`
      : `${/^[aeiou]/i.test(catEn) ? "an" : "a"} ${catEn} project ${purpose.en}`;
  const enFocus = enTopics.length ? `, focused on ${enTopics.join(", ")}` : "";
  const enLanguage = language ? `, mainly written in ${language}` : "";
  const en = description
    ? `${/[.!?]$/.test(description) ? description : `${description}.`} ${
        enClause.charAt(0).toUpperCase() + enClause.slice(1)
      }${enLanguage}${enFocus}.`
    : `${name} is ${enClause}${enLanguage}${enFocus}.`;

  return { zh, en };
}

/**
 * 生成规则化解读。
 * @param {object} project 至少需要 metrics / weeklyGain / dailyGain / category / windowDays
 */
export function ruleBasedInterpretation(project, { lang = "zh" } = {}) {
  const m = project.metrics;
  const windowDays = project.windowDays ?? 7;

  const why = positioningWhy(project);

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
