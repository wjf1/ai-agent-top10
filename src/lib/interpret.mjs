/**
 * 规则化解读 + 解读结构校验（无外部依赖，流水线与构建期共用）。
 *
 * 四条内容各司其职：
 *   why       为什么上榜 —— 用当日指标回答"它凭什么进榜"，只陈述客观数据
 *   intro     项目介绍   —— 这是什么、解决什么问题、怎么用
 *   cardLine  卡片一行版 —— 列表页那行的极简定位
 *   highlights 亮点      —— 值得注意的具体能力
 *
 * LLM 版（scripts/lib/interpret.mjs）读 README 产出 intro / cardLine / highlights；
 * why 始终由这里的规则版生成 —— 增速、活跃度这类数字必须与数据文件一一对应，
 * 不适合交给模型复述。LLM 不可用时其余三项也回落到这里的规则版。
 */
import { categoryLabel } from "./categorize.mjs";
import { config } from "./config.mjs";
import { readableTopicLabels } from "./topic-labels.mjs";
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
      return [];
  }
}

const TOPIC_FIT_MAPPINGS = [
  {
    regex: /rag|retriev|vector|embed|search/i,
    item: {
      zh: "需要搭建知识库、文档问答或 RAG 检索链路的团队",
      en: "Teams building knowledge bases, doc Q&A, or RAG retrieval pipelines",
    },
  },
  {
    regex: /multi-agent|swarm|orchestrat|workflow|crew|autogen/i,
    item: {
      zh: "探索多智能体协作、角色分工与复杂流水线编排的架构师",
      en: "Architects exploring multi-agent collaboration, role assignments, and pipeline orchestration",
    },
  },
  {
    regex: /coding|developer-tools|programming|ide|copilot|code-generation/i,
    item: {
      zh: "希望借助 AI 辅助编程、自动化代码审查或工程提效的开发团队",
      en: "Development teams implementing AI coding assistants, automated code review, or dev productivity",
    },
  },
  {
    regex: /browser|automation|scrap|playwright|selenium|crawl/i,
    item: {
      zh: "需要网页自动化操作、跨系统流程 RPA 或数据采集的工程师",
      en: "Engineers requiring web browser automation, cross-system RPA, or web data extraction",
    },
  },
  {
    regex: /eval|benchmark|test|quality|metric/i,
    item: {
      zh: "需要对 Agent 表现进行标准化基准评测与质量回归的工程师",
      en: "Engineers needing standardized benchmarking and quality regression testing for agents",
    },
  },
  {
    regex: /cli|terminal|command-line|shell/i,
    item: {
      zh: "偏好极简终端体验、需要嵌入命令行自动化脚本的极客开发者",
      en: "Geek developers preferring terminal interfaces and lightweight CLI workflow automation",
    },
  },
  {
    regex: /local|ollama|privacy|offline|edge/i,
    item: {
      zh: "注重私密性与数据安全、需要在离线或本地环境部署的工程团队",
      en: "Teams prioritizing privacy and data security requiring local or offline deployments",
    },
  },
  {
    regex: /voice|audio|speech|vision|multimodal|video/i,
    item: {
      zh: "探索多模态交互、端到端语音与视觉感知代理的前沿创新团队",
      en: "Innovative teams exploring multimodal interactions, end-to-end voice, and vision agents",
    },
  },
];

/** 结合 category 与 topics 产出差异化适用群体 */
export function ruleFitFor(project) {
  const topics = Array.isArray(project.topics) ? project.topics : [];
  const results = [];
  const added = new Set();

  for (const mapping of TOPIC_FIT_MAPPINGS) {
    if (topics.some((t) => mapping.regex.test(t))) {
      results.push(mapping.item);
      added.add(mapping.item.zh);
      if (results.length >= 2) break;
    }
  }

  const catItems = fitForCategory(project.category);
  for (const item of catItems) {
    if (!added.has(item.zh) && results.length < 3) {
      results.push(item);
      added.add(item.zh);
    }
  }

  return results;
}

/** 分类对应的"这个项目拿来实现什么"，用于规则版的项目介绍 */
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

function categoryBits(project) {
  const category = project.category ?? "other";
  return {
    category,
    catZh: categoryLabel(category, "zh"),
    catEn: categoryLabel(category, "en"),
    purpose: CATEGORY_PURPOSE[category] ?? CATEGORY_PURPOSE.other,
    name: project.full_name || project.name || "该项目",
    language: project.language && project.language !== "Other" ? project.language : "",
    zhTopics: readableTopicLabels(project.topics, "zh", 4),
    enTopics: readableTopicLabels(project.topics, "en", 4),
  };
}

/**
 * 规则版项目介绍：仓库自述 + 分类 + 话题标签拼装。
 * 读不懂 README，所以只能给出这一层颗粒度；LLM 版会用 README 补足细节。
 * description 是作者自己的话，信息量高于分类模板，因此中英两版都要引用
 * （中文页此前直接丢掉它，读者只剩"框架 / SDK 项目，方向：…"这种模板腔）。
 */
export function ruleIntro(project) {
  const { category, catZh, catEn, purpose, name, language, zhTopics, enTopics } = categoryBits(project);
  const description = sanitizeText(project.description);

  const anchorZh = category === "other" ? `是 AI Agent 生态里的通用项目` : `属于${catZh}，${purpose.zh}`;
  const zhHead = description ? `「${name}」的仓库自述是 “${description}”；它${anchorZh}` : `「${name}」${anchorZh}`;
  const zhTail = [zhTopics.length ? `聚焦 ${zhTopics.join("、")} 等方向` : "", language ? `主要使用 ${language}` : ""]
    .filter(Boolean)
    .join("；");
  const zh = `${zhHead}${zhTail ? `；${zhTail}` : ""}。`;

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

/** 显示宽度：CJK 与全角记 2 个单位，其余记 1 个 —— 卡片一行约容 90 单位（≈ 45 个汉字） */
export function textWidth(text) {
  let units = 0;
  for (const ch of String(text ?? "")) units += ch.codePointAt(0) > 0x2e80 ? 2 : 1;
  return units;
}

/** 压成一行：超宽时回退到最近的空格边界，不把英文单词切一半 */
export function clipToOneLine(text, maxUnits = 90) {
  const s = String(text ?? "").trim();
  if (!s || textWidth(s) <= maxUnits) return s;
  let units = 0;
  let cut = 0;
  for (let i = 0; i < s.length; i++) {
    const w = s.codePointAt(i) > 0x2e80 ? 2 : 1;
    if (units + w > maxUnits - 1) break;
    units += w;
    cut = i + 1;
  }
  let head = s.slice(0, cut);
  const space = head.lastIndexOf(" ");
  if (space >= Math.floor(cut / 2)) head = head.slice(0, space);
  return `${head.trimEnd()}…`;
}

/** 描述里含汉字才算中文读者读得懂的自述；纯英文自述整行塞进中文页，读者既读不动也读不全 */
const CJK_RE = /[\u3400-\u9fff]/;

/**
 * 规则版卡片一行：卡片上已经有分类 chip、语言标签和增速 chip，
 * 所以这一行只剩「它是什么、能干什么」这一个位置 —— 优先放仓库自述，
 * 没有自述时放读得懂的方向标签，都拿不到就明说没有描述，不复述 chip 上的信息。
 * 自述只放在读得懂它的语言那一侧：英文自述进中文页会变成一整行被截断的英文，
 * 中文页宁可退回方向标签（LLM 版才有中文版自述可放）。
 */
export function ruleCardLine(project) {
  const { catZh, catEn, language } = categoryBits(project);
  const description = sanitizeText(project.description);
  const zhTopics = readableTopicLabels(project.topics, "zh", 3);
  const enTopics = readableTopicLabels(project.topics, "en", 3);
  const zhFromDescription = description && CJK_RE.test(description) ? clipToOneLine(description, 90) : "";
  const enFromDescription = description && !CJK_RE.test(description) ? clipToOneLine(description, 90) : "";
  const zh =
    zhFromDescription ||
    (zhTopics.length
      ? `方向：${zhTopics.join("、")}`
      : language
        ? `主要使用 ${language}`
        : `${catZh}，未提供仓库描述`);
  const en =
    enFromDescription ||
    (enTopics.length
      ? `Focused on ${enTopics.join(", ")}`
      : language
        ? `Written in ${language}`
        : `A ${catEn} project with no repository description`);
  return { zh, en };
}

/** 规则版"为什么上榜"：只复述当日客观指标，不做主观推断 */
export function ruleWhy(project) {
  const m = project.metrics ?? {};
  const windowDays = project.windowDays ?? 7;
  const gain = project.weeklyGain ?? 0;
  const perDay = Math.round(project.dailyGain ?? gain / windowDays);
  const growthRate = project.growthRate;

  const zhOpening = `近 ${windowDays} 天新增 ${fmt(gain)} star（日均约 ${fmt(perDay)}${
    growthRate ? `，相对存量增速 ${growthRate}%` : ""
  }），累计 ${fmt(m.stars)} star、${fmt(m.forks)} fork`;
  const enOpening = `Gained ${fmt(gain)} stars over the last ${windowDays} days (~${fmt(perDay)}/day${
    growthRate ? `, ${growthRate}% of its base` : ""
  }), now at ${fmt(m.stars)} stars and ${fmt(m.forks)} forks`;

  const zhExtra = [];
  const enExtra = [];
  if (project.forksGain > 0) {
    zhExtra.push(`窗口内被 fork ${fmt(project.forksGain)} 次`);
    enExtra.push(`${fmt(project.forksGain)} new forks in the window`);
  }
  if (m.pushDaysAgo != null) {
    zhExtra.push(`最近一次提交在 ${m.pushDaysAgo} 天前`);
    enExtra.push(`last push ${m.pushDaysAgo} day(s) ago`);
  }
  if (m.prActivity != null && m.issueActivity != null) {
    zhExtra.push(`近 30 天新建 PR ${fmt(m.prActivity)} 个、issue ${fmt(m.issueActivity)} 个`);
    enExtra.push(`${fmt(m.prActivity)} PRs and ${fmt(m.issueActivity)} issues opened in the last 30 days`);
  }
  if (m.contributors != null) {
    zhExtra.push(`${fmt(m.contributors)} 位贡献者共同维护`);
    enExtra.push(`${fmt(m.contributors)} contributors`);
  }

  return {
    zh: `${zhOpening}。${zhExtra.length ? `${zhExtra.join("，")}。` : ""}`,
    en: `${enOpening}.${enExtra.length ? ` ${enExtra.join("; ")}.` : ""}`,
  };
}

/** 规则版亮点：只有指标可用，给不出"能干什么"的场景描述 */
export function ruleHighlights(project) {
  const m = project.metrics ?? {};
  const windowDays = project.windowDays ?? 7;
  const highlights = [];
  if (m.contributors >= 10) highlights.push({ zh: `${m.contributors} 位公开贡献者`, en: `${m.contributors} public contributors` });
  if (m.releases90d > 0) highlights.push({ zh: `近 90 天发布 ${m.releases90d} 个版本`, en: `${m.releases90d} release(s) in the last 90 days` });
  if (m.licensePermissive) highlights.push({ zh: `宽松许可证（${m.license}），商用门槛低`, en: `Permissive license (${m.license}) — easy commercial use` });
  if (project.forksGain > 0) highlights.push({ zh: `${windowDays} 天内新增 ${fmt(project.forksGain)} 次 fork`, en: `${fmt(project.forksGain)} new forks in the window` });
  if (m.ageDays != null && m.ageDays < 365) highlights.push({ zh: `新仓库，创建至今仅 ${m.ageDays} 天`, en: `Young project — only ${m.ageDays} days old` });
  return highlights;
}

export function ruleCons(project) {
  const m = project.metrics ?? {};
  const cons = [];
  if (typeof m.pushDaysAgo === "number" && m.pushDaysAgo > 30) {
    cons.push({ zh: `最近 ${m.pushDaysAgo} 天没有提交，维护可能停滞`, en: `No commits for ${m.pushDaysAgo} days — maintenance may have stalled` });
  }
  if (m.license === null) {
    cons.push({ zh: "未声明开源许可证，商用存在法务不确定性", en: "No open-source license declared — legal uncertainty for commercial use" });
  }
  if (m.stars > 0 && typeof m.openIssues === "number" && m.openIssues / m.stars > 0.025) {
    cons.push({ zh: `开放 issue ${fmt(m.openIssues)} 个，相对 star 规模偏高`, en: `${fmt(m.openIssues)} open issues — high relative to its star count` });
  }
  if (typeof m.contributors === "number" && m.contributors > 0 && m.contributors <= 3) {
    cons.push({ zh: `公开贡献者仅 ${m.contributors} 人，存在单点依赖风险`, en: `Only ${m.contributors} contributor(s) — bus-factor risk` });
  }
  // 严格区分 hasHomepage 与 hasDocs，避免错误标注「缺少官网」
  if (m.hasHomepage === false && m.hasDocs === false && typeof m.stars === "number") {
    cons.push({ zh: "缺少独立官网与文档门户，上手成本较高", en: "No dedicated homepage or documentation portal — steeper onboarding" });
  } else if (m.hasDocs === false && m.hasHomepage === true && (m.stars ?? 0) > 2000) {
    cons.push({ zh: "暂无独立文档系统（如 Wiki/Docs），查阅细节可能需通读 README", en: "No dedicated docs portal — onboarding relies primarily on README" });
  }
  if (typeof m.releases90d === "number" && m.releases90d === 0 && (m.ageDays ?? 0) > 90) {
    cons.push({ zh: "近 90 天未发布正式 Release 版本", en: "No formal releases in the last 90 days" });
  }
  return cons;
}

/**
 * 生成规则化解读（LLM 不可用时的完整兜底）。
 * @param {object} project 至少需要 metrics / weeklyGain / dailyGain / category / windowDays
 */
export function ruleBasedInterpretation(project, { lang = "zh" } = {}) {
  const install = sanitizeMultiline(project.readmeInstall, config.sanitize?.maxQuickstartLength ?? 1200);
  const quickstart = install
    ? `# 摘自 ${project.full_name ?? "仓库"} 的 README\n${install}`
    : project.url
      ? `# ${project.full_name}\n$ git clone ${project.url}.git\n$ cd ${project.name}\n# 具体安装与运行方式请参考仓库 README`
      : "";

  return {
    why: ruleWhy(project),
    intro: ruleIntro(project),
    cardLine: ruleCardLine(project),
    highlights: ruleHighlights(project),
    cons: ruleCons(project),
    fitFor: ruleFitFor(project),
    quickstart,
    source: "rules",
  };
}

/**
 * 校验并净化任意来源的解读对象。
 * why 不要求由外部提供（LLM 不写 why，它由规则版按指标生成），
 * 但整份解读至少要有一项有效内容，否则视为不合法。
 */
export function normalizeInterpretation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const why = sanitizeBilingualText(raw.why, config.sanitize?.maxWhyLength);
  const intro = sanitizeBilingualText(raw.intro, config.sanitize?.maxIntroLength);
  const cardLine = sanitizeBilingualText(raw.cardLine, config.sanitize?.maxCardLineLength);
  const highlights = sanitizeBilingualList(raw.highlights);
  if (!why && !intro && !cardLine && !highlights.length) return null;
  return {
    why,
    intro,
    cardLine,
    highlights,
    cons: sanitizeBilingualList(raw.cons),
    fitFor: sanitizeBilingualList(raw.fitFor),
    quickstart: sanitizeMultiline(raw.quickstart, config.sanitize?.maxQuickstartLength),
    firstSeen: typeof raw.firstSeen === "string" ? sanitizeText(raw.firstSeen, 10) : undefined,
  };
}

export { categoryLabel };
