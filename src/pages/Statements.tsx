import { useRef, useState } from 'react';
import { all, get, scalar } from '../db/db';
import type { Account } from '../db/schema';
import { useLocalState, useQuery } from '../hooks';
import { balanceAt } from '../lib/bank';
import { formatSize } from '../lib/docs';
import { formatDate, formatEUR, formatIBAN } from '../lib/format';
import { pdfText } from '../lib/pdftext';
import {
  deleteStatement, deleteStatementsOfYear, findAccountForIban, resortStatements, listStatements, missingMonths, parseStatementText, saveStatement, statementBlobUrl, statementMonth,
  updateStatement, withFilename, type SaveStatementResult, type StatementInfo, type StatementMeta,
} from '../lib/statements';
import { DocViewer } from '../components/Docs';
import { attempt, Badge, DateInput, Empty, Field, Modal, MoneyInput, PageHeader, Select, TextInput, toast, YearSelect } from '../components/ui';

export const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MAX_SIZE = 30 * 1024 * 1024;

type Pending = { file: File; bytes: Uint8Array; info: StatementInfo; erkannt: boolean; account_id: number | null; jahr: number; monat: number | null };

function resultText(r: SaveStatementResult): string {
  if (r.abgleich === 'kalibriert') return 'Kontostand übernommen, Anfangssaldo berechnet';
  if (r.abgleich === 'stimmt') return 'Kontostand stimmt mit den Buchungen überein ✓';
  if (r.abgleich === 'abweichung') return `Kontostand weicht um ${formatEUR(r.differenz)} von den Buchungen ab`;
  return 'kein Kontostand erkannt';
}

export function StatementsPage() {
  const [year, setYear] = useLocalState('statements.year', new Date().getFullYear());
  const accounts = useQuery(() => all<Account>('SELECT * FROM accounts ORDER BY id'));
  const [accountId, setAccountId] = useLocalState<number | null>('statements.account', null);
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const list = useQuery(() => listStatements(year), [year]);
  const missing = useQuery(() => (account ? missingMonths(account.id, year) : []), [account?.id, year, list]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [view, setView] = useState<number | null>(null);
  const [edit, setEdit] = useState<StatementMeta | null>(null);
  const [over, setOver] = useState<number | 'all' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const targetMonth = useRef<number | null>(null);

  const handleFiles = async (files: File[], monat: number | null) => {
    if (!files.length) return;
    setBusy(true);
    const needsHelp: Pending[] = [];
    try {
      for (const file of files) {
        if (file.size > MAX_SIZE) {
          toast(`„${file.name}" ist größer als 30 MB`, 'bad');
          continue;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        let info: StatementInfo = { iban: null, nummer: null, von: null, bis: null, saldo_alt_cent: null, saldo_neu_cent: null };
        let erkannt = false;
        if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          try {
            info = parseStatementText(await pdfText(bytes));
            erkannt = !!(info.bis || info.saldo_neu_cent != null || info.nummer);
          } catch (e) {
            console.warn('PDF konnte nicht gelesen werden', e);
          }
        }
        // Dateiname der Sparkasse („…-Auszug_2026_0002.pdf“) ergänzt Auszugsnummer bzw. Monat
        info = withFilename(info, file.name);
        erkannt ||= !!info.bis;
        const acc = findAccountForIban(info.iban) ?? account;
        const period = statementMonth(info);
        const p: Pending = {
          file, bytes, info, erkannt, account_id: acc?.id ?? null,
          jahr: monat ? year : period?.jahr ?? year,
          monat: monat ?? period?.monat ?? null,
        };
        const dup = p.account_id && info.nummer
          ? scalar('SELECT 1 FROM statements WHERE account_id = ? AND nummer = ? AND jahr = ?', [p.account_id, info.nummer, p.jahr])
          : scalar('SELECT 1 FROM statements WHERE dateiname = ? AND groesse = ?', [file.name, file.size]);
        if (dup && !confirm(`„${file.name}" scheint schon abgelegt zu sein. Trotzdem noch einmal speichern?`)) continue;
        if (p.account_id && p.monat) {
          const r = saveStatement({ ...info, account_id: p.account_id, jahr: p.jahr, monat: p.monat, dateiname: file.name, mime: file.type || 'application/pdf', daten: bytes, erkannt });
          toast(`${file.name} → ${MONATSNAMEN[p.monat - 1]} ${p.jahr}: ${resultText(r)}`, r.abgleich === 'abweichung' ? 'bad' : 'ok');
          if (p.jahr !== year && files.length === 1) setYear(p.jahr);
        } else needsHelp.push(p);
      }
    } finally {
      setBusy(false);
    }
    if (needsHelp.length) setPending(needsHelp);
  };

  if (!accounts.length) {
    return (
      <div className="page">
        <PageHeader title="Kontoauszüge" />
        <Empty>Lege zuerst ein Konto an – am einfachsten durch den <a href="#/import">CSV-Import</a> der Umsätze.</Empty>
      </div>
    );
  }

  const own = list.filter((s) => s.account_id === account?.id);

  const resort = async () => {
    if (!account) return;
    setBusy(true);
    try {
      const r = await resortStatements(account.id, pdfText);
      toast(r.geprueft ? `${r.geprueft} Auszüge neu ausgelesen, ${r.verschoben} in einen anderen Monat verschoben` : 'Keine automatisch erkannten Auszüge vorhanden', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  const removeYear = () => {
    if (!account || !confirm(`Alle ${own.length} Kontoauszüge ${year} von „${account.name}" löschen? Die PDFs sind danach nur noch in älteren Sicherungen enthalten.`)) return;
    attempt(() => { const n = deleteStatementsOfYear(account.id, year); toast(`${n} Kontoauszüge gelöscht`); });
  };

  return (
    <div className="page">
      <PageHeader
        title="Kontoauszüge"
        subtitle="Ablage der PDF-Kontoauszüge nach Jahr und Monat. PDFs aus dem Online-Banking werden automatisch ausgelesen (Zeitraum, Auszugsnummer, Kontostände) und einsortiert – komplett im Browser."
        actions={<>
          {accounts.length > 1 && <Select value={account?.id ?? null} onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />}
          <YearSelect value={year} onChange={setYear} />
          <button disabled={busy || !account} onClick={() => void resort()} title="Alle automatisch erkannten Auszüge dieses Kontos neu auslesen und dem richtigen Monat zuordnen">↻ Neu einsortieren</button>
          <button className="danger-outline" disabled={busy || !own.length} onClick={removeYear}>Alle {year} löschen</button>
        </>}
      />
      <div
        className={`dropzone ${over === 'all' ? 'over' : ''}`}
        onClick={() => { targetMonth.current = null; input.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setOver('all'); }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => { e.preventDefault(); setOver(null); void handleFiles([...e.dataTransfer.files], null); }}
      >
        {busy ? '⏳ Lese Kontoauszüge …' : '📥 Kontoauszüge (PDF) hierher ziehen oder klicken – mehrere auf einmal möglich, sie werden automatisch dem richtigen Monat zugeordnet'}
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/*"
        multiple
        hidden
        onChange={(e) => { void handleFiles([...(e.target.files ?? [])], targetMonth.current); e.target.value = ''; }}
      />
      {missing.length > 0 && (
        <div className="callout warn">Für {account?.name} fehlen Auszüge für: {missing.map((m) => MONATSNAMEN[m - 1]).join(', ')} {year}.</div>
      )}
      <div className="month-grid">
        {MONATSNAMEN.map((name, i) => {
          const m = i + 1;
          const items = own.filter((s) => s.monat === m);
          const fehlt = missing.includes(m);
          return (
            <div
              key={m}
              className={`month-card ${fehlt ? 'missing' : ''} ${items.length ? 'has' : ''} ${over === m ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(m); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(null); void handleFiles([...e.dataTransfer.files], m); }}
            >
              <div className="month-head">
                <strong>{name}</strong>
                {items.length ? <Badge tone="ok">{items.length}</Badge> : fehlt ? <Badge tone="warn">fehlt</Badge> : null}
              </div>
              {items.map((s) => <StatementRow key={s.id} s={s} account={account} onView={() => setView(s.id)} onEdit={() => setEdit(s)} />)}
              <button className="link small" onClick={() => { targetMonth.current = m; input.current?.click(); }}>+ Auszug für {name}</button>
            </div>
          );
        })}
      </div>
      <p className="muted small">
        Tipp: Gescannte Auszüge (Fotos, PDFs ohne Text) lassen sich nicht auslesen – zieh sie direkt auf den passenden Monat. Erkannte Kontostände
        werden als Kontrollwerte gespeichert; weicht der berechnete Kontostand ab, fehlen vermutlich Umsätze im CSV-Import.
      </p>
      {view && <DocViewer id={view} load={statementBlobUrl} onClose={() => setView(null)} />}
      {edit && <StatementDialog initial={edit} accounts={accounts} onClose={() => setEdit(null)} />}
      {pending[0] && (
        <AssignDialog
          key={pending[0].file.name + pending.length}
          p={pending[0]}
          accounts={accounts}
          rest={pending.length - 1}
          onDone={() => setPending(pending.slice(1))}
        />
      )}
    </div>
  );
}

function StatementRow({ s, account, onView, onEdit }: { s: StatementMeta; account: Account | undefined; onView: () => void; onEdit: () => void }) {
  const berechnet = account && s.bis ? balanceAt(account, s.bis) : null;
  const ok = s.saldo_neu_cent != null && berechnet != null ? berechnet === s.saldo_neu_cent : null;
  return (
    <div className="statement-row">
      <button className="link" onClick={onView} title={s.dateiname}>📄 {s.nummer ? `Nr. ${s.nummer}` : s.dateiname}</button>
      <div className="muted small">
        {s.von || s.bis ? `${formatDate(s.von)} – ${formatDate(s.bis)}` : formatSize(s.groesse)}
      </div>
      {s.saldo_neu_cent != null && (
        <div className="small">
          Kontostand {formatEUR(s.saldo_neu_cent)}{' '}
          {ok === true && <Badge tone="ok">✓</Badge>}
          {ok === false && <Badge tone="bad" title={`berechnet ${formatEUR(berechnet)}`}>Diff. {formatEUR((berechnet ?? 0) - s.saldo_neu_cent)}</Badge>}
        </div>
      )}
      <button className="link small" onClick={onEdit}>bearbeiten</button>
    </div>
  );
}

function AssignDialog({ p, accounts, rest, onDone }: { p: Pending; accounts: Account[]; rest: number; onDone: () => void }) {
  const [v, setV] = useState({ ...p.info, account_id: p.account_id, jahr: p.jahr, monat: p.monat });
  const save = () => {
    if (!v.account_id || !v.monat) return;
    let r: SaveStatementResult | null = null;
    if (attempt(() => { r = saveStatement({ ...v, account_id: v.account_id!, monat: v.monat!, dateiname: p.file.name, mime: p.file.type || 'application/pdf', daten: p.bytes, erkannt: p.erkannt }); })) {
      toast(`${p.file.name} → ${MONATSNAMEN[v.monat - 1]} ${v.jahr}: ${resultText(r!)}`);
      onDone();
    }
  };
  return (
    <Modal
      title={`Kontoauszug zuordnen: ${p.file.name}`}
      onClose={onDone}
      footer={<>{rest > 0 && <span className="muted small">noch {rest} weitere</span>}<button onClick={onDone}>Überspringen</button><button className="primary" disabled={!v.account_id || !v.monat} onClick={save}>Ablegen</button></>}
    >
      <p className="muted small">
        {p.erkannt
          ? 'Einige Angaben wurden erkannt – bitte Konto und Monat ergänzen.'
          : 'Aus dieser Datei ließ sich nichts auslesen (z. B. gescannter Auszug). Bitte Monat angeben; Kontostände sind optional.'}
      </p>
      <StatementFields v={v} setV={setV} accounts={accounts} />
    </Modal>
  );
}

type FieldValues = StatementInfo & { account_id: number | null; jahr: number; monat: number | null };

function StatementFields({ v, setV, accounts }: { v: FieldValues; setV: (v: FieldValues) => void; accounts: Account[] }) {
  return (
    <div className="form-grid cols-2">
      <Field label="Konto" span={2}>
        <Select value={v.account_id} onChange={(x) => setV({ ...v, account_id: x })} empty="– wählen –" options={accounts.map((a) => ({ value: a.id, label: `${a.name}${a.iban ? ` (${formatIBAN(a.iban)})` : ''}` }))} />
      </Field>
      <Field label="Monat"><Select value={v.monat} onChange={(x) => setV({ ...v, monat: x })} empty="– wählen –" options={MONATSNAMEN.map((n, i) => ({ value: i + 1, label: n }))} /></Field>
      <Field label="Jahr"><input type="number" value={v.jahr} onChange={(e) => setV({ ...v, jahr: Number(e.target.value) || v.jahr })} /></Field>
      <Field label="Auszugsnummer"><TextInput value={v.nummer} onChange={(x) => setV({ ...v, nummer: x || null })} /></Field>
      <div />
      <Field label="Zeitraum von"><DateInput value={v.von} onChange={(x) => setV({ ...v, von: x })} /></Field>
      <Field label="bis"><DateInput value={v.bis} onChange={(x) => setV({ ...v, bis: x })} /></Field>
      <Field label="Alter Kontostand"><MoneyInput value={v.saldo_alt_cent} onChange={(x) => setV({ ...v, saldo_alt_cent: x })} /></Field>
      <Field label="Neuer Kontostand"><MoneyInput value={v.saldo_neu_cent} onChange={(x) => setV({ ...v, saldo_neu_cent: x })} /></Field>
    </div>
  );
}

function StatementDialog({ initial, accounts, onClose }: { initial: StatementMeta; accounts: Account[]; onClose: () => void }) {
  const [v, setV] = useState<FieldValues>({ ...initial, iban: null });
  const save = () =>
    attempt(() => {
      updateStatement(initial.id, {
        account_id: v.account_id!, jahr: v.jahr, monat: v.monat!, nummer: v.nummer, von: v.von, bis: v.bis,
        saldo_alt_cent: v.saldo_alt_cent, saldo_neu_cent: v.saldo_neu_cent,
      });
      onClose();
    }, 'Gespeichert');
  const remove = () => confirm(`Kontoauszug „${initial.dateiname}" löschen?`) && attempt(() => deleteStatement(initial.id), 'Gelöscht') && onClose();
  return (
    <Modal
      title={`Kontoauszug ${initial.nummer ?? initial.dateiname}`}
      onClose={onClose}
      footer={<><button className="danger-outline" onClick={remove}>Löschen</button><button onClick={onClose}>Abbrechen</button><button className="primary" disabled={!v.account_id || !v.monat} onClick={save}>Speichern</button></>}
    >
      {!initial.erkannt && <p className="muted small">Von Hand erfasst bzw. bearbeitet – wird beim Neu-Einsortieren nicht verändert.</p>}
      <StatementFields v={v} setV={setV} accounts={accounts} />
      <ExtractedText id={initial.id} />
    </Modal>
  );
}

/** Zeigt den aus dem PDF gelesenen Text – zur Kontrolle, falls Monat oder Kontostand falsch erkannt wurden. */
function ExtractedText({ id }: { id: number }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const show = async () => {
    const st = get<{ daten: Uint8Array; mime: string }>('SELECT daten, mime FROM statements WHERE id = ?', [id]);
    if (!st) return;
    if (st.mime !== 'application/pdf') return setText('(kein PDF)');
    setLoading(true);
    try {
      setText((await pdfText(st.daten)) || '(Kein Text gefunden – vermutlich ein gescannter Auszug.)');
    } catch (e) {
      setText(`Fehler beim Lesen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };
  const relevant = text?.split('\n').filter((l) => /kontostand|saldo|auszug|zeitraum|\bbis\b/i.test(l)) ?? [];
  return (
    <div className="mt">
      {text == null ? (
        <button className="link small" disabled={loading} onClick={() => void show()}>{loading ? 'lese …' : 'Ausgelesenen Text anzeigen'}</button>
      ) : (
        <>
          <div className="field-label">Zeilen mit Kontostand / Auszug / Zeitraum</div>
          <pre className="extracted">{relevant.join('\n') || '–'}</pre>
          <details>
            <summary className="small">Gesamten Text anzeigen</summary>
            <pre className="extracted">{text}</pre>
          </details>
        </>
      )}
    </div>
  );
}
