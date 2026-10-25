// Ersteinrichtung aus dem Kontoauszug: Mitglieder, Lieferanten und Regeln direkt aus Kontobewegungen anlegen.

import { all, get, getSetting, run, scalar, tx } from '../db/db';
import type { FeeRate, Member, Partner, Transaction, Zahlweise } from '../db/schema';
import { autoAssign } from './bank';
import { rateFor } from './fees';
import { normalizeIBAN, normalizeText, yearOf } from './format';
import { feeGroups } from './lookups';

export function nextMemberNo(): string {
  const max = scalar<number>("SELECT MAX(CAST(mitgliedsnr AS INTEGER)) FROM members WHERE mitgliedsnr GLOB '[0-9]*'") ?? 0;
  return String(max ? max + 1 : 1001);
}

/** Mitgliedsnummer aus dem Verwendungszweck ("Mitgl.-Nr. 1002", "MNr 42"), sofern noch nicht vergeben. */
export function memberNoFromText(zweck: string | null | undefined): string | null {
  const m = (zweck ?? '').match(/(?:mitglieds?(?:nummer|nr)?|mitgl|mnr)\.?[\s.-]*(?:nr\.?)?\s*:?\s*(\d{1,6})\b/i);
  if (!m) return null;
  return scalar('SELECT 1 FROM members WHERE mitgliedsnr = ?', [m[1]]) ? null : m[1];
}

/** "Petra Müller" → Petra / Müller, "Müller, Petra" → Petra / Müller, "Dr. Petra von Müller" → Petra / von Müller */
export function splitName(full: string | null | undefined): { vorname: string; nachname: string } {
  const s = (full ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return { vorname: '', nachname: '' };
  if (s.includes(',')) {
    const [n, v] = s.split(',', 2).map((x) => x.trim());
    return { vorname: v ?? '', nachname: n };
  }
  const parts = s.split(' ').filter((p) => !/^(herr|frau|dr\.?|prof\.?)$/i.test(p));
  if (parts.length === 1) return { vorname: '', nachname: parts[0] };
  // Namenszusätze gehören zum Nachnamen
  let i = parts.length - 1;
  while (i > 1 && /^(von|van|de|der|den|zu|vom|zum|di|da|le)$/i.test(parts[i - 1])) i--;
  return { vorname: parts.slice(0, i).join(' '), nachname: parts.slice(i).join(' ') };
}

/**
 * Name des Mitglieds aus einer Zahlung: Steht im Verwendungszweck ein anderer Vorname mit dem Nachnamen
 * des Zahlers ("Mitgliedsbeitrag Jonas Müller", Zahler Petra Müller), ist meist das Kind gemeint.
 */
export function guessMemberName(t: Pick<Transaction, 'gegen_name' | 'verwendungszweck'>): { vorname: string; nachname: string; ausZweck: boolean } {
  const payer = splitName(t.gegen_name);
  const zweck = t.verwendungszweck ?? '';
  if (payer.nachname && zweck) {
    const esc = payer.nachname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = zweck.match(new RegExp(`([A-ZÄÖÜ][a-zäöüß]+(?:[- ][A-ZÄÖÜ][a-zäöüß]+)?)\\s+${esc}(?![a-zäöüß])`));
    // Füllwörter vor dem Namen ("Beitrag Petra Müller") entfernen
    const vorname = (m?.[1] ?? '').split(' ').filter((w) => !/^(beitrag|mitgliedsbeitrag|jahresbeitrag|familie|fam|herr|frau|für|fuer)$/i.test(w)).join(' ');
    if (vorname && vorname !== payer.vorname) return { vorname, nachname: payer.nachname, ausZweck: true };
  }
  return { ...payer, ausZweck: false };
}

const ZAHLWEISE_MONATE: [number, Zahlweise][] = [[12, 'jaehrlich'], [6, 'halbjaehrlich'], [3, 'quartal'], [1, 'monatlich']];

/** Errät Beitragsgruppe und Zahlweise aus einem Zahlungsbetrag (z. B. 300 € = 12 × 25 € Erwachsene). */
export function guessFeeGroup(amountCent: number, year: number): { fee_group_id: number; zahlweise: Zahlweise } | null {
  if (amountCent <= 0) return null;
  const rates = all<FeeRate>('SELECT * FROM fee_rates');
  const groups = feeGroups();
  for (const [k, zahlweise] of ZAHLWEISE_MONATE) {
    for (const g of groups) {
      const r = rateFor(rates, g.id, year).cent;
      if (r > 0 && r * k === amountCent) return { fee_group_id: g.id, zahlweise };
    }
  }
  return null;
}

export type QuickMember = {
  mitgliedsnr?: string | null;
  vorname: string;
  nachname: string;
  eintritt: string;
  fee_group_id: number | null;
  zahlweise: Zahlweise;
  iban: string | null;
  kontoinhaber: string | null;
};

export function createMember(m: QuickMember): number {
  return run(
    `INSERT INTO members(mitgliedsnr, vorname, nachname, eintritt, fee_group_id, zahlweise, iban, kontoinhaber)
     VALUES (?,?,?,?,?,?,?,?)`,
    [m.mitgliedsnr?.trim() || nextMemberNo(), m.vorname.trim(), m.nachname.trim(), m.eintritt, m.fee_group_id, m.zahlweise, normalizeIBAN(m.iban) || null, m.kontoinhaber?.trim() || null],
  );
}

export type QuickPartner = { name: string; typ: string; iban: string | null; default_category_id: number | null };

export function createPartner(p: QuickPartner): number {
  return run('INSERT INTO partners(name, typ, iban, default_category_id) VALUES (?,?,?,?)', [
    p.name.trim(), p.typ, normalizeIBAN(p.iban) || null, p.default_category_id,
  ]);
}

/** Vorschlag für das Eintrittsdatum: 1.1. des Buchungsjahres bzw. Beginn der Beitragskonten. */
export function suggestEntry(t: Pick<Transaction, 'buchungsdatum'>): string {
  const start = Number(getSetting('beitragskonto_ab', '0')) || 0;
  const y = yearOf(t.buchungsdatum);
  return `${start && start < y ? start : y}-01-01`;
}

// ---------- Gruppierung offener Buchungen nach Zahlungspartner ----------

export type PayerGroup = {
  key: string;
  name: string;
  iban: string | null;
  ids: number[];
  first: Transaction;
  anzahl: number;
  summe: number;
  ein: number;
  aus: number;
  betraege: { betrag: number; n: number }[];
  von: string;
  bis: string;
  beispiele: string[];
};

export function groupKey(t: Pick<Transaction, 'gegen_iban' | 'gegen_name' | 'buchungstext'>): string {
  const iban = normalizeIBAN(t.gegen_iban);
  if (iban) return `iban:${iban}`;
  const name = normalizeText(t.gegen_name);
  if (name) return `name:${name}`;
  return `text:${normalizeText(t.buchungstext) || 'ohne'}`;
}

export function openGroups(): PayerGroup[] {
  const open = all<Transaction>(
    `SELECT t.* FROM transactions t WHERE NOT EXISTS (SELECT 1 FROM allocations a WHERE a.transaction_id = t.id)
     ORDER BY t.buchungsdatum`,
  );
  const map = new Map<string, PayerGroup>();
  for (const t of open) {
    const k = groupKey(t);
    let g = map.get(k);
    if (!g) {
      g = {
        key: k, name: t.gegen_name || t.buchungstext || '(ohne Namen)', iban: normalizeIBAN(t.gegen_iban) || null,
        ids: [], first: t, anzahl: 0, summe: 0, ein: 0, aus: 0, betraege: [], von: t.buchungsdatum, bis: t.buchungsdatum, beispiele: [],
      };
      map.set(k, g);
    }
    g.ids.push(t.id);
    g.anzahl++;
    g.summe += t.betrag_cent;
    if (t.betrag_cent >= 0) g.ein++;
    else g.aus++;
    g.bis = t.buchungsdatum;
    const b = g.betraege.find((x) => x.betrag === t.betrag_cent);
    if (b) b.n++;
    else g.betraege.push({ betrag: t.betrag_cent, n: 1 });
    if (t.verwendungszweck && g.beispiele.length < 3 && !g.beispiele.includes(t.verwendungszweck)) g.beispiele.push(t.verwendungszweck);
  }
  const groups = [...map.values()];
  groups.forEach((g) => g.betraege.sort((a, b) => b.n - a.n));
  return groups.sort((a, b) => b.anzahl - a.anzahl || Math.abs(b.summe) - Math.abs(a.summe));
}

/** Kategorie-Regel für eine Gruppe (IBAN, sonst Name bzw. Buchungstext) anlegen und anwenden. */
export function ruleForGroup(g: PayerGroup, categoryId: number, partnerId: number | null = null, memberId: number | null = null) {
  const richtung = g.ein && !g.aus ? 'ein' : g.aus && !g.ein ? 'aus' : 'beide';
  const text = g.iban ? null : g.first.gegen_name || g.first.buchungstext || null;
  run('INSERT INTO rules(name, prioritaet, iban, text_enthaelt, richtung, category_id, partner_id, member_id) VALUES (?,?,?,?,?,?,?,?)', [
    g.name, 100, g.iban, text, richtung, categoryId, partnerId, memberId,
  ]);
}

/** Bestehendes Mitglied mit einem Zahlungspartner verknüpfen: IBAN übernehmen oder (z. B. Eltern, zweites Konto) Regel anlegen. */
export function linkMember(memberId: number, g: PayerGroup) {
  const m = get<Member>('SELECT * FROM members WHERE id = ?', [memberId]);
  if (!m) return;
  if (g.iban && !m.iban) {
    run("UPDATE members SET iban = ?, kontoinhaber = COALESCE(kontoinhaber, ?), updated_at = datetime('now') WHERE id = ?", [g.iban, g.first.gegen_name, memberId]);
  } else if (!g.iban && !m.kontoinhaber && g.first.gegen_name) {
    run("UPDATE members SET kontoinhaber = ?, updated_at = datetime('now') WHERE id = ?", [g.first.gegen_name, memberId]);
  } else {
    const cat = Number(getSetting('beitrag_category_id')) || null;
    if (cat) ruleForGroup(g, cat, null, memberId);
  }
}

/** Bestehenden Lieferanten verknüpfen: IBAN übernehmen oder Regel anlegen. */
export function linkPartner(partnerId: number, g: PayerGroup, categoryId: number | null) {
  const p = get<Partner>('SELECT * FROM partners WHERE id = ?', [partnerId]);
  if (!p) return;
  const cat = categoryId ?? p.default_category_id;
  if (cat && cat !== p.default_category_id && !p.default_category_id) run('UPDATE partners SET default_category_id = ? WHERE id = ?', [cat, partnerId]);
  if (g.iban && !p.iban) run('UPDATE partners SET iban = ? WHERE id = ?', [g.iban, partnerId]);
  else if (cat) ruleForGroup(g, cat, partnerId);
}

/** Führt eine Einrichtungsaktion aus und ordnet danach alle passenden offenen Buchungen zu. */
export function applyAndAssign(fn: () => void, ids?: number[], exclude: number[] = []): number {
  let n = 0;
  tx(() => {
    fn();
    n = autoAssign(ids, exclude).zugeordnet;
  });
  return n;
}
