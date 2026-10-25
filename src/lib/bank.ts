// Kontobewegungen speichern, Kontostände berechnen und Buchungen automatisch zuordnen.

import { all, get, getSetting, run, scalar, tx } from '../db/db';
import type { Account, Allocation, Category, FeeRate, Member, Partner, Rule, Transaction } from '../db/schema';
import { fingerprints, type CsvConfig, type ParsedTx } from './csv';
import { normalizeIBAN, normalizeText, yearOf } from './format';
import { isActive, rateFor } from './fees';

// ---------- Import ----------

export function findOrCreateAccount(iban: string | null, fallbackName: string, firstDate: string): number {
  const n = normalizeIBAN(iban);
  if (n) {
    const id = scalar<number>('SELECT id FROM accounts WHERE iban = ?', [n]);
    if (id) return id;
  }
  return run('INSERT INTO accounts(name, iban, anfangsdatum, anfangssaldo_cent) VALUES (?,?,?,0)', [fallbackName, n || null, firstDate]);
}

export type ImportResult = { importId: number; neu: number; duplikate: number; newIds: number[] };

export function importTransactions(
  accountId: number,
  txs: ParsedTx[],
  meta: { dateiname: string; profil: string },
): ImportResult {
  return tx(() => {
    const importId = run('INSERT INTO imports(account_id, dateiname, profil) VALUES (?,?,?)', [accountId, meta.dateiname, meta.profil]);
    const hashes = fingerprints(accountId, txs);
    const newIds: number[] = [];
    let duplikate = 0;
    txs.forEach((t, i) => {
      if (scalar('SELECT 1 FROM transactions WHERE hash = ?', [hashes[i]])) {
        duplikate++;
        return;
      }
      newIds.push(
        run(
          `INSERT INTO transactions(account_id, buchungsdatum, valutadatum, betrag_cent, waehrung, gegen_name, gegen_iban,
             gegen_bic, verwendungszweck, buchungstext, mandatsreferenz, glaeubiger_id, e2e_ref, saldo_cent, import_id, hash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            accountId, t.buchungsdatum, t.valutadatum, t.betrag_cent, t.waehrung, t.gegen_name, t.gegen_iban, t.gegen_bic,
            t.verwendungszweck, t.buchungstext, t.mandatsreferenz, t.glaeubiger_id, t.e2e_ref, t.saldo_cent, importId, hashes[i],
          ],
        ),
      );
    });
    run('UPDATE imports SET anzahl_neu = ?, anzahl_dupl = ? WHERE id = ?', [newIds.length, duplikate, importId]);
    // Liegt das Anfangsdatum des Kontos nach der ersten importierten Buchung, wird es vorverlegt.
    const acc = get<Account>('SELECT * FROM accounts WHERE id = ?', [accountId]);
    const first = scalar<string>('SELECT MIN(buchungsdatum) FROM transactions WHERE account_id = ?', [accountId]);
    if (acc && first && first < acc.anfangsdatum && !scalar('SELECT 1 FROM transactions WHERE account_id = ? AND buchungsdatum < ? AND import_id != ?', [accountId, acc.anfangsdatum, importId])) {
      run('UPDATE accounts SET anfangsdatum = ? WHERE id = ?', [first, accountId]);
    }
    return { importId, neu: newIds.length, duplikate, newIds };
  });
}

export function saveProfile(name: string, signature: string, config: CsvConfig) {
  run(
    `INSERT INTO import_profiles(name, signatur, config_json) VALUES (?,?,?)
     ON CONFLICT(signatur) DO UPDATE SET name = excluded.name, config_json = excluded.config_json`,
    [name, signature, JSON.stringify(config)],
  );
}

export function loadProfile(signature: string): { name: string; config: CsvConfig } | null {
  const row = get<{ name: string; config_json: string }>('SELECT name, config_json FROM import_profiles WHERE signatur = ?', [signature]);
  if (!row) return null;
  try {
    return { name: row.name, config: JSON.parse(row.config_json) };
  } catch {
    return null;
  }
}

/**
 * Kontostand nach der letzten Buchung, wenn die Bank einen Saldo je Buchung liefert.
 * Bei mehreren Buchungen am letzten Tag wird die Kette (Saldo − Betrag = Saldo der vorherigen) ausgewertet,
 * damit die Sortierung der Datei keine Rolle spielt.
 */
export function endBalanceFromRows(txs: ParsedTx[]): { datum: string; saldo_cent: number } | null {
  const withSaldo = txs.filter((t) => t.saldo_cent != null);
  if (!withSaldo.length) return null;
  const last = withSaldo.reduce((m, t) => (t.buchungsdatum > m ? t.buchungsdatum : m), withSaldo[0].buchungsdatum);
  const day = withSaldo.filter((t) => t.buchungsdatum === last);
  const predecessors = new Set(day.map((t) => t.saldo_cent! - t.betrag_cent));
  // Endstand = der Saldo, der nicht Vorgänger einer anderen Buchung desselben Tages ist
  const end = day.find((t) => !predecessors.has(t.saldo_cent!)) ?? day[0];
  return { datum: last, saldo_cent: end.saldo_cent! };
}

/** Wurde für das Konto schon ein echter Kontostand hinterlegt (Anfangssaldo oder Kontrollwert)? */
export function isCalibrated(account: Account): boolean {
  return account.anfangssaldo_cent !== 0 || !!scalar('SELECT 1 FROM balance_checkpoints WHERE account_id = ?', [account.id]);
}

/** Speichert einen Kontostand laut Bank als Kontrollwert (Ende des Tages). */
export function saveCheckpoint(accountId: number, datum: string, saldo: number, notiz: string | null) {
  run(
    `INSERT INTO balance_checkpoints(account_id, datum, saldo_cent, notiz) VALUES (?,?,?,?)
     ON CONFLICT(account_id, datum) DO UPDATE SET saldo_cent = excluded.saldo_cent, notiz = COALESCE(excluded.notiz, balance_checkpoints.notiz)`,
    [accountId, datum, saldo, notiz],
  );
}

/**
 * Rechnet den Anfangssaldo aus einem bekannten Kontostand zurück:
 * Anfangssaldo = Kontostand am Stichtag − Summe aller Buchungen vom Anfangsdatum bis zum Stichtag.
 * Danach stimmt der berechnete Kontostand an jedem Tag mit der Bank überein (sofern alle Umsätze importiert sind).
 */
export function calibrateOpening(accountId: number, datum: string, saldo: number, notiz: string | null = null): number {
  const acc = get<Account>('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (!acc) throw new Error('Konto nicht gefunden');
  const first = scalar<string>('SELECT MIN(buchungsdatum) FROM transactions WHERE account_id = ?', [accountId]);
  // Anfangsdatum nie nach der ersten Buchung
  const anfangsdatum = first && first < acc.anfangsdatum ? first : acc.anfangsdatum;
  const sum = scalar<number>(
    'SELECT COALESCE(SUM(betrag_cent),0) FROM transactions WHERE account_id = ? AND buchungsdatum >= ? AND buchungsdatum <= ?',
    [accountId, anfangsdatum, datum],
  ) ?? 0;
  const opening = saldo - sum;
  tx(() => {
    run('UPDATE accounts SET anfangssaldo_cent = ?, anfangsdatum = ? WHERE id = ?', [opening, anfangsdatum, accountId]);
    saveCheckpoint(accountId, datum, saldo, notiz);
  });
  return opening;
}

/** Letzter in einer Importdatei gelieferter Saldo eines Kontos (aus den gespeicherten Buchungen). */
export function storedEndBalance(accountId: number): { datum: string; saldo_cent: number } | null {
  const rows = all<Transaction>('SELECT * FROM transactions WHERE account_id = ? AND saldo_cent IS NOT NULL', [accountId]);
  return endBalanceFromRows(rows.map((t) => ({ ...t, row: 0, auftragskonto: null, pending: false }) as ParsedTx));
}

// ---------- Kontostände ----------

/** Kontostand am Ende des Tages `dateISO` (inklusive aller Buchungen dieses Tages). */
export function balanceAt(account: Account, dateISO: string): number | null {
  if (dateISO < account.anfangsdatum) return null;
  const sum = scalar<number>(
    'SELECT COALESCE(SUM(betrag_cent),0) FROM transactions WHERE account_id = ? AND buchungsdatum >= ? AND buchungsdatum <= ?',
    [account.id, account.anfangsdatum, dateISO],
  ) ?? 0;
  return account.anfangssaldo_cent + sum;
}

/** Kontostand zu Beginn des Tages (= Ende des Vortages). */
export function balanceAtStartOf(account: Account, dateISO: string): number | null {
  if (dateISO < account.anfangsdatum) return null;
  const sum = scalar<number>(
    'SELECT COALESCE(SUM(betrag_cent),0) FROM transactions WHERE account_id = ? AND buchungsdatum >= ? AND buchungsdatum < ?',
    [account.id, account.anfangsdatum, dateISO],
  ) ?? 0;
  return account.anfangssaldo_cent + sum;
}

// ---------- Zuordnungen ----------

export type AllocationInput = {
  category_id: number | null;
  member_id: number | null;
  partner_id: number | null;
  betrag_cent: number;
  beitragsjahr: number | null;
  notiz?: string | null;
  auto?: string | null;
};

export function setAllocations(transactionId: number, allocs: AllocationInput[]) {
  tx(() => {
    run('DELETE FROM allocations WHERE transaction_id = ?', [transactionId]);
    for (const a of allocs) {
      run(
        `INSERT INTO allocations(transaction_id, category_id, member_id, partner_id, betrag_cent, beitragsjahr, notiz, auto)
         VALUES (?,?,?,?,?,?,?,?)`,
        [transactionId, a.category_id, a.member_id, a.partner_id, a.betrag_cent, a.beitragsjahr, a.notiz ?? null, a.auto ?? null],
      );
    }
  });
}

export type TxStatus = 'offen' | 'teilweise' | 'auto' | 'zugeordnet' | 'geprueft';

export function txStatus(t: Pick<Transaction, 'betrag_cent' | 'geprueft'>, allocs: Pick<Allocation, 'betrag_cent' | 'category_id' | 'auto'>[]): TxStatus {
  if (!allocs.length) return 'offen';
  const sum = allocs.reduce((s, a) => s + a.betrag_cent, 0);
  if (sum !== t.betrag_cent || allocs.some((a) => a.category_id == null)) return 'teilweise';
  if (t.geprueft) return 'geprueft';
  if (allocs.some((a) => a.auto)) return 'auto';
  return 'zugeordnet';
}

// ---------- Automatische Zuordnung ----------

type MatchCtx = {
  rules: Rule[];
  members: Member[];
  partners: Partner[];
  categories: Map<number, Category>;
  rates: FeeRate[];
  beitragCat: number | null;
};

function loadMatchCtx(): MatchCtx {
  const cats = all<Category>('SELECT * FROM categories');
  return {
    rules: all<Rule>('SELECT * FROM rules WHERE aktiv = 1 ORDER BY prioritaet, id'),
    members: all<Member>('SELECT * FROM members'),
    partners: all<Partner>('SELECT * FROM partners'),
    categories: new Map(cats.map((c) => [c.id, c])),
    rates: all<FeeRate>('SELECT * FROM fee_rates'),
    beitragCat: Number(getSetting('beitrag_category_id')) || null,
  };
}

function txText(t: Transaction): string {
  return normalizeText([t.gegen_name, t.verwendungszweck, t.buchungstext].filter(Boolean).join(' '));
}

export function ruleMatches(rule: Rule, t: Transaction): boolean {
  if (rule.richtung === 'ein' && t.betrag_cent < 0) return false;
  if (rule.richtung === 'aus' && t.betrag_cent > 0) return false;
  const abs = Math.abs(t.betrag_cent);
  if (rule.betrag_min_cent != null && abs < rule.betrag_min_cent) return false;
  if (rule.betrag_max_cent != null && abs > rule.betrag_max_cent) return false;
  let hasCondition = false;
  if (rule.iban) {
    hasCondition = true;
    if (normalizeIBAN(rule.iban) !== normalizeIBAN(t.gegen_iban)) return false;
  }
  if (rule.text_enthaelt?.trim()) {
    hasCondition = true;
    const text = ` ${txText(t)} `;
    const alts = rule.text_enthaelt.split('|').map((a) => normalizeText(a)).filter(Boolean);
    if (!alts.some((a) => text.includes(a))) return false;
  }
  return hasCondition;
}

/** Beitragsjahr aus dem Verwendungszweck ("Beitrag 2027"), sonst Jahr der Buchung. */
export function guessFeeYear(t: Transaction): number {
  const y = yearOf(t.buchungsdatum);
  const found = (t.verwendungszweck ?? '').match(/\b(20\d{2})\b/g)?.map(Number).filter((v) => v >= y - 2 && v <= y + 1);
  return found?.length === 1 ? found[0] : y;
}

function splitAmong(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((s, w) => s + w, 0);
  const w = sumW > 0 ? weights : weights.map(() => 1);
  const sw = w.reduce((s, x) => s + x, 0);
  const parts = w.map((x) => Math.trunc((total * x) / sw));
  parts[0] += total - parts.reduce((s, p) => s + p, 0);
  return parts;
}

function memberAlloc(t: Transaction, ms: Member[], ctx: MatchCtx, how: string): AllocationInput[] {
  const jahr = guessFeeYear(t);
  // Mehrere Mitglieder mit derselben IBAN (Familie): Betrag nach Monatsbeitrag aufteilen
  const weights = ms.map((m) => m.beitrag_individuell_cent ?? rateFor(ctx.rates, m.fee_group_id, jahr).cent);
  const parts = splitAmong(t.betrag_cent, weights);
  return ms.map((m, i) => ({
    category_id: ctx.beitragCat,
    member_id: m.id,
    partner_id: null,
    betrag_cent: parts[i],
    beitragsjahr: jahr,
    auto: how,
  }));
}

function preferActive(ms: Member[], at: string): Member[] {
  const active = ms.filter((m) => isActive(m, at));
  return active.length ? active : ms;
}

export function suggest(t: Transaction, ctx: MatchCtx): AllocationInput[] | null {
  const fromRule = (r: Rule): AllocationInput[] => {
    const cat = r.category_id ? ctx.categories.get(r.category_id) : undefined;
    return [{
      category_id: r.category_id,
      member_id: r.member_id,
      partner_id: r.partner_id,
      betrag_cent: t.betrag_cent,
      beitragsjahr: r.member_id && cat?.mitgliedskonto ? guessFeeYear(t) : null,
      auto: `Regel „${r.name}"`,
    }];
  };
  // 1. Regeln mit hoher Priorität (< 500)
  for (const r of ctx.rules) if (r.prioritaet < 500 && ruleMatches(r, t)) return fromRule(r);

  const iban = normalizeIBAN(t.gegen_iban);
  // 2. IBAN eines Mitglieds
  if (iban) {
    const ms = ctx.members.filter((m) => normalizeIBAN(m.iban) === iban);
    if (ms.length) return memberAlloc(t, preferActive(ms, t.buchungsdatum), ctx, 'IBAN Mitglied');
  }
  // 3. IBAN eines Partners/Lieferanten
  if (iban) {
    const p = ctx.partners.find((x) => normalizeIBAN(x.iban) === iban);
    if (p) return [{ category_id: p.default_category_id, member_id: null, partner_id: p.id, betrag_cent: t.betrag_cent, beitragsjahr: null, auto: 'IBAN Partner' }];
  }
  const zweck = ` ${normalizeText(t.verwendungszweck)} `;
  const name = normalizeText(t.gegen_name);
  // 4. Mitgliedsnummer im Verwendungszweck ("Mitgl.-Nr. 42", "MNr 42")
  for (const m of ctx.members) {
    const nr = normalizeText(m.mitgliedsnr);
    if (nr && new RegExp(`\\b(mitglied\\w*|mitgl|mnr|mitgliedsnr|nr) ?(nr )?${nr}\\b`).test(zweck)) {
      return memberAlloc(t, [m], ctx, 'Mitgliedsnummer');
    }
  }
  // 5. Name des Mitglieds im Verwendungszweck oder als Kontoinhaber
  if (t.betrag_cent > 0) {
    const text = ` ${name} ${zweck} `;
    const byFull = ctx.members.filter((m) => {
      const v = normalizeText(m.vorname);
      const n = normalizeText(m.nachname);
      return v && n && (text.includes(` ${v} ${n} `) || text.includes(` ${n} ${v} `));
    });
    if (byFull.length) return memberAlloc(t, preferActive(byFull, t.buchungsdatum), ctx, 'Name Mitglied');
    const byOwner = ctx.members.filter((m) => m.kontoinhaber && normalizeText(m.kontoinhaber) === name);
    if (byOwner.length) return memberAlloc(t, preferActive(byOwner, t.buchungsdatum), ctx, 'Kontoinhaber');
  }
  // 6. Name des Partners
  if (name) {
    const p = ctx.partners.find((x) => {
      const pn = normalizeText(x.name);
      return pn.length >= 4 && ` ${name} `.includes(` ${pn}`);
    });
    if (p) return [{ category_id: p.default_category_id, member_id: null, partner_id: p.id, betrag_cent: t.betrag_cent, beitragsjahr: null, auto: 'Name Partner' }];
  }
  // 7. Allgemeine Regeln (Priorität ≥ 500, z. B. Kontoführung, Zinsen)
  for (const r of ctx.rules) if (r.prioritaet >= 500 && ruleMatches(r, t)) return fromRule(r);
  return null;
}

/** Ordnet alle (oder die angegebenen) noch nicht zugeordneten Buchungen automatisch zu. */
export function autoAssign(ids?: number[], exclude: number[] = []): { geprueft: number; zugeordnet: number } {
  const ctx = loadMatchCtx();
  let where = ids ? `AND t.id IN (${ids.map(Number).join(',') || '0'})` : '';
  if (exclude.length) where += ` AND t.id NOT IN (${exclude.map(Number).join(',')})`;
  const open = all<Transaction>(
    `SELECT t.* FROM transactions t WHERE NOT EXISTS (SELECT 1 FROM allocations a WHERE a.transaction_id = t.id) ${where}`,
  );
  let zugeordnet = 0;
  tx(() => {
    for (const t of open) {
      const s = suggest(t, ctx);
      if (!s) continue;
      setAllocations(t.id, s);
      const ruleName = s[0].auto?.match(/^Regel „(.*)"$/)?.[1];
      if (ruleName) run('UPDATE rules SET treffer = treffer + 1 WHERE name = ?', [ruleName]);
      zugeordnet++;
    }
  });
  return { geprueft: open.length, zugeordnet };
}

/** Legt aus einer manuellen Zuordnung eine Regel an (IBAN → Kategorie/Partner). */
export function createRuleFromTransaction(t: Transaction, a: { category_id: number | null; partner_id: number | null }) {
  const iban = normalizeIBAN(t.gegen_iban);
  if (!iban) return null;
  const exists = scalar('SELECT id FROM rules WHERE iban = ?', [iban]);
  if (exists) {
    run('UPDATE rules SET category_id = ?, partner_id = ? WHERE id = ?', [a.category_id, a.partner_id, exists as number]);
    return exists as number;
  }
  return run('INSERT INTO rules(name, prioritaet, iban, richtung, category_id, partner_id) VALUES (?,?,?,?,?,?)', [
    t.gegen_name || iban, 100, iban, 'beide', a.category_id, a.partner_id,
  ]);
}
