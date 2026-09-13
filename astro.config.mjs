import { defineConfig } from "astro/config";

// GitHub Pages 部署时设置 BASE=/ai-agent-top10（仓库名），本地默认 /
export default defineConfig({
  site: "https://wjf1.github.io",
  base: process.env.BASE || "/",
});
