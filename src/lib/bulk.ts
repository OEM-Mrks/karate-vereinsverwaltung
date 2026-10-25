// Sammelbearbeitung von Buchungen und Nachtragen von Lieferanten in bestehenden Zuordnungen.

import { all, get, run, tx } from '../db/db';
import type { Allocation, Partner, Transaction } from '../db/schema';
import { groupKey } from './setup';
import { normalizeText } from './format';

export type BulkResult = { geaendert: number; uebersprungen: number };

function allocsOf(id: number): Allocation[] {
  return all<Allocation>('SELECT * FROM allocations WHERE transaction_id = ?', [id]);
}

/**
 * Setzt den Lieferanten/Partner auf allen Zuordnungen der Buchungen (außer Mitgliedszeilen).
 * Buchungen ohne Zuordnung bekommen eine mit der Standardkategorie des Partners.
 */
export function bulkSetPartner(ids: number[], partnerId: number): BulkResult {
  const p = get<Partner>('SELECT * FROM partners WHERE id = ?', [partnerId]);
  if (!p) throw new Error('Partner nicht gefunden');
  let geaendert = 0;
  let uebersprungen = 0;
  tx(() => {
    for (const id of ids) {
      const a = allocsOf(id);
      if (!a.length) {
        const t = get<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]);
        if (!t) continue;
        run('INSERT INTO allocations(transaction_id, category_id, partner_id, betrag_cent) VALUES (?,?,?,?)', [id, p.default_category_id, partnerId, t.betrag_cent]);
        geaendert++;
      } else if (a.every((x) => x.member_id)) {
        uebersprungen++;
      } else {
        run('UPDATE allocations SET partner_id = ? WHERE transaction_id = ? AND member_id IS NULL', [partnerId, id]);
        geaendert++;
      }
    }
  });
  return { geaendert, uebersprungen };
}

/** Setzt die Kategorie bei Buchungen mit höchstens einer Zuordnung; Splitbuchungen werden übersprungen. */
export function bulkSetCategory(ids: number[], categoryId: number): BulkResult {
  let geaendert = 0;
  let uebersprungen = 0;
  tx(() => {
    for (const id of ids) {
      const a = allocsOf(id);
      if (a.length > 1) {
        uebersprungen++;
        continue;
      }
      if (a.length === 1) run('UPDATE allocations SET category_id = ?, auto = NULL WHERE id = ?', [categoryId, a[0].id]);
      else {
        const t = get<Transaction>('SELECT betrag_cent FROM transactions WHERE id = ?', [id]);
        if (!t) continue;
        run('INSERT INTO allocations(transaction_id, category_id, betrag_cent) VALUES (?,?,?)', [id, categoryId, t.betrag_cent]);
      }
      geaendert++;
    }
  });
  return { geaendert, uebersprungen };
}

export function bulkSetChecked(ids: number[], checked: boolean) {
  tx(() => ids.forEach((id) => run('UPDATE transactions SET geprueft = ? WHERE id = ?', [checked ? 1 : 0, id])));
}

export function bulkClear(ids: number[]) {
  tx(() => ids.forEach((id) => {
    run('DELETE FROM allocations WHERE transaction_id = ?', [id]);
    run('UPDATE transactions SET geprueft = 0 WHERE id = ?', [id]);
  }));
}

/** Weitere Buchungen desselben Zahlungspartners (gleiche IBAN bzw. gleicher Name), denen noch kein Lieferant zugeordnet ist. */
export function similarWithoutPartner(t: Transaction): number[] {
  const key = groupKey(t);
  const rows = all<Transaction & { mit_partner: number; mit_mitglied: number }>(
    `SELECT t.*, (SELECT COUNT(*) FROM allocations a WHERE a.transaction_id = t.id AND a.partner_id IS NOT NULL) AS mit_partner,
            (SELECT COUNT(*) FROM allocations a WHERE a.transaction_id = t.id AND a.member_id IS NOT NULL) AS mit_mitglied
     FROM transactions t WHERE t.id != ?`,
    [t.id],
  );
  return rows.filter((r) => !r.mit_partner && !r.mit_mitglied && groupKey(r) === key).map((r) => r.id);
}

/** Buchungen, die zu einem Partner passen (IBAN oder Name), aber noch keinen Lieferanten haben. */
export function partnerBackfillCandidates(partnerId: number): number[] {
  const p = get<Partner>('SELECT * FROM partners WHERE id = ?', [partnerId]);
  if (!p) return [];
  const pn = normalizeText(p.name);
  const rows = all<Transaction & { mit_partner: number; mit_mitglied: number }>(
    `SELECT t.*, (SELECT COUNT(*) FROM allocations a WHERE a.transaction_id = t.id AND a.partner_id IS NOT NULL) AS mit_partner,
            (SELECT COUNT(*) FROM allocations a WHERE a.transaction_id = t.id AND a.member_id IS NOT NULL) AS mit_mitglied
     FROM transactions t`,
  );
  return rows
    .filter((r) => !r.mit_partner && !r.mit_mitglied)
    .filter((r) => (p.iban && r.gegen_iban === p.iban) || (pn.length >= 4 && ` ${normalizeText(r.gegen_name)} `.includes(` ${pn}`)))
    .map((r) => r.id);
}
