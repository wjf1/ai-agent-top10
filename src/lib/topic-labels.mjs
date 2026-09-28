/**
 * 话题标签的双语显示名。
 *
 * 键是 sanitizeTopics 归一化后的小写 slug。定位解读（interpret.mjs）用它把话题标签
 * 展开成可读文本；未收录的标签保留原始 slug —— 宁可显示 claude-code 这样的原词，
 * 也不要把产品名硬译成不存在的说法。
 */

/** @type {Record<string, {zh: string, en: string}>} */
const TABLE = {
  // —— 主体概念 ——
  "ai-agents": { zh: "AI Agent", en: "AI Agents" },
  "ai-agent": { zh: "AI Agent", en: "AI Agents" },
  agent: { zh: "Agent", en: "Agent" },
  agents: { zh: "Agent", en: "Agents" },
  agentic: { zh: "Agentic 工作流", en: "Agentic Workflows" },
  "agentic-ai": { zh: "Agentic AI", en: "Agentic AI" },
  "agentic-workflow": { zh: "Agentic 工作流", en: "Agentic Workflows" },
  "multi-agent": { zh: "多 Agent 协作", en: "Multi-Agent" },
  multiagent: { zh: "多 Agent 协作", en: "Multi-Agent" },
  "agent-framework": { zh: "Agent 框架", en: "Agent Frameworks" },
  "agent-frameworks": { zh: "Agent 框架", en: "Agent Frameworks" },
  "agent-skills": { zh: "Agent 技能", en: "Agent Skills" },
  skills: { zh: "技能扩展", en: "Skills" },
  "agent-ide": { zh: "Agent IDE", en: "Agent IDE" },
  "coding-agent": { zh: "编码 Agent", en: "Coding Agents" },
  "coding-assistant": { zh: "编码助手", en: "Coding Assistant" },
  "code-assistant": { zh: "编码助手", en: "Code Assistant" },

  // —— 模型与推理 ——
  llm: { zh: "大语言模型", en: "LLM" },
  llms: { zh: "大语言模型", en: "LLMs" },
  "large-language-model": { zh: "大语言模型", en: "Large Language Models" },
  reasoning: { zh: "推理", en: "Reasoning" },
  planning: { zh: "任务规划", en: "Planning" },
  planner: { zh: "任务规划", en: "Planner" },
  memory: { zh: "记忆", en: "Memory" },
  multimodal: { zh: "多模态", en: "Multimodal" },
  embedding: { zh: "向量嵌入", en: "Embeddings" },
  embeddings: { zh: "向量嵌入", en: "Embeddings" },
  rag: { zh: "RAG 检索增强", en: "RAG" },
  "retrieval-augmented-generation": { zh: "RAG 检索增强", en: "Retrieval-Augmented Generation" },
  "prompt-engineering": { zh: "提示词工程", en: "Prompt Engineering" },
  prompts: { zh: "提示词", en: "Prompts" },
  "fine-tuning": { zh: "模型微调", en: "Fine-Tuning" },

  // —— 协议与接口 ——
  mcp: { zh: "MCP 协议", en: "MCP" },
  "model-context-protocol": { zh: "MCP 协议", en: "Model Context Protocol" },
  "mcp-server": { zh: "MCP 服务", en: "MCP Server" },
  "mcp-servers": { zh: "MCP 服务", en: "MCP Servers" },
  "tool-use": { zh: "工具调用", en: "Tool Use" },
  "function-calling": { zh: "函数调用", en: "Function Calling" },
  tools: { zh: "工具调用", en: "Tools" },
  api: { zh: "API 接口", en: "API" },
  gateway: { zh: "网关", en: "Gateway" },
  proxy: { zh: "代理网关", en: "Proxy" },

  // —— 工程与工作流 ——
  automation: { zh: "自动化", en: "Automation" },
  workflow: { zh: "工作流", en: "Workflows" },
  "workflow-automation": { zh: "工作流自动化", en: "Workflow Automation" },
  orchestration: { zh: "编排", en: "Orchestration" },
  "code-generation": { zh: "代码生成", en: "Code Generation" },
  codegen: { zh: "代码生成", en: "Code Generation" },
  "code-execution": { zh: "代码执行", en: "Code Execution" },
  sandbox: { zh: "沙箱", en: "Sandbox" },
  observability: { zh: "可观测性", en: "Observability" },
  monitoring: { zh: "监控", en: "Monitoring" },
  tracing: { zh: "链路追踪", en: "Tracing" },
  devtools: { zh: "开发者工具", en: "DevTools" },
  "developer-tools": { zh: "开发者工具", en: "Developer Tools" },
  cli: { zh: "命令行工具", en: "CLI" },
  sdk: { zh: "SDK", en: "SDK" },
  framework: { zh: "框架", en: "Framework" },
  ide: { zh: "IDE", en: "IDE" },
  plugin: { zh: "插件", en: "Plugins" },
  plugins: { zh: "插件", en: "Plugins" },
  extension: { zh: "扩展", en: "Extensions" },
  extensions: { zh: "扩展", en: "Extensions" },
  "vscode-extension": { zh: "VS Code 扩展", en: "VS Code Extensions" },
  "self-hosted": { zh: "自托管", en: "Self-Hosted" },
  "local-first": { zh: "本地优先", en: "Local-First" },
  docker: { zh: "容器化部署", en: "Docker" },

  // —— 交互形态 ——
  assistant: { zh: "智能助手", en: "Assistant" },
  copilot: { zh: "Copilot 助手", en: "Copilot" },
  chatbot: { zh: "对话应用", en: "Chatbot" },
  chat: { zh: "对话交互", en: "Chat" },
  desktop: { zh: "桌面应用", en: "Desktop" },
  "desktop-app": { zh: "桌面应用", en: "Desktop App" },
  "web-app": { zh: "Web 应用", en: "Web App" },
  productivity: { zh: "效率工具", en: "Productivity" },
  "browser-automation": { zh: "浏览器自动化", en: "Browser Automation" },
  "browser-use": { zh: "浏览器操作", en: "Browser Use" },
  "web-scraping": { zh: "网页抓取", en: "Web Scraping" },
  scraping: { zh: "网页抓取", en: "Scraping" },
  crawler: { zh: "网页抓取", en: "Crawler" },
  voice: { zh: "语音交互", en: "Voice" },
  tts: { zh: "语音合成", en: "TTS" },
  stt: { zh: "语音识别", en: "STT" },

  // —— 评测与数据 ——
  benchmark: { zh: "评测基准", en: "Benchmarks" },
  benchmarks: { zh: "评测基准", en: "Benchmarks" },
  evaluation: { zh: "评测", en: "Evaluation" },
  eval: { zh: "评测", en: "Evaluation" },
  evals: { zh: "评测", en: "Evals" },
  dataset: { zh: "数据集", en: "Datasets" },
  datasets: { zh: "数据集", en: "Datasets" },
  "knowledge-base": { zh: "知识库", en: "Knowledge Base" },
  "vector-database": { zh: "向量数据库", en: "Vector Database" },

  // —— 生态与产品 ——
  anthropic: { zh: "Anthropic", en: "Anthropic" },
  claude: { zh: "Claude", en: "Claude" },
  "claude-code": { zh: "Claude Code", en: "Claude Code" },
  openai: { zh: "OpenAI", en: "OpenAI" },
  gpt: { zh: "GPT", en: "GPT" },
  chatgpt: { zh: "ChatGPT", en: "ChatGPT" },
  codex: { zh: "Codex", en: "Codex" },
  gemini: { zh: "Gemini", en: "Gemini" },
  deepseek: { zh: "DeepSeek", en: "DeepSeek" },
  ollama: { zh: "Ollama", en: "Ollama" },
  langchain: { zh: "LangChain", en: "LangChain" },
  "cursor-agent": { zh: "Cursor Agent", en: "Cursor Agent" },
  cursor: { zh: "Cursor", en: "Cursor" },
  security: { zh: "安全", en: "Security" },
  pentest: { zh: "渗透测试", en: "Pentesting" },
};

/**
 * 单个标签的显示名。
 * 未收录时两种语言都保留原始 slug：把 ade 猜成 "Ade"、把 dsh-plugin 猜成
 * "Dsh Plugin" 都是错的大小写，不如原样显示。
 */
export function topicLabel(topic, lang = "zh") {
  const key = String(topic ?? "").toLowerCase();
  if (!key) return "";
  const hit = TABLE[key];
  return hit ? hit[lang === "zh" ? "zh" : "en"] : key;
}

/** 取前 limit 个标签的显示名（已去重、去掉空串） */
export function topicLabels(list, lang = "zh", limit = 4) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const label = topicLabel(item, lang);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}
