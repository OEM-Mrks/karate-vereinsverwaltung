// Kassenprüfung: Buchungen Beleg für Beleg abhaken, Rückfragen klären, Bericht erstellen.

import { all, get, run, scalar, tx } from '../db/db';
import type { Audit, AuditCheck, Transaction } from '../db/schema';
import { buildReport, type Report } from './report';
import { isCalibrated } from './bank';
import { belegFehlt } from './docs';
import { missingMonths } from './statements';

export type AuditItem = Transaction & {
  zuordnung: { kat: string | null; nummer: string | null; name: string | null; betrag_cent: number; beleg_pflicht: number }[];
  belege: { id: number; belegnr: string | null; dateiname: string; mime: string }[];
  check: AuditCheck | null;
};

export function getAudit(jahr: number): Audit | undefined {
  return get<Audit>('SELECT * FROM audits WHERE jahr = ?', [jahr]);
}

export function startAudit(jahr: number, v: { pruefer: string; pruefdatum: string; ort: string; umfang: Audit['umfang'] }): number {
  return run('INSERT INTO audits(jahr, pruefer, pruefdatum, ort, umfang) VALUES (?,?,?,?,?)', [jahr, v.pruefer.trim(), v.pruefdatum, v.ort.trim(), v.umfang]);
}

export function updateAudit(id: number, v: Partial<Pick<Audit, 'pruefer' | 'pruefdatum' | 'ort' | 'umfang' | 'feststellungen' | 'entlastung' | 'abgeschlossen'>>) {
  const keys = Object.keys(v) as (keyof typeof v)[];
  if (!keys.length) return;
  run(`UPDATE audits SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => v[k] as string | number | null), id]);
}

/** Alle zu prüfenden Buchungen eines Jahres gemäß Prüfungsumfang. */
export function auditItems(audit: Audit): AuditItem[] {
  const txs = all<Transaction>('SELECT * FROM transactions WHERE buchungsdatum BETWEEN ? AND ? ORDER BY buchungsdatum, id', [
    `${audit.jahr}-01-01`, `${audit.jahr}-12-31`,
  ]);
  const allocs = all<{ transaction_id: number; nummer: string | null; name: string | null; betrag_cent: number; beleg_pflicht: number; wer: string | null }>(
    `SELECT a.transaction_id, c.nummer, c.name, a.betrag_cent, COALESCE(c.beleg_pflicht, 0) AS beleg_pflicht,
            COALESCE(p.name, m.nachname || ', ' || m.vorname) AS wer
     FROM allocations a JOIN transactions t ON t.id = a.transaction_id
     LEFT JOIN categories c ON c.id = a.category_id LEFT JOIN partners p ON p.id = a.partner_id LEFT JOIN members m ON m.id = a.member_id
     WHERE t.buchungsdatum BETWEEN ? AND ?`,
    [`${audit.jahr}-01-01`, `${audit.jahr}-12-31`],
  );
  const docs = all<{ id: number; transaction_id: number; belegnr: string | null; dateiname: string; mime: string }>(
    'SELECT id, transaction_id, belegnr, dateiname, mime FROM documents WHERE transaction_id IS NOT NULL ORDER BY id',
  );
  const checks = new Map(all<AuditCheck>('SELECT * FROM audit_checks WHERE audit_id = ?', [audit.id]).map((c) => [c.transaction_id, c]));
  const items = txs.map((t) => ({
    ...t,
    zuordnung: allocs.filter((a) => a.transaction_id === t.id).map((a) => ({
      kat: a.nummer ? `${a.nummer} ${a.name}` : null, nummer: a.nummer, name: a.wer, betrag_cent: a.betrag_cent, beleg_pflicht: a.beleg_pflicht,
    })),
    belege: docs.filter((d) => d.transaction_id === t.id),
    check: checks.get(t.id) ?? null,
  }));
  if (audit.umfang === 'ausgaben') return items.filter((i) => i.betrag_cent < 0);
  if (audit.umfang === 'belegpflichtig') return items.filter((i) => i.zuordnung.some((z) => z.beleg_pflicht) || i.belege.length > 0);
  return items;
}

export function setCheck(auditId: number, transactionId: number, status: 'ok' | 'frage', kommentar: string | null) {
  run(
    `INSERT INTO audit_checks(audit_id, transaction_id, status, kommentar, geprueft_am) VALUES (?,?,?,?, datetime('now','localtime'))
     ON CONFLICT(audit_id, transaction_id) DO UPDATE SET status = excluded.status, kommentar = excluded.kommentar, geprueft_am = excluded.geprueft_am`,
    [auditId, transactionId, status, kommentar?.trim() || null],
  );
}

export function setAnswer(auditId: number, transactionId: number, antwort: string) {
  run('UPDATE audit_checks SET antwort = ? WHERE audit_id = ? AND transaction_id = ?', [antwort.trim() || null, auditId, transactionId]);
}

export function clearCheck(auditId: number, transactionId: number) {
  run('DELETE FROM audit_checks WHERE audit_id = ? AND transaction_id = ?', [auditId, transactionId]);
}

export type AuditSummary = {
  gesamt: number;
  geprueft: number;
  ok: number;
  fragen: number;
  offeneFragen: number;
  ohneBeleg: number;
  report: Report;
  hinweise: { ok: boolean; text: string }[];
};

/** Automatische Prüfpunkte + Fortschritt. */
export function auditSummary(audit: Audit, items: AuditItem[]): AuditSummary {
  const report = buildReport(audit.jahr);
  const geprueft = items.filter((i) => i.check).length;
  const fragen = items.filter((i) => i.check?.status === 'frage');
  const ohneBeleg = items.filter((i) => belegFehlt(i.zuordnung.filter((z) => z.beleg_pflicht).length, i.belege.length, i.belege_vollstaendig)).length;
  const hinweise: { ok: boolean; text: string }[] = [];
  for (const k of report.konten) {
    if (!isCalibrated(k.account)) {
      hinweise.push({ ok: false, text: `${k.account.name}: Kontostand nicht abgeglichen – Anfangssaldo fehlt, Kontostände sind nur Summen der Buchungen` });
    } else if (k.laut_auszug) {
      const diff = (k.ende ?? 0) - k.laut_auszug.saldo_cent;
      hinweise.push({ ok: diff === 0, text: `${k.account.name}: Kontostand 31.12. laut Auszug ${diff === 0 ? 'stimmt mit den Buchungen überein' : `weicht um ${(diff / 100).toFixed(2).replace('.', ',')} € ab`}` });
    } else {
      hinweise.push({ ok: false, text: `${k.account.name}: Kontostand 31.12. laut Kontoauszug noch nicht erfasst` });
    }
  }
  for (const k of report.konten) {
    const fehlt = missingMonths(k.account.id, audit.jahr, `${audit.jahr + 1}-01-01`);
    const namen = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    hinweise.push({ ok: !fehlt.length, text: fehlt.length ? `${k.account.name}: Kontoauszüge fehlen für ${fehlt.map((m) => namen[m - 1]).join(', ')}` : `${k.account.name}: Kontoauszüge für alle Monate abgelegt` });
  }
  hinweise.push({ ok: report.unzugeordnet.anzahl === 0, text: report.unzugeordnet.anzahl ? `${report.unzugeordnet.anzahl} Buchungen sind nicht (vollständig) zugeordnet` : 'Alle Buchungen sind einer Kategorie zugeordnet' });
  hinweise.push({ ok: ohneBeleg === 0, text: ohneBeleg ? `${ohneBeleg} belegpflichtige Buchungen ohne Beleg` : 'Zu allen belegpflichtigen Buchungen liegt ein Beleg vor' });
  hinweise.push({ ok: report.differenz === 0, text: report.differenz === 0 ? 'Einnahmen und Ausgaben erklären die Veränderung des Kontostands vollständig' : 'Abstimmungsdifferenz zwischen Buchungen und Kontostand' });
  return {
    gesamt: items.length,
    geprueft,
    ok: items.filter((i) => i.check?.status === 'ok').length,
    fragen: fragen.length,
    offeneFragen: fragen.filter((i) => !i.check?.antwort).length,
    ohneBeleg,
    report,
    hinweise,
  };
}

// ---------- Austausch mit Kassenprüfern auf einem anderen Rechner ----------

type ProtocolFile = {
  typ: 'kassenpruefung';
  version: 1;
  jahr: number;
  pruefer: string | null;
  checks: { transaction_id: number; hash: string | null; status: 'ok' | 'frage'; kommentar: string | null; antwort: string | null; geprueft_am: string }[];
};

/** Prüfvermerke als kleine Datei (ohne Belege/Personendaten außer Kommentaren). */
export function exportProtocol(audit: Audit): string {
  const rows = all<AuditCheck & { hash: string | null }>(
    'SELECT c.*, t.hash FROM audit_checks c JOIN transactions t ON t.id = c.transaction_id WHERE c.audit_id = ?',
    [audit.id],
  );
  const file: ProtocolFile = {
    typ: 'kassenpruefung', version: 1, jahr: audit.jahr, pruefer: audit.pruefer,
    checks: rows.map((r) => ({ transaction_id: r.transaction_id, hash: r.hash, status: r.status, kommentar: r.kommentar, antwort: r.antwort, geprueft_am: r.geprueft_am })),
  };
  return JSON.stringify(file, null, 1);
}

/** Übernimmt Prüfvermerke aus einer Protokolldatei. Neuere Vermerke gewinnen, Antworten bleiben erhalten. */
export function importProtocol(audit: Audit, json: string): { uebernommen: number; unbekannt: number } {
  let f: ProtocolFile;
  try {
    f = JSON.parse(json);
  } catch {
    throw new Error('Die Datei ist kein gültiges Prüfprotokoll.');
  }
  if (f.typ !== 'kassenpruefung' || !Array.isArray(f.checks)) throw new Error('Die Datei ist kein gültiges Prüfprotokoll.');
  if (f.jahr !== audit.jahr) throw new Error(`Das Protokoll gehört zum Geschäftsjahr ${f.jahr}, nicht zu ${audit.jahr}.`);
  let uebernommen = 0;
  let unbekannt = 0;
  tx(() => {
    for (const c of f.checks) {
      const t = get<{ id: number; hash: string | null }>('SELECT id, hash FROM transactions WHERE id = ?', [c.transaction_id]);
      const id = t && (!c.hash || t.hash === c.hash) ? t.id : c.hash ? scalar<number>('SELECT id FROM transactions WHERE hash = ?', [c.hash]) : undefined;
      if (!id) {
        unbekannt++;
        continue;
      }
      const cur = get<AuditCheck>('SELECT * FROM audit_checks WHERE audit_id = ? AND transaction_id = ?', [audit.id, id]);
      if (cur && cur.geprueft_am > c.geprueft_am) {
        if (c.antwort && !cur.antwort) setAnswer(audit.id, id, c.antwort);
        continue;
      }
      run(
        `INSERT INTO audit_checks(audit_id, transaction_id, status, kommentar, antwort, geprueft_am) VALUES (?,?,?,?,?,?)
         ON CONFLICT(audit_id, transaction_id) DO UPDATE SET status = excluded.status, kommentar = excluded.kommentar,
           antwort = COALESCE(excluded.antwort, audit_checks.antwort), geprueft_am = excluded.geprueft_am`,
        [audit.id, id, c.status, c.kommentar, c.antwort, c.geprueft_am],
      );
      uebernommen++;
    }
    if (f.pruefer && !audit.pruefer) updateAudit(audit.id, { pruefer: f.pruefer });
  });
  return { uebernommen, unbekannt };
}
