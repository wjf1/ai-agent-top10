/**
 * GitHub API 客户端：显式限流、指数退避重试、每次运行的调用预算。
 *
 * 之前所有请求都散落在单文件里，既没有重试也没有速率控制，
 * 扩数据维度后很容易在 CI 里被 403 打断（P1-A1 风险表首条）。
 */
import { execSync } from "node:child_process";
import { config } from "../../src/lib/config.mjs";

const API = "https://api.github.com";

/**
 * 收集可用 token：优先 GITHUB_TOKEN_1 / GITHUB_TOKEN_2（可轮询、额度翻倍），
 * 其次 GITHUB_TOKEN，最后回落到本机 gh CLI 登录态。
 */
export function resolveTokens() {
  const out = [];
  for (const key of ["GITHUB_TOKEN_1", "GITHUB_TOKEN_2", "GITHUB_TOKEN", "GH_TOKEN"]) {
    const v = (process.env[key] ?? "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  if (out.length) return out;
  try {
    const t = execSync("gh auth token", { encoding: "utf8" }).trim();
    return t ? [t] : [];
  } catch {
    return [];
  }
}

/** 首个可用 token（保持旧接口兼容） */
export function resolveToken() {
  return resolveTokens()[0] ?? "";
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 给任意异步任务加一道墙钟上限。
 *
 * 单次请求有超时，但一个仓库的处理由多次请求加解析组成；只要其中任意一次
 * 在底层连接上永久挂住（无响应、也不触发 abort），整轮抓取就会静默停住 ——
 * 这是实际观察到的失败模式。用墙钟上限把它降级成"跳过这个仓库并记录"。
 */
export async function withTimeout(task, ms, label = "operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms wall clock`)), ms);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
    // 任务被放弃后仍可能迟到失败，吞掉以免变成 unhandledRejection
    if (task && typeof task.then === "function") task.then(undefined, () => {});
  }
}

function retryAfterMs(res) {
  const ra = res.headers.get("retry-after");
  if (ra && /^\d+$/.test(ra.trim())) return Math.min(60_000, Number(ra.trim()) * 1000);
  const reset = res.headers.get("x-ratelimit-reset");
  if (reset && /^\d+$/.test(reset.trim())) {
    return Math.max(0, Math.min(60_000, Number(reset.trim()) * 1000 - Date.now()));
  }
  return null;
}

export function createClient({ token = null, tokens = null, log = console.log } = {}) {
  const {
    maxCallsPerRun = 1400,
    maxRetries = 3,
    baseBackoffMs = 800,
    minRemainingBeforeWait = 200,
    minSearchRemainingBeforeWait = 5,
    requestTimeoutMs = 20000,
  } = config.api ?? {};

  // 多 token 轮询：任一 token 额度耗尽 / 被限流时自动切到下一个（T2.5）
  const tokenList = (tokens && tokens.length ? tokens : token ? [token] : resolveTokens()).slice();
  let tokenIndex = 0;
  const currentToken = () => tokenList[tokenIndex] ?? "";
  let rotations = 0;

  let calls = 0;
  let retries = 0;
  let throttled = 0;
  let timeouts = 0;
  let exhausted = false;
  // search 与 core 是两套独立额度（search 30/分钟，core 5000/小时），必须分开记，
  // 否则 search 返回的 29 会被当成 core 余额，触发无意义等待。
  let coreRemaining = null;
  let searchRemaining = null;
  const isSearchUrl = (url) => url.startsWith("/search");

  const DEBUG = !!process.env.DEBUG_REQUESTS;

  async function once(url) {
    calls++;
    if (calls > maxCallsPerRun) {
      exhausted = true;
      throw new Error(`API call budget exhausted (${maxCallsPerRun})`);
    }
    const startedAt = Date.now();
    if (DEBUG) log(`    → #${calls} GET ${url}`);
    const headers = {
      Accept: url.includes("stargazers")
        ? "application/vnd.github.star+json"
        : "application/vnd.github+json",
      "User-Agent": "ai-agent-top10",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (tokenList.length === 0) headers.Authorization = undefined;
    else headers.Authorization = `Bearer ${currentToken()}`;
    if (!currentToken()) delete headers.Authorization;

    // 必须显式超时：Node 的 fetch 默认无限等待，代理停滞时会永久挂住整个流水线
    const res = await fetch(`${API}${url}`, { headers, signal: AbortSignal.timeout(requestTimeoutMs) });
    const remainingHeader = res.headers.get("x-ratelimit-remaining");
    if (remainingHeader && /^\d+$/.test(remainingHeader)) {
      if (isSearchUrl(url)) searchRemaining = Number(remainingHeader);
      else coreRemaining = Number(remainingHeader);
    }

    if (DEBUG) log(`    ← #${calls} ${res.status} (${Date.now() - startedAt}ms)`);
    if (res.ok) return res.json();

    const body = (await res.text()).slice(0, 300);
    const err = new Error(`${res.status} ${url}: ${body}`);
    err.status = res.status;
    err.retryAfter = retryAfterMs(res);
    throw err;
  }

  /** 切到下一个 token；没有下一个返回 false */
  function rotateToken() {
    if (tokenIndex + 1 >= tokenList.length) return false;
    tokenIndex++;
    rotations++;
    coreRemaining = null;
    searchRemaining = null;
    log(`  ~ token rotated (${tokenIndex + 1}/${tokenList.length})`);
    return true;
  }

  /** 带重试的请求；404 视为“无此资源/超页”，直接抛出由调用方决定降级 */
  async function gh(url) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // search 与 core 额度独立：search 只有 30 次/分钟，耗尽是 403 且要等满一分钟。
        // 接近下限时先停一下，比被 403 打回再退避更省事（T2.10）。
        if (isSearchUrl(url) && searchRemaining !== null && searchRemaining < minSearchRemainingBeforeWait && attempt === 0) {
          throttled++;
          const wait = Math.min(30_000, Math.max(baseBackoffMs * 2, 5_000));
          log(`  ~ search rate limit low (${searchRemaining} left), waiting ${wait}ms`);
          await sleep(wait);
        }
        // core 额度偏低时先等一下，避免整批请求被 403 打回
        if (!isSearchUrl(url) && coreRemaining !== null && coreRemaining < minRemainingBeforeWait && attempt === 0) {
          throttled++;
          const wait = Math.min(5_000, baseBackoffMs * 2 ** attempt);
          log(`  ~ core rate limit low (${coreRemaining} left), waiting ${wait}ms`);
          await sleep(wait);
        }
        return await once(url);
      } catch (e) {
        lastError = e;
        // 超时与网络错误同样值得重试，否则一次抖动就会让整个仓库被跳过
        const isTimeout = e.name === "TimeoutError" || e.name === "AbortError";
        if (isTimeout) timeouts++;
        // 额度类错误优先换 token（T2.5）：换 token 往往能立刻恢复，比退避等待更有效
        const rateLimited =
          e.status === 403 || e.status === 429 || /rate limit|API rate/i.test(String(e.message ?? ""));
        if (rateLimited && rotateToken()) continue;
        const retryable =
          isTimeout || rateLimited || e.status >= 500 || e.retryAfter;
        if (!retryable || attempt === maxRetries || exhausted) throw e;
        retries++;
        const backoff = e.retryAfter ?? Math.min(requestTimeoutMs, baseBackoffMs * 2 ** attempt);
        await sleep(backoff);
      }
    }
    throw lastError;
  }

  async function search(query, { sort = "stars", perPage = 60 } = {}) {
    const url = `/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=desc&per_page=${perPage}`;
    const data = await gh(url);
    return data.items ?? [];
  }

  return {
    gh,
    search,
    stats: () => ({ calls, retries, throttled, timeouts, rotations, tokens: tokenList.length, coreRemaining, searchRemaining, exhausted }),
  };
}
