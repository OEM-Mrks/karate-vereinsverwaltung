// Druckt ein eigenständiges HTML-Dokument (z. B. Kündigungsbestätigung) über ein unsichtbares iframe.

export function escapeHtml(s: string | number | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function printHtml(title: string, body: string) {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 11pt; color: #111; line-height: 1.45; }
  h1 { font-size: 15pt; margin: 0 0 12pt; }
  .absender { font-size: 8pt; color: #555; border-bottom: 1px solid #999; display: inline-block; margin-bottom: 4pt; }
  .anschrift { min-height: 38mm; margin-top: 8mm; }
  .datum { text-align: right; margin: 8mm 0; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 3pt 6pt; border-bottom: 1px solid #ddd; text-align: left; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .sign { margin-top: 18mm; }
</style></head><body>${body}</body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = url;
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      iframe.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  document.body.appendChild(iframe);
}

/** CSV mit BOM, damit Excel Umlaute korrekt anzeigt. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

export function centToCsv(c: number | null | undefined): string {
  return c == null ? '' : (c / 100).toFixed(2).replace('.', ',');
}
