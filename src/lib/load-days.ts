/** 构建期加载每日榜单数据（getStaticPaths 与组件共用） */
const files = import.meta.glob("../data/daily/*.json", { eager: true });
export const days = Object.values(files)
  .map((m) => m.default)
  .sort((a, b) => b.date.localeCompare(a.date));
