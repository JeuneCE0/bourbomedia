// Lightweight CSV export — no dependency.

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    const blob = new Blob(['Aucune donnée\n'], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, filename);
    return;
  }
  const cols = columns || Object.keys(rows[0]);
  const header = cols.map(escapeCsv).join(';');
  const body = rows.map(r => cols.map(c => escapeCsv(r[c])).join(';')).join('\n');
  // BOM ﻿ so Excel opens UTF-8 properly
  const csv = '﻿' + header + '\n' + body + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
