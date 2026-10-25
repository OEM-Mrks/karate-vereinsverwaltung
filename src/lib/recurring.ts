// Wiederkehrende Zahlungen (Verbandsbeiträge, Versicherungen …): Betrag ab Jahr, Fälligkeiten je Jahr abhaken,
// passende Buchung vorschlagen und optional einen Eigenbeleg erzeugen.

import { all, get, run, tx } from '../db/db';
import type { Partner, Recurring, RecurringAmount, RecurringPayment, Rhythmus, Transaction } from '../db/schema';
import { setAllocations } from './bank';
import { fromISO, normalizeIBAN, normalizeText, toISO, todayISO } from './format';

export const RHYTHMEN: { id: Rhythmus; label: string; jeJahr: number }[] = [
  { id: 'jaehrlich', label: 'jährlich', jeJahr: 1 },
  { id: 'halbjaehrlich', label: 'halbjährlich', jeJahr: 2 },
  { id: 'quartal', label: 'vierteljährlich', jeJahr: 4 },
  { id: 'monatlich', label: 'monatlich', jeJahr: 12 },
];

export const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const jeJahr = (r: Rhythmus) => RHYTHMEN.find((x) => x.id === r)?.jeJahr ?? 1;

/** Monat (1–12) der Fälligkeit Nr. `periode` im Jahr. */
export function faelligMonat(r: Pick<Recurring, 'rhythmus' | 'faellig_monat'>, periode: number): number {
  return ((r.faellig_monat - 1 + (periode - 1) * (12 / jeJahr(r.rhythmus))) % 12) + 1;
}

/** Betrag je Fälligkeit im Jahr – der zuletzt gültige Eintrag „ab Jahr“ gilt weiter. */
export function betragFuer(amounts: Pick<RecurringAmount, 'ab_jahr' | 'betrag_cent'>[], jahr: number): number | null {
  const gueltig = amounts.filter((a) => a.ab_jahr <= jahr).sort((a, b) => b.ab_jahr - a.ab_jahr)[0];
  return gueltig ? gueltig.betrag_cent : null;
}

export type RecurringView = Recurring & { amounts: RecurringAmount[]; partner: string | null; kategorie: string | null };

export function recurringList(): RecurringView[] {
  const amounts = all<RecurringAmount>('SELECT * FROM recurring_amounts ORDER BY ab_jahr');
  return all<Recurring & { partner: string | null; kategorie: string | null }>(
    `SELECT r.*, p.name AS partner, CASE WHEN c.id IS NULL THEN NULL ELSE c.nummer || ' ' || c.name END AS kategorie
     FROM recurring r LEFT JOIN partners p ON p.id = r.partner_id LEFT JOIN categories c ON c.id = r.category_id
     ORDER BY r.aktiv DESC, r.faellig_monat, r.name`,
  ).map((r) => ({ ...r, amounts: amounts.filter((a) => a.recurring_id === r.id) }));
}

export function saveRecurring(r: Partial<Recurring>, amounts: { ab_jahr: number; betrag_cent: number }[]): number {
  const clean = amounts.filter((a) => a.ab_jahr > 1900 && a.betrag_cent > 0);
  if (!r.name?.trim()) throw new Error('Bitte eine Bezeichnung angeben.');
  if (!clean.length) throw new Error('Bitte mindestens einen Betrag mit „ab Jahr“ angeben.');
  if (new Set(clean.map((a) => a.ab_jahr)).size !== clean.length) throw new Error('Jedes Jahr darf nur einmal vorkommen.');
  const abJahr = Math.min(...clean.map((a) => a.ab_jahr));
  const vals = [
    r.name.trim(), r.partner_id ?? null, r.category_id ?? null, r.richtung ?? 'aus', r.rhythmus ?? 'jaehrlich', r.faellig_monat ?? 1,
    abJahr, r.bis_jahr || null, r.eigenbeleg ? 1 : 0, r.eigenbeleg_grund?.trim() || null, r.notiz?.trim() || null, r.aktiv === 0 ? 0 : 1,
  ];
  return tx(() => {
    let id = r.id;
    if (id) {
      run(`UPDATE recurring SET name=?, partner_id=?, category_id=?, richtung=?, rhythmus=?, faellig_monat=?, ab_jahr=?, bis_jahr=?,
           eigenbeleg=?, eigenbeleg_grund=?, notiz=?, aktiv=? WHERE id=?`, [...vals, id]);
    } else {
      id = run(`INSERT INTO recurring(name, partner_id, category_id, richtung, rhythmus, faellig_monat, ab_jahr, bis_jahr,
                eigenbeleg, eigenbeleg_grund, notiz, aktiv) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, vals);
    }
    run('DELETE FROM recurring_amounts WHERE recurring_id = ?', [id]);
    for (const a of clean) run('INSERT INTO recurring_amounts(recurring_id, ab_jahr, betrag_cent) VALUES (?,?,?)', [id, a.ab_jahr, a.betrag_cent]);
    return id;
  });
}

export function deleteRecurring(id: number) {
  run('DELETE FROM recurring WHERE id = ?', [id]);
}

export type Faelligkeit = {
  r: RecurringView;
  jahr: number;
  periode: number;
  monat: number;
  betrag_cent: number | null;    // Betrag laut Tabelle (positiv)
  zahlung: RecurringPayment | null;
  status: 'erledigt' | 'ueberfaellig' | 'faellig' | 'offen';
};

/** Alle Fälligkeiten eines Jahres mit Status (erledigt, überfällig, diesen Monat fällig, später). */
export function faelligkeiten(jahr: number, heute = todayISO()): Faelligkeit[] {
  const zahlungen = all<RecurringPayment>('SELECT * FROM recurring_payments WHERE jahr = ?', [jahr]);
  const jetzt = heute.slice(0, 7);
  const out: Faelligkeit[] = [];
  for (const r of recurringList()) {
    if (!r.aktiv || r.ab_jahr > jahr || (r.bis_jahr && r.bis_jahr < jahr)) continue;
    for (let p = 1; p <= jeJahr(r.rhythmus); p++) {
      const monat = faelligMonat(r, p);
      const zahlung = zahlungen.find((z) => z.recurring_id === r.id && z.periode === p) ?? null;
      const ym = `${jahr}-${String(monat).padStart(2, '0')}`;
      out.push({
        r, jahr, periode: p, monat, betrag_cent: betragFuer(r.amounts, jahr), zahlung,
        status: zahlung ? 'erledigt' : ym < jetzt ? 'ueberfaellig' : ym === jetzt ? 'faellig' : 'offen',
      });
    }
  }
  return out.sort((a, b) => a.monat - b.monat || a.r.name.localeCompare(b.r.name));
}

export type Vorschlag = Transaction & { exakt: boolean };

/**
 * Passende Kontobewegungen zu einer Fälligkeit: gleicher Zahlungspartner (Zuordnung, IBAN oder Name),
 * richtige Richtung, rund um den Fälligkeitsmonat und noch keiner anderen Fälligkeit zugeordnet.
 */
export function vorschlaege(f: Pick<Faelligkeit, 'r' | 'jahr' | 'monat' | 'betrag_cent'>): Vorschlag[] {
  const { r } = f;
  const partner = r.partner_id ? get<Partner>('SELECT * FROM partners WHERE id = ?', [r.partner_id]) : undefined;
  const due = fromISO(`${f.jahr}-${String(f.monat).padStart(2, '0')}-15`);
  const von = new Date(due); von.setMonth(von.getMonth() - 4);
  const bis = new Date(due); bis.setMonth(bis.getMonth() + 7);
  const txs = all<Transaction & { pids: string | null; cids: string | null }>(
    `SELECT t.*, GROUP_CONCAT(a.partner_id) AS pids, GROUP_CONCAT(a.category_id) AS cids
     FROM transactions t LEFT JOIN allocations a ON a.transaction_id = t.id
     WHERE t.buchungsdatum BETWEEN ? AND ? AND ${r.richtung === 'ein' ? 't.betrag_cent > 0' : 't.betrag_cent < 0'}
       AND NOT EXISTS (SELECT 1 FROM recurring_payments z WHERE z.transaction_id = t.id)
     GROUP BY t.id`,
    [toISO(von), toISO(bis)],
  );
  const name = normalizeText(partner?.name);
  const iban = normalizeIBAN(partner?.iban);
  const passt = (t: (typeof txs)[number]) => {
    const pids = (t.pids ?? '').split(',').map(Number);
    if (partner) {
      if (pids.includes(partner.id)) return true;
      if (iban && normalizeIBAN(t.gegen_iban) === iban) return true;
      const g = normalizeText(t.gegen_name);
      return !!name && !!g && (g.includes(name) || name.includes(g));
    }
    // Ohne Partner: gleiche Kategorie und genau der Betrag
    return !!r.category_id && (t.cids ?? '').split(',').map(Number).includes(r.category_id) && Math.abs(t.betrag_cent) === f.betrag_cent;
  };
  return txs
    .filter(passt)
    .map((t) => ({ ...t, exakt: f.betrag_cent != null && Math.abs(t.betrag_cent) === f.betrag_cent }))
    .sort((a, b) => Number(b.exakt) - Number(a.exakt)
      || Math.abs(fromISO(a.buchungsdatum).getTime() - due.getTime()) - Math.abs(fromISO(b.buchungsdatum).getTime() - due.getTime()));
}

/** Fälligkeit abhaken – optional mit Buchung; eine noch nicht zugeordnete Buchung bekommt Kategorie und Partner. */
export function abhaken(input: {
  recurring_id: number; jahr: number; periode: number; bezahlt_am: string | null; betrag_cent: number | null;
  transaction_id: number | null; notiz?: string | null; zuordnen?: boolean;
}): number {
  return tx(() => {
    const r = get<Recurring>('SELECT * FROM recurring WHERE id = ?', [input.recurring_id]);
    if (!r) throw new Error('Wiederkehrende Zahlung nicht gefunden');
    if (input.transaction_id && input.zuordnen) {
      const t = get<Transaction>('SELECT * FROM transactions WHERE id = ?', [input.transaction_id]);
      const hatZuordnung = get('SELECT 1 FROM allocations WHERE transaction_id = ?', [input.transaction_id]);
      if (t && !hatZuordnung && (r.category_id || r.partner_id)) {
        setAllocations(t.id, [{ category_id: r.category_id, member_id: null, partner_id: r.partner_id, betrag_cent: t.betrag_cent, beitragsjahr: null, notiz: r.name }]);
      }
    }
    run('DELETE FROM recurring_payments WHERE recurring_id = ? AND jahr = ? AND periode = ?', [input.recurring_id, input.jahr, input.periode]);
    return run(
      `INSERT INTO recurring_payments(recurring_id, jahr, periode, bezahlt_am, betrag_cent, transaction_id, notiz) VALUES (?,?,?,?,?,?,?)`,
      [input.recurring_id, input.jahr, input.periode, input.bezahlt_am, input.betrag_cent, input.transaction_id, input.notiz?.trim() || null],
    );
  });
}

export function abhakenRueckgaengig(paymentId: number) {
  run('DELETE FROM recurring_payments WHERE id = ?', [paymentId]);
}

export function belegZuZahlung(paymentId: number, documentId: number) {
  run('UPDATE recurring_payments SET document_id = ? WHERE id = ?', [documentId, paymentId]);
}
