import { useMemo, useRef, useState } from 'react';
import { all, get, run, scalar, tx } from '../db/db';
import type { Account } from '../db/schema';
import { navigate, useQuery } from '../hooks';
import {
  autoAssign, balanceAt, calibrateOpening, endBalanceFromRows, findOrCreateAccount, importTransactions, isCalibrated, loadProfile,
  saveCheckpoint, saveProfile, type ImportResult,
} from '../lib/bank';
import { CalibrateForm } from '../components/Calibrate';
import {
  analyze, decodeBytes, detectHeaderRow, FIELDS, findBalances, parseCSV, toTransactions, type CsvConfig, type FieldId, type Mapping,
} from '../lib/csv';
import { formatDate, formatEUR, formatIBAN, fromISO, normalizeIBAN, toISO } from '../lib/format';
import { attempt, Badge, Checkbox, Empty, Field, PageHeader, Select, Stat, TextInput, toast } from '../components/ui';

type FoundBalance = { datum: string; saldo_cent: number; quelle: string };

type DoneInfo = ImportResult & {
  auto: number;
  accountId: number;
  /** In der Datei gefundene Kontostände */
  balances: FoundBalance[];
  /** Wurde der Anfangssaldo dabei automatisch berechnet? */
  calibrated: FoundBalance | null;
  lastDate: string;
};

function dayBefore(iso: string): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() - 1);
  return toISO(d);
}

type State = {
  fileName: string;
  bytes: Uint8Array;
  bank: string;
  signature: string;
  config: CsvConfig;
  profileName: string | null;
};

export function ImportPage() {
  const [st, setSt] = useState<State | null>(null);
  const [result, setResult] = useState<(DoneInfo) | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const load = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const a = analyze(bytes);
    const saved = loadProfile(a.signature);
    setResult(null);
    setSt({
      fileName: file.name,
      bytes,
      bank: saved?.name ?? a.bank,
      signature: a.signature,
      config: saved ? { ...a.config, ...saved.config } : a.config,
      profileName: saved?.name ?? null,
    });
  };

  return (
    <div className="page">
      <a className="back" href="#/konto">← Konto</a>
      <PageHeader title="Kontoauszug importieren" subtitle="CSV-Datei aus dem Online-Banking – Sparkasse, Volksbank, DKB, ING, Commerzbank u. a. Spalten werden automatisch erkannt." />
      {!st && (
        <>
          <div
            className={`dropzone big ${over ? 'over' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void load(f); }}
          >
            <input ref={input} type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
            <div className="dropzone-icon">⇪</div>
            <strong>CSV-Datei hierher ziehen oder klicken</strong>
            <div className="muted small">Die Datei wird nur lokal in diesem Browser gelesen und nirgendwohin übertragen.</div>
          </div>
          <div className="card">
            <h3>So bekommst du die CSV-Datei bei der Sparkasse</h3>
            <ol className="small">
              <li>Im Online-Banking das Vereinskonto öffnen → <em>Umsätze</em>.</li>
              <li>Zeitraum wählen (z. B. 01.01. bis 31.12.).</li>
              <li><em>Exportieren</em> → Format <strong>CSV-CAMT V2</strong> (empfohlen, enthält IBAN, Mandatsreferenz und Gläubiger-ID) oder CSV-MT940.</li>
              <li>Datei hier hochladen. Bereits importierte Umsätze werden automatisch als Duplikat erkannt – überlappende Zeiträume sind also kein Problem.</li>
            </ol>
          </div>
        </>
      )}
      {st && !result && <ImportWizard st={st} setSt={setSt} onDone={setResult} onCancel={() => setSt(null)} />}
      {result && <ImportDone r={result} onAnother={() => { setSt(null); setResult(null); }} />}
    </div>
  );
}

function ImportWizard(props: {
  st: State;
  setSt: (s: State) => void;
  onDone: (r: DoneInfo) => void;
  onCancel: () => void;
}) {
  const { st, setSt } = props;
  const { config } = st;
  const accounts = useQuery(() => all<Account>('SELECT * FROM accounts ORDER BY id'));
  const [doAuto, setDoAuto] = useState(true);
  const [accountChoice, setAccountChoice] = useState<number | 'neu' | null>(null);
  const [newName, setNewName] = useState('Girokonto Verein');

  const rows = useMemo(() => parseCSV(decodeBytes(st.bytes, config.encoding).text, config.delimiter), [st.bytes, config.encoding, config.delimiter]);
  const header = rows[config.headerRow] ?? [];
  const parsed = useMemo(() => toTransactions(rows, config), [rows, config]);
  const ownIbans = [...new Set(parsed.ok.map((t) => t.auftragskonto).filter(Boolean))] as string[];
  const detected = ownIbans.length === 1 ? accounts.find((a) => normalizeIBAN(a.iban) === ownIbans[0]) : undefined;
  const accountId = accountChoice ?? detected?.id ?? (accounts.length === 1 && !ownIbans.length ? accounts[0].id : 'neu');

  const existing = useQuery(() => {
    // Wie viele Buchungen sind schon vorhanden? (grobe Vorschau anhand Datum + Betrag)
    if (typeof accountId !== 'number') return 0;
    let n = 0;
    for (const t of parsed.ok) if (scalar('SELECT 1 FROM transactions WHERE account_id = ? AND buchungsdatum = ? AND betrag_cent = ? LIMIT 1', [accountId, t.buchungsdatum, t.betrag_cent])) n++;
    return n;
  }, [accountId, parsed]);

  const setConfig = (patch: Partial<CsvConfig>) => setSt({ ...st, config: { ...config, ...patch } });
  const setMap = (f: FieldId, cols: number[]) => {
    const mapping: Mapping = { ...config.mapping };
    if (cols.length) mapping[f] = cols;
    else delete mapping[f];
    setConfig({ mapping });
  };
  const changeEncoding = (encoding: string) => {
    const r = parseCSV(decodeBytes(st.bytes, encoding).text, config.delimiter);
    setSt({ ...st, config: { ...config, encoding, headerRow: detectHeaderRow(r) } });
  };
  const reanalyze = () => {
    const a = analyze(st.bytes);
    setSt({ ...st, bank: a.bank, config: a.config, profileName: null });
  };

  const ein = parsed.ok.filter((t) => t.betrag_cent > 0).reduce((s, t) => s + t.betrag_cent, 0);
  const aus = parsed.ok.filter((t) => t.betrag_cent < 0).reduce((s, t) => s + t.betrag_cent, 0);
  const dates = parsed.ok.map((t) => t.buchungsdatum).sort();
  // Kontostände aus der Datei: Saldo-Spalte und/oder Angaben im Vorspann bzw. in Fußzeilen
  const fileBalances = useMemo<FoundBalance[]>(() => {
    if (!dates.length) return [];
    const out: FoundBalance[] = [];
    const end = endBalanceFromRows(parsed.ok);
    if (end) out.push({ ...end, quelle: 'Saldo-Spalte' });
    for (const b of findBalances(rows, config.headerRow, config.decimal)) {
      const datum = b.datum ?? (b.art === 'anfang' ? dayBefore(dates[0]) : dates[dates.length - 1]);
      if (!out.some((x) => x.datum === datum && x.saldo_cent === b.saldo_cent)) out.push({ datum, saldo_cent: b.saldo_cent, quelle: `„${b.text.slice(0, 60)}"` });
    }
    return out.sort((a, b) => a.datum.localeCompare(b.datum));
  }, [parsed, rows, config.headerRow, config.decimal]);

  const doImport = () => {
    if (!parsed.ok.length) return;
    let result: Parameters<typeof props.onDone>[0] | null = null;
    const ok = attempt(() => {
      tx(() => {
        let accId: number;
        if (accountId === 'neu') {
          accId = findOrCreateAccount(ownIbans[0] ?? null, newName.trim() || 'Girokonto', dates[0]);
          if (st.bank.startsWith('Sparkasse')) run('UPDATE accounts SET bank = COALESCE(bank, ?) WHERE id = ?', ['Sparkasse', accId]);
        } else accId = accountId;
        const wasCalibrated = isCalibrated(get<Account>('SELECT * FROM accounts WHERE id = ?', [accId])!);
        const r = importTransactions(accId, parsed.ok, { dateiname: st.fileName, profil: st.bank });
        saveProfile(st.bank, st.signature, config);
        const auto = doAuto && r.newIds.length ? autoAssign(r.newIds).zugeordnet : 0;
        // Kontostand aus der Datei übernehmen: bei neuem Konto Anfangssaldo zurückrechnen, sonst als Kontrollwert speichern
        let calibrated: FoundBalance | null = null;
        const latest = fileBalances[fileBalances.length - 1];
        if (latest && !wasCalibrated) {
          calibrateOpening(accId, latest.datum, latest.saldo_cent, `aus Import ${st.fileName}`);
          calibrated = latest;
        }
        for (const b of fileBalances) saveCheckpoint(accId, b.datum, b.saldo_cent, `aus Import ${st.fileName}`);
        result = { ...r, auto, accountId: accId, balances: fileBalances, calibrated, lastDate: dates[dates.length - 1] };
      });
    });
    if (ok && result) props.onDone(result);
  };

  const colOptions = header.map((h, i) => ({ value: i, label: `${i + 1}: ${h || '(leer)'}` }));
  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h3>{st.fileName}</h3>
            <div className="inline small">
              <Badge tone={st.bank === 'Unbekanntes Format' ? 'warn' : 'ok'}>{st.bank}</Badge>
              {st.profileName && <Badge tone="info">gespeicherte Zuordnung verwendet</Badge>}
              <span className="muted">{parsed.ok.length} Umsätze{dates.length ? ` vom ${formatDate(dates[0])} bis ${formatDate(dates[dates.length - 1])}` : ''}</span>
            </div>
          </div>
          <div className="actions">
            <button onClick={props.onCancel}>Andere Datei</button>
          </div>
        </div>
        <div className="stats">
          <Stat label="Einnahmen" value={formatEUR(ein)} tone="ok" />
          <Stat label="Ausgaben" value={formatEUR(-aus)} tone="bad" />
          <Stat label="Vorgemerkte Umsätze" value={parsed.pending} sub={config.skipPending ? 'werden übersprungen' : 'werden importiert'} />
          <Stat label="Vermutlich schon vorhanden" value={existing} sub="werden nicht doppelt importiert" />
        </div>
      </div>

      <div className={`callout ${fileBalances.length ? 'ok' : 'warn'}`}>
        {fileBalances.length ? (
          <>✓ Kontostand in der Datei gefunden: {fileBalances.map((b) => `${formatEUR(b.saldo_cent)} am ${formatDate(b.datum)}`).join(', ')} – wird beim Import übernommen.</>
        ) : (
          <>Diese Datei enthält keinen Kontostand (bei Sparkasse CSV-CAMT normal). Nach dem Import fragt die App einmal nach dem aktuellen Kontostand, damit die Kontostände stimmen.</>
        )}
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>Zielkonto</h3>
          <Field label="In welches Konto importieren?">
            <select value={String(accountId)} onChange={(e) => setAccountChoice(e.target.value === 'neu' ? 'neu' : Number(e.target.value))}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.iban ? ` (${formatIBAN(a.iban)})` : ''}</option>)}
              <option value="neu">+ Neues Konto anlegen</option>
            </select>
          </Field>
          {accountId === 'neu' && (
            <Field label="Name des neuen Kontos" hint={ownIbans[0] ? `IBAN aus der Datei: ${formatIBAN(ownIbans[0])}` : undefined}>
              <TextInput value={newName} onChange={setNewName} />
            </Field>
          )}
          {detected && accountChoice == null && <p className="muted small">✓ Konto anhand der IBAN in der Datei erkannt.</p>}
          {ownIbans.length > 1 && <p className="field-error">Die Datei enthält Umsätze mehrerer Konten ({ownIbans.map(formatIBAN).join(', ')}). Bitte pro Konto getrennt exportieren.</p>}
          <Checkbox checked={config.skipPending} onChange={(v) => setConfig({ skipPending: v })} label="Vorgemerkte (noch nicht gebuchte) Umsätze überspringen" />
          <Checkbox checked={doAuto} onChange={setDoAuto} label="Nach dem Import automatisch zuordnen (Mitglieder, Lieferanten, Regeln)" />
        </div>
        <div className="card">
          <h3>Dateiformat</h3>
          <div className="form-grid cols-2">
            <Field label="Zeichensatz">
              <Select value={config.encoding} onChange={(v) => v && changeEncoding(v)} options={[{ value: 'utf-8', label: 'UTF-8' }, { value: 'windows-1252', label: 'Windows-1252 / ISO-8859-1' }]} />
            </Field>
            <Field label="Trennzeichen">
              <Select value={config.delimiter} onChange={(v) => v && setConfig({ delimiter: v })} options={[{ value: ';', label: 'Semikolon ;' }, { value: ',', label: 'Komma ,' }, { value: '\t', label: 'Tabulator' }, { value: '|', label: 'Senkrechter Strich |' }]} />
            </Field>
            <Field label="Kopfzeile ist Zeile">
              <input type="number" min={1} value={config.headerRow + 1} onChange={(e) => setConfig({ headerRow: Math.max(0, Number(e.target.value) - 1) })} />
            </Field>
            <Field label="Dezimaltrennzeichen">
              <Select value={config.decimal} onChange={(v) => v && setConfig({ decimal: v })} options={[{ value: ',', label: 'Komma (1.234,56)' }, { value: '.', label: 'Punkt (1,234.56)' }]} />
            </Field>
          </div>
          <button className="link small" onClick={reanalyze}>Automatische Erkennung neu ausführen</button>
        </div>
      </div>

      <div className="card">
        <h3>Spaltenzuordnung</h3>
        <p className="muted small">Automatisch erkannt – bei Bedarf anpassen. Die Zuordnung wird für Dateien mit gleicher Kopfzeile gespeichert.</p>
        <div className="mapping-grid">
          {FIELDS.map((f) => {
            const cols = config.mapping[f.id] ?? [];
            return (
              <div key={f.id} className={`mapping-row ${cols.length ? 'set' : ''}`}>
                <span className="mapping-label">{f.label}{f.hint && <span className="muted small"> · {f.hint}</span>}</span>
                {f.multi ? (
                  <div className="multi-cols">
                    {cols.map((c, i) => (
                      <Select key={i} value={c} onChange={(v) => setMap(f.id, v == null ? cols.filter((_, j) => j !== i) : cols.map((x, j) => (j === i ? v : x)))} empty="– entfernen –" options={colOptions} />
                    ))}
                    <Select value={null} onChange={(v) => v != null && setMap(f.id, [...cols, v])} empty={cols.length ? '+ weitere Spalte' : '– nicht vorhanden –'} options={colOptions} />
                  </div>
                ) : (
                  <Select value={cols[0] ?? null} onChange={(v) => setMap(f.id, v == null ? [] : [v])} empty="– nicht vorhanden –" options={colOptions} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3>Vorschau</h3>
        {parsed.errors.length > 0 && (
          <div className="callout bad">
            {parsed.errors.slice(0, 8).map((e, i) => <div key={i}>{e.row ? `Zeile ${e.row}: ` : ''}{e.message}</div>)}
            {parsed.errors.length > 8 && <div>… und {parsed.errors.length - 8} weitere</div>}
          </div>
        )}
        {parsed.ok.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Datum</th><th>Zahlungspartner</th><th>IBAN</th><th>Verwendungszweck</th><th>Buchungstext</th><th className="num">Betrag</th></tr></thead>
              <tbody>
                {parsed.ok.slice(0, 12).map((t) => (
                  <tr key={t.row}>
                    <td className="nowrap">{formatDate(t.buchungsdatum)}{t.pending && <Badge tone="warn">vorgemerkt</Badge>}</td>
                    <td>{t.gegen_name}</td>
                    <td className="mono small nowrap">{formatIBAN(t.gegen_iban)}</td>
                    <td className="small"><div className="clamp">{t.verwendungszweck}</div></td>
                    <td className="small">{t.buchungstext}</td>
                    <td className={`num nowrap ${t.betrag_cent < 0 ? 'neg' : 'pos'}`}>{formatEUR(t.betrag_cent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.ok.length > 12 && <p className="muted small">… und {parsed.ok.length - 12} weitere Umsätze</p>}
          </div>
        ) : <Empty>Keine Umsätze erkannt. Bitte Kopfzeile und Spaltenzuordnung prüfen.</Empty>}
      </div>

      <div className="sticky-actions">
        <button onClick={props.onCancel}>Abbrechen</button>
        <button className="primary" disabled={!parsed.ok.length || ownIbans.length > 1} onClick={doImport}>{parsed.ok.length} Umsätze importieren</button>
      </div>
    </>
  );
}

function ImportDone({ r, onAnother }: { r: DoneInfo; onAnother: () => void }) {
  const account = useQuery(() => get<Account>('SELECT * FROM accounts WHERE id = ?', [r.accountId]), [r.accountId]);
  const offen = r.neu - r.auto;
  const checks = useQuery(() => (account ? r.balances.map((b) => ({ ...b, berechnet: balanceAt(account, b.datum) })) : []), [account]);
  const calibratedNow = account ? isCalibrated(account) : false;
  return (
    <div className="card">
      <h3>✓ Import abgeschlossen</h3>
      <div className="stats">
        <Stat label="Neu importiert" value={r.neu} tone="ok" />
        <Stat label="Duplikate übersprungen" value={r.duplikate} />
        <Stat label="Automatisch zugeordnet" value={r.auto} tone="ok" />
        <Stat label="Noch zuzuordnen" value={offen} tone={offen ? 'warn' : 'ok'} />
      </div>
      {account && r.calibrated && (
        <div className="callout ok">
          ✓ Kontostand aus der Datei übernommen: <strong>{formatEUR(r.calibrated.saldo_cent)}</strong> am {formatDate(r.calibrated.datum)}.
          Der Anfangssaldo von „{account.name}" wurde daraus berechnet: {formatEUR(account.anfangssaldo_cent)} zum {formatDate(account.anfangsdatum)}.
        </div>
      )}
      {account && !r.calibrated && checks.length > 0 && (
        <div className={`callout ${checks.every((c) => c.berechnet === c.saldo_cent) ? 'ok' : 'bad'}`}>
          {checks.map((c) => (
            <div key={c.datum}>
              Kontostand am {formatDate(c.datum)} laut Datei {formatEUR(c.saldo_cent)}, berechnet {formatEUR(c.berechnet)}
              {c.berechnet === c.saldo_cent ? ' ✓ stimmt' : ` – Abweichung ${formatEUR((c.berechnet ?? 0) - c.saldo_cent)}. Fehlen ältere Umsätze, oder ist der Anfangssaldo falsch?`}
            </div>
          ))}
          {!checks.every((c) => c.berechnet === c.saldo_cent) && <div className="mt"><CalibrateForm account={account} datum={checks[checks.length - 1].datum} compact /></div>}
        </div>
      )}
      {account && !r.balances.length && !calibratedNow && (
        <div className="callout warn">
          <strong>Bitte einmal den Kontostand eingeben.</strong> Die Datei enthält keinen Kontostand – ohne ihn zeigt die App nur die Summe der Buchungen.
          Trage den Kontostand laut Online-Banking am letzten Buchungstag ({formatDate(r.lastDate)}) oder heute ein; der Anfangssaldo wird daraus zurückgerechnet.
          <div className="mt"><CalibrateForm account={account} datum={r.lastDate} compact /></div>
        </div>
      )}
      {account && !r.balances.length && calibratedNow && (
        <div className="callout">
          Berechneter Kontostand „{account.name}" am {formatDate(r.lastDate)}: <strong>{formatEUR(balanceAt(account, r.lastDate))}</strong> – vergleiche ihn mit deinem Online-Banking.
        </div>
      )}
      {offen > 0 && (
        <div className="callout">
          <strong>Tipp für die Ersteinrichtung:</strong> Unter „Offene nach Zahlungspartner" legst du mit einem Klick pro Zahler neue Mitglieder oder Lieferanten an –
          alle ihre Buchungen werden sofort zugeordnet, künftige automatisch.
          <div className="mt"><button onClick={() => { try { localStorage.setItem('vv:bank.tab', JSON.stringify('einrichtung')); } catch { /* egal */ } navigate('konto'); }}>Offene nach Zahlungspartner einrichten</button></div>
        </div>
      )}
      <div className="actions mt">
        <button onClick={onAnother}>Weitere Datei importieren</button>
        <button className="primary" onClick={() => {
          try {
            localStorage.setItem('vv:bank.status', JSON.stringify(offen ? 'offen' : 'alle'));
            localStorage.setItem('vv:bank.tab', JSON.stringify('buchungen'));
          } catch { /* Filter ist nur Komfort */ }
          navigate('konto'); toast(offen ? 'Offene Buchungen werden angezeigt' : 'Alle Buchungen zugeordnet', 'info'); }}>
          {offen ? `${offen} offene Buchungen zuordnen` : 'Zu den Buchungen'}
        </button>
      </div>
    </div>
  );
}
