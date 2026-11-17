export function toCsv<T extends Record<string, any>>(rows: T[], columns: Array<keyof T>): string {
  const header = columns.map(String).join(",");
  const esc = (v: any): string => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => columns.map((c) => esc(r[c])).join(",")).join("\n");
  return header + "\n" + body;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
