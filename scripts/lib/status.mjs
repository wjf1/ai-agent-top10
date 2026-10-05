/**
 * 解读来源构成与降级告警。
 *
 * 2026-09-28 起 CI 上的 LLM 解读调不通（默认 baseUrl 指向本机网关，runner 不可达），
 * 每天都静默回落到模板文案，而 workflow 一直是绿的 —— 一周后才从页面文案发现。
 * 这里把"回落"变成看得见的信号：Actions 注解 + step summary。
 */

/** @returns {{total:number, manual:number, llm:number, rules:number, unknown:number}} */
export function interpretationStatus(entries) {
  const out = { total: 0, manual: 0, llm: 0, rules: 0, unknown: 0 };
  for (const entry of entries ?? []) {
    out.total++;
    const source = entry?.interpretationSource;
    if (source === "manual" || source === "llm" || source === "rules") out[source]++;
    else out.unknown++;
  }
  return out;
}

/** 只要有条目是规则文案就该提示：那天的介绍就是模板拼的，不是编辑写的 */
export function ciWarningLine(status) {
  if (!status?.rules) return "";
  const whole = status.rules === status.total;
  return (
    `::warning title=解读退回模板文案::${status.rules}/${status.total} 条没有拿到 LLM 解读` +
    `${whole ? "（整轮降级）" : ""}，页面上的项目介绍是分类与话题标签拼装的。` +
    `检查 secrets.LLM_API_KEY 与 vars.LLM_BASE_URL / vars.LLM_MODEL —— ` +
    `config 里默认的 baseUrl 是本机网关，GitHub runner 访问不到。`
  );
}

/** 写进 $GITHUB_STEP_SUMMARY 的一行摘要 */
export function stepSummary(status, date = "") {
  const { manual, llm, rules, unknown, total } = status;
  const tail = unknown ? ` · 来源未知 ${unknown}` : "";
  return `解读来源${date ? ` ${date}` : ""}：llm ${llm} · manual ${manual} · rules ${rules}${tail}（共 ${total} 条）`;
}
