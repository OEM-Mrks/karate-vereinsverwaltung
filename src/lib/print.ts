// Hilfsfunktionen für Exporte.

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
