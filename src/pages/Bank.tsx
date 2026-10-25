import { useState } from 'react';
import { all, get, run, scalar, tx } from '../db/db';
import type { Account, Allocation, BalanceCheckpoint, Category, Member, Partner, Transaction } from '../db/schema';
import { navigate, useLocalState, useQuery } from '../hooks';
import {
  autoAssign, balanceAt, createRuleFromTransaction, setAllocations, txStatus, type AllocationInput, type TxStatus,
} from '../lib/bank';
import { formatDate, formatEUR, formatIBAN, normalizeIBAN, todayISO, yearOf } from '../lib/format';
import { categories, categoryLabel, categoryOptions, memberName, memberOptions, partnerOptions } from '../lib/lookups';
import { TransactionDocs } from '../components/Docs';
import { QuickMemberDialog, QuickPartnerDialog } from '../components/QuickCreate';
import { SetupByPayer } from './Setup';
import {
  attempt, Badge, Checkbox, DateInput, Empty, Field, Modal, MoneyInput, PageHeader, Select, Stat, Tabs, TextArea, TextInput, toast, YearSelect,
} from '../components/ui';

type Tab = 'buchungen' | 'einrichtung' | 'konten' | 'importe';

export function BankPage({ txId }: { txId?: number }) {
  const [tab, setTab] = useLocalState<Tab>('bank.tab', 'buchungen');
  return (
    <div className="page">
      <PageHeader
        title="Konto"
        subtitle="Alle Einnahmen und Ausgaben laufen über das Vereinskonto – jede Buchung wird einer Kategorie zugeordnet."
        actions={<button className="primary" onClick={() => navigate('import')}>Kontoauszug (CSV) importieren</button>}
      />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'buchungen', label: 'Buchungen' }, { id: 'einrichtung', label: 'Offene nach Zahlungspartner' }, { id: 'konten', label: 'Konten & Kontostände' }, { id: 'importe', label: 'Importe' }]} />
      {tab === 'buchungen' && <TransactionList />}
      {tab === 'einrichtung' && <SetupByPayer />}
      {tab === 'konten' && <Accounts />}
      {tab === 'importe' && <Imports />}
      {txId != null && <AssignDialog key={txId} id={txId} onClose={() => navigate('konto')} />}
    </div>
  );
}

const STATUS: Record<TxStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' }> = {
  offen: { label: 'offen', tone: 'bad' },
  teilweise: { label: 'unvollständig', tone: 'warn' },
  auto: { label: 'automatisch', tone: 'info' },
  zugeordnet: { label: 'zugeordnet', tone: 'ok' },
  geprueft: { label: 'geprüft', tone: 'ok' },
};

type Row = Transaction & { allocs: (Allocation & { cat?: Category; mname?: string; pname?: string })[]; docs: number; status: TxStatus; belegFehlt: boolean };

function loadRows(year: number, accountId: number | null): Row[] {
  const txs = all<Transaction>(
    `SELECT * FROM transactions WHERE buchungsdatum BETWEEN ? AND ? ${accountId ? 'AND account_id = ' + Number(accountId) : ''}
     ORDER BY buchungsdatum DESC, id DESC`,
    [`${year}-01-01`, `${year}-12-31`],
  );
  const cats = new Map(categories().map((c) => [c.id, c]));
  const allocs = all<Allocation & { mname: string | null; pname: string | null }>(
    `SELECT a.*, m.nachname || ', ' || m.vorname AS mname, p.name AS pname FROM allocations a
     JOIN transactions t ON t.id = a.transaction_id
     LEFT JOIN members m ON m.id = a.member_id LEFT JOIN partners p ON p.id = a.partner_id
     WHERE t.buchungsdatum BETWEEN ? AND ?`,
    [`${year}-01-01`, `${year}-12-31`],
  );
  const byTx = new Map<number, Row['allocs']>();
  for (const a of allocs) {
    if (!byTx.has(a.transaction_id)) byTx.set(a.transaction_id, []);
    byTx.get(a.transaction_id)!.push({ ...a, cat: a.category_id ? cats.get(a.category_id) : undefined, mname: a.mname ?? undefined, pname: a.pname ?? undefined });
  }
  const docs = new Map(all<{ transaction_id: number; n: number }>('SELECT transaction_id, COUNT(*) AS n FROM documents WHERE transaction_id IS NOT NULL GROUP BY transaction_id').map((d) => [d.transaction_id, d.n]));
  return txs.map((t) => {
    const a = byTx.get(t.id) ?? [];
    const d = docs.get(t.id) ?? 0;
    return { ...t, allocs: a, docs: d, status: txStatus(t, a), belegFehlt: d === 0 && a.some((x) => x.cat?.beleg_pflicht) };
  });
}

type StatusFilter = 'alle' | 'offen' | 'auto' | 'erledigt' | 'beleg' | 'ein' | 'aus';

function TransactionList() {
  const [year, setYear] = useLocalState('year', new Date().getFullYear());
  const [accountId, setAccountId] = useLocalState<number | null>('bank.account', null);
  const [status, setStatus] = useLocalState<StatusFilter>('bank.status', 'alle');
  const [search, setSearch] = useState('');
  const [newTx, setNewTx] = useState(false);
  const accounts = useQuery(() => all<Account>('SELECT * FROM accounts ORDER BY id'));
  const rows = useQuery(() => loadRows(year, accountId), [year, accountId]);
  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (status === 'offen' && !(r.status === 'offen' || r.status === 'teilweise')) return false;
    if (status === 'auto' && r.status !== 'auto') return false;
    if (status === 'erledigt' && !(r.status === 'zugeordnet' || r.status === 'geprueft')) return false;
    if (status === 'beleg' && !r.belegFehlt) return false;
    if (status === 'ein' && r.betrag_cent < 0) return false;
    if (status === 'aus' && r.betrag_cent > 0) return false;
    if (!q) return true;
    return [r.gegen_name, r.verwendungszweck, r.buchungstext, r.gegen_iban, formatEUR(r.betrag_cent), ...r.allocs.map((a) => `${a.cat?.name} ${a.mname} ${a.pname}`)]
      .some((v) => v?.toLowerCase().includes(q));
  });
  const ein = visible.filter((r) => r.betrag_cent > 0).reduce((s, r) => s + r.betrag_cent, 0);
  const aus = visible.filter((r) => r.betrag_cent < 0).reduce((s, r) => s + r.betrag_cent, 0);
  const openCount = rows.filter((r) => r.status === 'offen' || r.status === 'teilweise').length;
  const autoCount = rows.filter((r) => r.status === 'auto').length;

  const runAuto = () => {
    const r = autoAssign();
    toast(r.zugeordnet ? `${r.zugeordnet} von ${r.geprueft} offenen Buchungen automatisch zugeordnet` : 'Keine weiteren Zuordnungen gefunden', r.zugeordnet ? 'ok' : 'info');
  };
  const confirmAuto = () => {
    if (!confirm(`${autoCount} automatisch zugeordnete Buchungen als geprüft markieren?`)) return;
    attempt(() => tx(() => rows.filter((r) => r.status === 'auto').forEach((r) => run('UPDATE transactions SET geprueft = 1 WHERE id = ?', [r.id]))), 'Als geprüft markiert');
  };

  return (
    <>
      <div className="stats">
        <Stat label="Einnahmen (Auswahl)" value={formatEUR(ein)} tone="ok" />
        <Stat label="Ausgaben (Auswahl)" value={formatEUR(-aus)} tone="bad" />
        <Stat label="Saldo (Auswahl)" value={formatEUR(ein + aus)} />
        <Stat label="Nicht zugeordnet" value={openCount} tone={openCount ? 'warn' : 'ok'} onClick={() => setStatus('offen')} sub={autoCount ? `${autoCount} automatisch, ungeprüft` : undefined} />
      </div>
      <div className="toolbar">
        <YearSelect value={year} onChange={setYear} />
        {accounts.length > 1 && <Select value={accountId} onChange={setAccountId} empty="Alle Konten" options={accounts.map((a) => ({ value: a.id, label: a.name }))} />}
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="alle">Alle Buchungen</option>
          <option value="offen">Nicht zugeordnet</option>
          <option value="auto">Automatisch zugeordnet (ungeprüft)</option>
          <option value="erledigt">Zugeordnet / geprüft</option>
          <option value="beleg">Beleg fehlt</option>
          <option value="ein">Nur Einnahmen</option>
          <option value="aus">Nur Ausgaben</option>
        </select>
        <input className="search" placeholder="Suchen …" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        <button onClick={() => setNewTx(true)} disabled={!accounts.length} title={!accounts.length ? 'Zuerst ein Konto anlegen oder importieren' : ''}>+ Manuell</button>
        {autoCount > 0 && <button onClick={confirmAuto}>Automatische bestätigen</button>}
        <button onClick={runAuto}>⚡ Automatisch zuordnen</button>
      </div>
      {rows.length === 0 ? (
        <Empty>
          Noch keine Buchungen für {year}. <a href="#/import">Kontoauszug als CSV importieren</a> – z. B. aus dem Online-Banking der Sparkasse unter „Umsätze → Export → CSV-CAMT".
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table clickable-rows tx-table">
            <thead>
              <tr><th>Datum</th><th>Zahlungspartner / Verwendungszweck</th><th>Zuordnung</th><th></th><th className="num">Betrag</th><th>Status</th></tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} onClick={() => navigate(`konto/${r.id}`)}>
                  <td className="nowrap">{formatDate(r.buchungsdatum)}</td>
                  <td>
                    <strong>{r.gegen_name || r.buchungstext || '–'}</strong>
                    <div className="muted small clamp">{r.verwendungszweck}</div>
                  </td>
                  <td className="small">
                    {r.allocs.map((a) => (
                      <div key={a.id}>
                        {a.cat ? categoryLabel(a.cat) : <em className="muted">ohne Kategorie</em>}
                        {(a.mname || a.pname) && <span className="muted"> · {a.mname ?? a.pname}</span>}
                        {r.allocs.length > 1 && <span className="muted"> ({formatEUR(a.betrag_cent)})</span>}
                      </div>
                    ))}
                  </td>
                  <td>{r.docs > 0 ? <span title={`${r.docs} Beleg(e)`}>📄</span> : r.belegFehlt ? <span title="Beleg fehlt" className="warn-icon">⚠︎</span> : null}</td>
                  <td className={`num nowrap ${r.betrag_cent < 0 ? 'neg' : 'pos'}`}>{formatEUR(r.betrag_cent)}</td>
                  <td><Badge tone={STATUS[r.status].tone} title={r.allocs.find((a) => a.auto)?.auto ?? undefined}>{STATUS[r.status].label}</Badge></td>
                </tr>
              ))}
              {!visible.length && <tr><td colSpan={6} className="empty">Keine Buchungen für diesen Filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {newTx && <ManualTransaction accounts={accounts} onClose={() => setNewTx(false)} />}
    </>
  );
}

function ManualTransaction({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const [t, setT] = useState<Partial<Transaction>>({ account_id: accounts[0]?.id, buchungsdatum: todayISO() });
  const valid = t.account_id && t.buchungsdatum && t.betrag_cent;
  const save = () =>
    attempt(() => {
      const id = run(
        'INSERT INTO transactions(account_id, buchungsdatum, betrag_cent, gegen_name, gegen_iban, verwendungszweck, buchungstext) VALUES (?,?,?,?,?,?,?)',
        [t.account_id!, t.buchungsdatum!, t.betrag_cent!, t.gegen_name || null, normalizeIBAN(t.gegen_iban) || null, t.verwendungszweck || null, 'manuell erfasst'],
      );
      onClose();
      navigate(`konto/${id}`);
    }, 'Buchung angelegt');
  return (
    <Modal title="Buchung manuell erfassen" onClose={onClose} footer={<><button onClick={onClose}>Abbrechen</button><button className="primary" disabled={!valid} onClick={save}>Anlegen</button></>}>
      <p className="muted small">Nur für Buchungen, die nicht per CSV importiert werden können. Später importierte Umsätze werden nicht automatisch mit manuellen Buchungen abgeglichen.</p>
      <div className="form-grid cols-2">
        <Field label="Konto"><Select value={t.account_id ?? null} onChange={(v) => setT({ ...t, account_id: v ?? undefined })} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>
        <Field label="Buchungsdatum"><DateInput value={t.buchungsdatum} onChange={(v) => setT({ ...t, buchungsdatum: v ?? undefined })} /></Field>
        <Field label="Betrag" hint="Ausgaben mit Minus, z. B. -49,90"><MoneyInput value={t.betrag_cent} onChange={(v) => setT({ ...t, betrag_cent: v ?? undefined })} /></Field>
        <Field label="Zahlungspartner"><TextInput value={t.gegen_name} onChange={(v) => setT({ ...t, gegen_name: v })} /></Field>
        <Field label="IBAN Zahlungspartner"><TextInput value={t.gegen_iban} onChange={(v) => setT({ ...t, gegen_iban: v })} /></Field>
        <Field label="Verwendungszweck"><TextInput value={t.verwendungszweck} onChange={(v) => setT({ ...t, verwendungszweck: v })} /></Field>
      </div>
    </Modal>
  );
}

// ---------- Zuordnung ----------

type Line = AllocationInput & { key: number };
// Neue Zeilen bekommen Schlüssel oberhalb aller Datenbank-IDs, damit Schlüssel über Neuzeichnungen stabil bleiben
let lineKey = 1_000_000_000;

export function AssignDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const t = useQuery(() => get<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]), [id]);
  const existing = useQuery(() => all<Allocation>('SELECT * FROM allocations WHERE transaction_id = ? ORDER BY id', [id]), [id]);
  const cats = useQuery(() => new Map(categories().map((c) => [c.id, c])));
  const catOpts = useQuery(() => categoryOptions());
  const memOpts = useQuery(() => memberOptions());
  const partOpts = useQuery(() => partnerOptions());
  const members = useQuery(() => new Map(all<Member>('SELECT * FROM members').map((m) => [m.id, m])));
  const partners = useQuery(() => new Map(all<Partner>('SELECT * FROM partners').map((p) => [p.id, p])));
  const [quick, setQuick] = useState<{ kind: 'member' | 'partner'; key: number } | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [geprueft, setGeprueft] = useState<boolean | null>(null);
  const [notiz, setNotiz] = useState<string | null>(null);
  const [learnRule, setLearnRule] = useState(true);
  const [learnIban, setLearnIban] = useState(true);
  const iban = normalizeIBAN(t?.gegen_iban);
  const ruleExists = useQuery(() => (iban ? !!scalar('SELECT 1 FROM rules WHERE iban = ?', [iban]) : false), [iban]);

  if (!t) return null;
  const current: Line[] =
    lines ??
    (existing.length
      ? existing.map((a) => ({ ...a, key: a.id }))
      : [{ key: -1, category_id: null, member_id: null, partner_id: null, betrag_cent: t.betrag_cent, beitragsjahr: null }]);
  const update = (key: number, patch: Partial<Line>) => setLines(current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const sum = current.reduce((s, l) => s + (l.betrag_cent || 0), 0);
  const rest = t.betrag_cent - sum;
  const memberLine = current.find((l) => l.member_id);
  const memberWithoutIban = memberLine ? members.get(memberLine.member_id!) : undefined;
  const offerIban = !!iban && !!memberWithoutIban && !memberWithoutIban.iban;
  // Hat der Partner diese IBAN schon, ist keine extra Regel nötig
  const partnerHasIban = current.some((l) => l.partner_id && normalizeIBAN(partners.get(l.partner_id)?.iban) === iban);
  const offerRule = !!iban && !partnerHasIban && !current.some((l) => l.member_id) && current.length === 1 && !!current[0].category_id;
  const beitragCat = () => Number(scalar("SELECT value FROM meta WHERE key='beitrag_category_id'")) || null;
  const created = (kind: 'member' | 'partner', key: number, newId: number, others: boolean) => {
    setQuick(null);
    if (kind === 'member') {
      const l = current.find((x) => x.key === key);
      update(key, { member_id: newId, category_id: l?.category_id ?? beitragCat() });
    } else {
      const p = get<Partner>('SELECT * FROM partners WHERE id = ?', [newId]);
      const l = current.find((x) => x.key === key);
      update(key, { partner_id: newId, category_id: l?.category_id ?? p?.default_category_id ?? null });
    }
    if (others) {
      const r = autoAssign(undefined, [id]);
      if (r.zugeordnet) toast(r.zugeordnet === 1 ? '1 weitere offene Buchung automatisch zugeordnet' : `${r.zugeordnet} weitere offene Buchungen automatisch zugeordnet`, 'info');
    }
  };
  const save = (next: boolean) => {
    const ok = attempt(() =>
      tx(() => {
        const clean = current.filter((l) => l.betrag_cent || l.category_id);
        const changed = lines !== null;
        setAllocations(
          id,
          clean.map((l) => ({
            ...l,
            beitragsjahr: l.member_id && l.category_id && cats.get(l.category_id)?.mitgliedskonto ? l.beitragsjahr ?? yearOf(t.buchungsdatum) : l.beitragsjahr,
            auto: changed ? null : l.auto,
          })),
        );
        run('UPDATE transactions SET geprueft = ?, notiz = ? WHERE id = ?', [
          (geprueft ?? (changed ? true : !!t.geprueft)) ? 1 : 0, notiz ?? t.notiz, id,
        ]);
        if (offerRule && learnRule && changed) createRuleFromTransaction(t, { category_id: current[0].category_id, partner_id: current[0].partner_id });
        if (offerIban && learnIban) run('UPDATE members SET iban = ?, kontoinhaber = COALESCE(kontoinhaber, ?) WHERE id = ?', [iban, t.gegen_name, memberWithoutIban!.id]);
      }),
      'Zuordnung gespeichert',
    );
    if (!ok) return;
    if (next) {
      const nextId = scalar<number>(
        `SELECT t.id FROM transactions t WHERE t.id != ? AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.transaction_id = t.id)
         ORDER BY t.buchungsdatum DESC, t.id DESC LIMIT 1`,
        [id],
      );
      if (nextId) {
        navigate(`konto/${nextId}`);
        return;
      }
      toast('Alle Buchungen sind zugeordnet 🎉');
    }
    onClose();
  };

  const requestClose = () => {
    if (lines !== null && !confirm('Die geänderte Zuordnung ist noch nicht gespeichert. Verwerfen?')) return;
    onClose();
  };

  const remove = () => {
    if (!confirm('Diese Kontobewegung wirklich löschen? (Nur sinnvoll bei Fehlimporten.)')) return;
    if (attempt(() => run('DELETE FROM transactions WHERE id = ?', [id]), 'Buchung gelöscht')) onClose();
  };

  const firstPartner = current.find((l) => l.partner_id)?.partner_id ?? null;
  return (
    <Modal
      size="wide"
      title={<>Buchung vom {formatDate(t.buchungsdatum)} <span className={t.betrag_cent < 0 ? 'neg' : 'pos'}>{formatEUR(t.betrag_cent)}</span></>}
      onClose={requestClose}
      footer={<>
        <button className="danger-outline" onClick={remove}>Löschen</button>
        <span className="spacer" />
        {rest !== 0 && <span className="field-error">Noch {formatEUR(rest)} nicht verteilt</span>}
        <button onClick={requestClose}>Abbrechen</button>
        <button onClick={() => save(false)}>Speichern</button>
        <button className="primary" onClick={() => save(true)}>Speichern & nächste offene</button>
      </>}
    >
      <dl className="dl compact">
        <div><dt>Zahlungspartner</dt><dd><strong>{t.gegen_name || '–'}</strong>{t.gegen_iban && <span className="mono muted"> · {formatIBAN(t.gegen_iban)}</span>}</dd></div>
        <div><dt>Verwendungszweck</dt><dd>{t.verwendungszweck || '–'}</dd></div>
        <div><dt>Buchungstext</dt><dd>{t.buchungstext || '–'}{t.mandatsreferenz && <span className="muted"> · Mandat {t.mandatsreferenz}</span>}</dd></div>
      </dl>

      <h3>Zuordnung</h3>
      <div className="alloc-lines">
        {current.map((l) => {
          const cat = l.category_id ? cats.get(l.category_id) : undefined;
          return (
            <div key={l.key} className="alloc-line">
              <Field label="Kategorie (SKR04)" span={2}>
                <Select value={l.category_id} onChange={(v) => update(l.key, { category_id: v })} empty="– Kategorie wählen –" options={catOpts} />
              </Field>
              <Field label="Mitglied">
                <Select value={l.member_id} onChange={(v) => update(l.key, { member_id: v, category_id: v && !l.category_id ? beitragCat() : l.category_id })} empty="–" options={memOpts} />
              </Field>
              <Field label="Lieferant / Partner">
                <Select value={l.partner_id} onChange={(v) => update(l.key, { partner_id: v, category_id: v && !l.category_id ? partners.get(v)?.default_category_id ?? null : l.category_id })} empty="–" options={partOpts} />
              </Field>
              <Field label="Betrag"><MoneyInput value={l.betrag_cent} onChange={(v) => update(l.key, { betrag_cent: v ?? 0 })} /></Field>
              {l.member_id && cat?.mitgliedskonto ? (
                <Field label="Beitragsjahr">
                  <input type="number" value={l.beitragsjahr ?? yearOf(t.buchungsdatum)} onChange={(e) => update(l.key, { beitragsjahr: Number(e.target.value) || null })} />
                </Field>
              ) : <div />}
              <div className="alloc-new">
                <button className="link small" onClick={() => setQuick({ kind: 'member', key: l.key })}>+ neues Mitglied</button>
                <button className="link small" onClick={() => setQuick({ kind: 'partner', key: l.key })}>+ neuer Lieferant/Partner</button>
              </div>
              <div className="alloc-actions">
                {current.length > 1 && <button className="link danger" onClick={() => setLines(current.filter((x) => x.key !== l.key))}>entfernen</button>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="inline">
        <button className="link" onClick={() => setLines([...current, { key: ++lineKey, category_id: null, member_id: null, partner_id: null, betrag_cent: rest, beitragsjahr: null }])}>
          + Aufteilen (Splitbuchung)
        </button>
        {existing.some((a) => a.auto) && lines === null && <Badge tone="info">automatisch: {existing.find((a) => a.auto)?.auto}</Badge>}
      </div>
      {(offerRule || offerIban) && lines !== null && (
        <div className="callout">
          {offerRule && (
            <Checkbox checked={learnRule} onChange={setLearnRule} label={<>Merken: künftige Buchungen von <strong>{t.gegen_name || iban}</strong> automatisch so zuordnen {ruleExists && <span className="muted">(bestehende Regel wird aktualisiert)</span>}</>} />
          )}
          {offerIban && (
            <Checkbox checked={learnIban} onChange={setLearnIban} label={<>IBAN <span className="mono">{formatIBAN(iban)}</span> bei {memberName(memberWithoutIban)} hinterlegen (für die automatische Zuordnung)</>} />
          )}
        </div>
      )}

      {quick?.kind === 'member' && (
        <QuickMemberDialog tx={t} onClose={() => setQuick(null)} onCreated={(newId, others) => created('member', quick.key, newId, others)} />
      )}
      {quick?.kind === 'partner' && (
        <QuickPartnerDialog tx={t} categoryId={current.find((x) => x.key === quick.key)?.category_id} onClose={() => setQuick(null)} onCreated={(newId, others) => created('partner', quick.key, newId, others)} />
      )}
      <div className="grid-2 mt">
        <div>
          <h3>Belege</h3>
          <TransactionDocs transactionId={id} belegdatum={t.buchungsdatum} partnerId={firstPartner} />
        </div>
        <div>
          <h3>Notiz</h3>
          <TextArea value={notiz ?? t.notiz} onChange={setNotiz} rows={3} />
          <Checkbox checked={geprueft ?? !!t.geprueft} onChange={setGeprueft} label="Zuordnung geprüft" />
        </div>
      </div>
    </Modal>
  );
}

// ---------- Konten ----------

function Accounts() {
  const [edit, setEdit] = useState<Partial<Account> | null>(null);
  const [cp, setCp] = useState<{ account: Account } | null>(null);
  const data = useQuery(() => {
    const accounts = all<Account>('SELECT * FROM accounts ORDER BY id');
    return accounts.map((a) => {
      const last = get<{ buchungsdatum: string; saldo_cent: number | null }>(
        'SELECT buchungsdatum, saldo_cent FROM transactions WHERE account_id = ? ORDER BY buchungsdatum DESC, id DESC LIMIT 1', [a.id]);
      const checkpoints = all<BalanceCheckpoint>('SELECT * FROM balance_checkpoints WHERE account_id = ? ORDER BY datum DESC', [a.id]);
      const n = scalar<number>('SELECT COUNT(*) FROM transactions WHERE account_id = ?', [a.id]) ?? 0;
      return { a, saldo: balanceAt(a, todayISO()), last, checkpoints, n };
    });
  });
  return (
    <>
      <div className="toolbar">
        <button onClick={() => setEdit({ anfangsdatum: `${new Date().getFullYear()}-01-01`, anfangssaldo_cent: 0, name: 'Girokonto' })}>+ Konto anlegen</button>
        <span className="muted small">Konten werden beim ersten Import auch automatisch angelegt (anhand der IBAN in der CSV-Datei).</span>
      </div>
      {!data.length && <Empty>Noch kein Konto vorhanden.</Empty>}
      {data.map(({ a, saldo, last, checkpoints, n }) => (
        <div className="card" key={a.id}>
          <div className="card-head">
            <div>
              <h3>{a.name}</h3>
              <div className="muted small">{a.bank} {a.iban && <span className="mono">{formatIBAN(a.iban)}</span>} · {n} Buchungen</div>
            </div>
            <div className="actions">
              <button onClick={() => setCp({ account: a })}>Kontostand laut Auszug erfassen</button>
              <button onClick={() => setEdit(a)}>Bearbeiten</button>
            </div>
          </div>
          <div className="stats">
            <Stat label={`Anfangssaldo ${formatDate(a.anfangsdatum)}`} value={formatEUR(a.anfangssaldo_cent)} sub="Kontostand zu Beginn dieses Tages" />
            <Stat label="Berechneter Kontostand heute" value={formatEUR(saldo)} />
            {last?.saldo_cent != null && (
              <Stat label={`Saldo laut Bank (${formatDate(last.buchungsdatum)})`} value={formatEUR(last.saldo_cent)}
                tone={balanceAt(a, last.buchungsdatum) === last.saldo_cent ? 'ok' : 'bad'}
                sub={balanceAt(a, last.buchungsdatum) === last.saldo_cent ? 'stimmt überein' : `Differenz ${formatEUR((balanceAt(a, last.buchungsdatum) ?? 0) - last.saldo_cent)}`} />
            )}
          </div>
          {checkpoints.length > 0 && (
            <table className="table">
              <thead><tr><th>Stichtag</th><th className="num">laut Auszug</th><th className="num">berechnet</th><th className="num">Differenz</th><th>Notiz</th><th /></tr></thead>
              <tbody>
                {checkpoints.map((c) => {
                  const calc = balanceAt(a, c.datum);
                  const diff = calc == null ? null : calc - c.saldo_cent;
                  return (
                    <tr key={c.id}>
                      <td>{formatDate(c.datum)}</td>
                      <td className="num">{formatEUR(c.saldo_cent)}</td>
                      <td className="num">{calc == null ? 'vor Anfangsdatum' : formatEUR(calc)}</td>
                      <td className="num">{diff == null ? '–' : diff === 0 ? <Badge tone="ok">stimmt</Badge> : <Badge tone="bad">{formatEUR(diff)}</Badge>}</td>
                      <td className="small">{c.notiz}</td>
                      <td><button className="link danger" onClick={() => attempt(() => run('DELETE FROM balance_checkpoints WHERE id = ?', [c.id]))}>löschen</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {edit && <AccountDialog a={edit} onClose={() => setEdit(null)} />}
      {cp && <CheckpointDialog account={cp.account} onClose={() => setCp(null)} />}
    </>
  );
}

function AccountDialog({ a, onClose }: { a: Partial<Account>; onClose: () => void }) {
  const [v, setV] = useState(a);
  const isNew = !a.id;
  const save = () =>
    attempt(() => {
      const vals = [v.name!.trim(), v.bank || null, normalizeIBAN(v.iban) || null, v.bic || null, v.anfangssaldo_cent ?? 0, v.anfangsdatum!];
      if (isNew) run('INSERT INTO accounts(name, bank, iban, bic, anfangssaldo_cent, anfangsdatum) VALUES (?,?,?,?,?,?)', vals);
      else run('UPDATE accounts SET name=?, bank=?, iban=?, bic=?, anfangssaldo_cent=?, anfangsdatum=? WHERE id=?', [...vals, a.id!]);
      onClose();
    }, 'Konto gespeichert');
  const remove = () => {
    const n = scalar<number>('SELECT COUNT(*) FROM transactions WHERE account_id = ?', [a.id!]) ?? 0;
    if (!confirm(`Konto „${a.name}" löschen?${n ? `\nAchtung: ${n} Buchungen inkl. Zuordnungen werden mit gelöscht!` : ''}`)) return;
    if (attempt(() => run('DELETE FROM accounts WHERE id = ?', [a.id!]), 'Konto gelöscht')) onClose();
  };
  return (
    <Modal title={isNew ? 'Konto anlegen' : 'Konto bearbeiten'} onClose={onClose}
      footer={<>{!isNew && <button className="danger-outline" onClick={remove}>Löschen</button>}<button onClick={onClose}>Abbrechen</button><button className="primary" disabled={!v.name?.trim() || !v.anfangsdatum} onClick={save}>Speichern</button></>}>
      <div className="form-grid cols-2">
        <Field label="Bezeichnung"><TextInput value={v.name} onChange={(x) => setV({ ...v, name: x })} /></Field>
        <Field label="Bank"><TextInput value={v.bank} onChange={(x) => setV({ ...v, bank: x })} placeholder="z. B. Sparkasse Hanau" /></Field>
        <Field label="IBAN" span={2}><TextInput value={v.iban} onChange={(x) => setV({ ...v, iban: x })} /></Field>
        <Field label="Anfangsdatum" hint="ab hier werden Kontostände berechnet"><DateInput value={v.anfangsdatum} onChange={(x) => setV({ ...v, anfangsdatum: x ?? undefined })} /></Field>
        <Field label="Anfangssaldo" hint="Kontostand zu Beginn des Anfangsdatums (z. B. Stand 1.1. laut Auszug)"><MoneyInput value={v.anfangssaldo_cent} onChange={(x) => setV({ ...v, anfangssaldo_cent: x ?? 0 })} /></Field>
      </div>
    </Modal>
  );
}

function CheckpointDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const [datum, setDatum] = useState<string | null>(`${new Date().getFullYear() - 1}-12-31`);
  const [saldo, setSaldo] = useState<number | null>(null);
  const [notiz, setNotiz] = useState('');
  const save = () =>
    attempt(() => {
      run(
        `INSERT INTO balance_checkpoints(account_id, datum, saldo_cent, notiz) VALUES (?,?,?,?)
         ON CONFLICT(account_id, datum) DO UPDATE SET saldo_cent = excluded.saldo_cent, notiz = excluded.notiz`,
        [account.id, datum!, saldo!, notiz || null],
      );
      onClose();
    }, 'Kontostand erfasst');
  return (
    <Modal title={`Kontostand laut Auszug – ${account.name}`} onClose={onClose}
      footer={<><button onClick={onClose}>Abbrechen</button><button className="primary" disabled={!datum || saldo == null} onClick={save}>Speichern</button></>}>
      <p className="muted small">Trage z. B. den Kontostand zum 31.12. laut Jahreskontoauszug ein. Die App vergleicht ihn mit dem berechneten Stand – so fallen fehlende Importe sofort auf.</p>
      <div className="form-grid cols-2">
        <Field label="Stichtag (Ende des Tages)"><DateInput value={datum} onChange={setDatum} /></Field>
        <Field label="Kontostand"><MoneyInput value={saldo} onChange={setSaldo} autoFocus /></Field>
        <Field label="Notiz" span={2}><TextInput value={notiz} onChange={setNotiz} placeholder="z. B. Kontoauszug Nr. 12/2026" /></Field>
      </div>
    </Modal>
  );
}

function Imports() {
  const list = useQuery(() =>
    all<{ id: number; dateiname: string; profil: string; importiert_am: string; anzahl_neu: number; anzahl_dupl: number; konto: string; vorhanden: number; von: string; bis: string }>(
      `SELECT i.*, a.name AS konto, COUNT(t.id) AS vorhanden, MIN(t.buchungsdatum) AS von, MAX(t.buchungsdatum) AS bis
       FROM imports i LEFT JOIN accounts a ON a.id = i.account_id LEFT JOIN transactions t ON t.import_id = i.id
       GROUP BY i.id ORDER BY i.id DESC`,
    ),
  );
  const undo = (id: number, n: number) => {
    if (!confirm(`Import rückgängig machen? ${n} Buchungen dieses Imports werden inkl. Zuordnungen gelöscht.`)) return;
    attempt(() => tx(() => { run('DELETE FROM transactions WHERE import_id = ?', [id]); run('DELETE FROM imports WHERE id = ?', [id]); }), 'Import entfernt');
  };
  if (!list.length) return <Empty>Noch keine Importe.</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Importiert am</th><th>Datei</th><th>Format</th><th>Konto</th><th>Zeitraum</th><th className="num">neu</th><th className="num">Duplikate</th><th /></tr></thead>
        <tbody>
          {list.map((i) => (
            <tr key={i.id}>
              <td>{i.importiert_am.replace(/^(\d{4})-(\d\d)-(\d\d)/, '$3.$2.$1')}</td>
              <td>{i.dateiname}</td>
              <td className="small">{i.profil}</td>
              <td>{i.konto}</td>
              <td className="small">{i.von ? `${formatDate(i.von)} – ${formatDate(i.bis)}` : '–'}</td>
              <td className="num">{i.anzahl_neu}</td>
              <td className="num">{i.anzahl_dupl}</td>
              <td>{i.vorhanden > 0 && <button className="link danger" onClick={() => undo(i.id, i.vorhanden)}>rückgängig</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
