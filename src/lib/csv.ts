/**
 * CSV 序列化（供 /data/*.csv 静态导出使用，W4-2）。
 * 严格按 RFC 4180 转义：含分隔符、引号或换行的字段整体加引号，内部引号翻倍。
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
