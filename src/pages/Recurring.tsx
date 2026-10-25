import { Fragment, useState } from 'react';
import { get } from '../db/db';
import type { Recurring, Rhythmus } from '../db/schema';
import { useLocalState, useQuery } from '../hooks';
import { formatDate, formatEUR, todayISO } from '../lib/format';
import { categoryOptions, partnerOptions } from '../lib/lookups';
import { EIGENBELEG_GRUENDE, eigenbelegAusBuchung, eigenbelegSpeichern, type Eigenbeleg } from '../lib/eigenbeleg';
import {
  abgleichSeitBeginn, abhaken, abhakenRueckgaengig, automatischAbhaken, belegZuZahlung, betragFuer, deleteRecurring, faelligkeiten, MONATE, RHYTHMEN, recurringList, saveRecurring,
  vorschlaege, type Faelligkeit, type RecurringView, type Vorschlag,
} from '../lib/recurring';
import { DocViewer } from '../components/Docs';
import { EigenbelegDialog } from '../components/Eigenbeleg';
import { attempt, Badge, Checkbox, DateInput, Empty, Field, Modal, MoneyInput, PageHeader, Select, Stat, TextArea, TextInput, toast, YearSelect } from '../components/ui';

const STATUS: Record<Faelligkeit['status'], { tone: 'ok' | 'warn' | 'info' | 'muted'; text: string }> = {
  erledigt: { tone: 'ok', text: 'erledigt' },
  ueberfaellig: { tone: 'warn', text: 'überfällig' },
  faellig: { tone: 'info', text: 'diesen Monat fällig' },
  offen: { tone: 'muted', text: 'offen' },
};

export function RecurringPage() {
  const [year, setYear] = useLocalState('year', new Date().getFullYear());
  const [edit, setEdit] = useState<Partial<RecurringView> | null>(null);
  const [check, setCheck] = useState<{ f: Faelligkeit; t: Vorschlag | null } | null>(null);
  const [eigen, setEigen] = useState<{ f: Faelligkeit; initial: Eigenbeleg } | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [nurOffene, setNurOffene] = useLocalState('wiederkehrend.nurOffene', false);
  const liste = useQuery(() => recurringList());
  const due = useQuery(() => faelligkeiten(year).map((f) => ({ f, vorschlag: f.zahlung ? null : vorschlaege(f)[0] ?? null })), [year]);

  const summe = due.reduce((s, d) => s + (d.f.betrag_cent ?? 0), 0);
  const erledigt = due.filter((d) => d.f.zahlung);
  const ueberfaellig = due.filter((d) => d.f.status === 'ueberfaellig');

  const eigenFuer = (f: Faelligkeit) => {
    const z = f.zahlung!;
    const grund = f.r.eigenbeleg_grund ?? '';
    const initial = z.transaction_id ? eigenbelegAusBuchung(z.transaction_id, grund) : manuellerEigenbeleg(f, z.bezahlt_am ?? todayISO(), z.betrag_cent ?? f.betrag_cent ?? 0, grund);
    setEigen({ f, initial });
  };

  return (
    <div className="page">
      <PageHeader
        title="Wiederkehrende Zahlungen"
        subtitle="Verbandsbeiträge, Versicherungen und andere regelmäßige Zahlungen – Betrag ab Jahr festlegen, jedes Jahr abhaken."
        actions={<button className="primary" onClick={() => setEdit({ rhythmus: 'jaehrlich', richtung: 'aus', faellig_monat: 1, aktiv: 1, amounts: [] })}>+ Zahlung anlegen</button>}
      />
      <div className="toolbar">
        <YearSelect value={year} onChange={setYear} />
        {due.some((d) => !d.f.zahlung) && (
          <button onClick={() => {
            let n = 0;
            attempt(() => { for (const r of liste) n += automatischAbhaken(r.id, year); });
            toast(n ? `${n} ${n === 1 ? 'Fälligkeit' : 'Fälligkeiten'} mit passender Buchung abgehakt` : 'Keine Buchung mit genau passendem Betrag gefunden', n ? 'ok' : 'info');
          }}>Mit Buchungen abgleichen</button>
        )}
      </div>
      {due.length > 0 && (
        <div className="stats">
          <Stat label={`Fällig ${year}`} value={formatEUR(summe)} sub={`${due.length} ${due.length === 1 ? 'Zahlung' : 'Zahlungen'}`} />
          <Stat label="Erledigt" value={`${erledigt.length} von ${due.length}`} tone={erledigt.length === due.length ? 'ok' : undefined} />
          <Stat label="Überfällig" value={ueberfaellig.length} tone={ueberfaellig.length ? 'warn' : 'ok'}
            sub={ueberfaellig.length ? formatEUR(ueberfaellig.reduce((s, d) => s + (d.f.betrag_cent ?? 0), 0)) : 'nichts offen'} />
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Fälligkeiten {year}</h3>
          {erledigt.length > 0 && <Checkbox checked={nurOffene} onChange={setNurOffene} label={`Erledigte ausblenden (${erledigt.length})`} />}
        </div>
        {due.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Fällig</th><th>Zahlung</th><th className="num">Betrag</th><th>Status</th><th>Buchung / Beleg</th><th /></tr></thead>
              <tbody>
                {due.filter((d) => !nurOffene || !d.f.zahlung).map(({ f, vorschlag }) => {
                  const z = f.zahlung;
                  const st = STATUS[f.status];
                  return (
                    <tr key={`${f.r.id}-${f.periode}`}>
                      <td>{MONATE[f.monat - 1]}</td>
                      <td>
                        <strong>{f.r.name}</strong>
                        <div className="muted small">{[f.r.partner, f.r.kategorie].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className={`num ${f.r.richtung === 'aus' ? 'neg' : ''}`}>{f.betrag_cent != null ? formatEUR(f.r.richtung === 'aus' ? -f.betrag_cent : f.betrag_cent) : '–'}</td>
                      <td>
                        <Badge tone={st.tone}>{st.text}</Badge>
                        {z?.bezahlt_am && <div className="muted small">am {formatDate(z.bezahlt_am)}</div>}
                      </td>
                      <td className="small">
                        {z ? (
                          <>
                            {z.transaction_id
                              ? <div><a href={`#/konto/${z.transaction_id}`}>Buchung ansehen</a>{z.betrag_cent != null && f.betrag_cent != null && z.betrag_cent !== f.betrag_cent && <> · <Badge tone="warn" title="Betrag weicht von der Tabelle ab">{formatEUR(z.betrag_cent)}</Badge></>}</div>
                              : <div className="muted">ohne Buchung abgehakt</div>}
                            {z.document_id
                              ? <button className="link" onClick={() => setView(z.document_id!)}>📄 Eigenbeleg</button>
                              : <button className="link" onClick={() => eigenFuer(f)}>✎ Eigenbeleg erstellen</button>}
                          </>
                        ) : vorschlag ? (
                          <span>
                            Passende Buchung: {formatDate(vorschlag.buchungsdatum)} · {formatEUR(vorschlag.betrag_cent)}
                            {!vorschlag.exakt && <> <Badge tone="warn">anderer Betrag</Badge></>}
                          </span>
                        ) : <span className="muted">keine passende Buchung gefunden</span>}
                      </td>
                      <td className="actions-cell">
                        {z
                          ? <button className="link small" onClick={() => confirm(`Abhaken von „${f.r.name}" ${year} rückgängig machen?${z.document_id ? ' Der Eigenbeleg bleibt erhalten.' : ''}`) && attempt(() => abhakenRueckgaengig(z.id), 'Zurückgesetzt')}>rückgängig</button>
                          : <button className={vorschlag ? 'primary' : ''} onClick={() => setCheck({ f, t: vorschlag })}>✓ Abhaken</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{liste.length ? `In ${year} ist keine wiederkehrende Zahlung fällig.` : 'Noch keine wiederkehrenden Zahlungen angelegt – z. B. den Jahresbeitrag an den Dachverband oder Landesverband.'}</Empty>
        )}
      </div>

      {due.length > 0 && <Vorschau jahr={year} due={due.map((d) => d.f)} />}

      {liste.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Alle wiederkehrenden Zahlungen</h3><span className="muted small">Zum Bearbeiten anklicken</span></div>
          <table className="table clickable-rows">
            <thead><tr><th>Bezeichnung</th><th>Zahlungspartner</th><th>Rhythmus</th><th>Beträge</th><th /></tr></thead>
            <tbody>
              {liste.map((r) => (
                <tr key={r.id} onClick={() => setEdit(r)}>
                  <td><strong>{r.name}</strong><div className="muted small">{r.kategorie}</div></td>
                  <td>{r.partner ?? '–'}</td>
                  <td>{RHYTHMEN.find((x) => x.id === r.rhythmus)?.label}, ab {MONATE[r.faellig_monat - 1]}{r.bis_jahr ? <div className="muted small">bis {r.bis_jahr}</div> : null}</td>
                  <td className="small">{r.amounts.map((a) => <div key={a.ab_jahr}>ab {a.ab_jahr}: <strong>{formatEUR(a.betrag_cent)}</strong></div>)}</td>
                  <td>
                    {!r.aktiv && <Badge tone="muted">inaktiv</Badge>}
                    {r.eigenbeleg ? <Badge tone="info" title="Beim Abhaken wird ein Eigenbeleg erzeugt">Eigenbeleg</Badge> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && <RecurringDialog r={edit} onClose={() => setEdit(null)} />}
      {check && <AbhakenDialog f={check.f} vorschlag={check.t} onClose={() => setCheck(null)} />}
      {eigen && <EigenbelegDialog initial={eigen.initial} onClose={() => setEigen(null)} onCreated={(id) => belegZuZahlung(eigen.f.zahlung!.id, id)} />}
      {view && <DocViewer id={view} onClose={() => setView(null)} />}
    </div>
  );
}

/** Monatsvorschau: was ist laut Tabelle wann fällig, was ist schon erledigt, was kommt noch. */
function Vorschau({ jahr, due }: { jahr: number; due: Faelligkeit[] }) {
  const betrag = (f: Faelligkeit) => {
    const b = f.zahlung?.betrag_cent ?? f.betrag_cent ?? 0;
    return f.r.richtung === 'aus' ? -b : b;
  };
  const monate = MONATE.map((_, i) => {
    const m = due.filter((f) => f.monat === i + 1);
    return { erwartet: m.reduce((s, f) => s + betrag(f), 0), offen: m.filter((f) => !f.zahlung).reduce((s, f) => s + betrag(f), 0) };
  });
  const summe = (k: 'erwartet' | 'offen') => monate.reduce((s, m) => s + m[k], 0);
  const zelle = (c: number) => <td className={`num nowrap ${c < 0 ? 'neg' : c > 0 ? 'pos' : 'muted'}`}>{c ? formatEUR(c) : '–'}</td>;
  return (
    <div className="card">
      <div className="card-head">
        <h3>Vorschau {jahr}</h3>
        <span className="muted small">Noch offen: <strong>{formatEUR(summe('offen'))}</strong> von {formatEUR(summe('erwartet'))}</span>
      </div>
      <div className="table-wrap">
        <table className="table compact forecast">
          <thead><tr><th />{MONATE.map((m) => <th key={m} className="num">{m.slice(0, 3)}</th>)}<th className="num">Jahr</th></tr></thead>
          <tbody>
            <tr><th>Laut Tabelle</th>{monate.map((m, i) => <Fragment key={i}>{zelle(m.erwartet)}</Fragment>)}{zelle(summe('erwartet'))}</tr>
            <tr><th>Noch offen</th>{monate.map((m, i) => <Fragment key={i}>{zelle(m.offen)}</Fragment>)}{zelle(summe('offen'))}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Eigenbeleg ohne Kontobewegung (z. B. bar bezahlt oder Umsätze noch nicht importiert). */
function manuellerEigenbeleg(f: Faelligkeit, datum: string, betrag: number, grund: string): Eigenbeleg {
  return {
    datum,
    betrag_cent: f.r.richtung === 'aus' ? -Math.abs(betrag) : Math.abs(betrag),
    partner: f.r.partner ?? '',
    iban: null,
    zweck: `${f.r.name} ${f.jahr}`,
    kategorie: f.r.kategorie,
    zahlungsart: null,
    grund,
    transaction_id: null,
    partner_id: f.r.partner_id,
  };
}

function AbhakenDialog({ f, vorschlag, onClose }: { f: Faelligkeit; vorschlag: Vorschlag | null; onClose: () => void }) {
  // Einmal beim Öffnen ermitteln – nach dem Abhaken ist die Buchung vergeben und fiele sonst aus der Liste
  const [kandidaten] = useState(() => vorschlaege(f));
  const [txId, setTxId] = useState<number | null>(vorschlag?.id ?? null);
  const gewaehlt = kandidaten.find((t) => t.id === txId) ?? null;
  const [datum, setDatum] = useState<string | null>(vorschlag?.buchungsdatum ?? todayISO());
  const [betrag, setBetrag] = useState<number | null>(vorschlag ? Math.abs(vorschlag.betrag_cent) : f.betrag_cent);
  const [zuordnen, setZuordnen] = useState(true);
  const [mitBeleg, setMitBeleg] = useState(!!f.r.eigenbeleg);
  const [grund, setGrund] = useState(f.r.eigenbeleg_grund ?? EIGENBELEG_GRUENDE[0]);
  const [notiz, setNotiz] = useState('');
  const [busy, setBusy] = useState(false);
  const unzugeordnet = gewaehlt ? !get('SELECT 1 FROM allocations WHERE transaction_id = ?', [gewaehlt.id]) : false;
  const hatBeleg = gewaehlt ? !!get('SELECT 1 FROM documents WHERE transaction_id = ?', [gewaehlt.id]) : false;

  const waehle = (t: Vorschlag | null) => {
    setTxId(t?.id ?? null);
    if (t) {
      setDatum(t.buchungsdatum);
      setBetrag(Math.abs(t.betrag_cent));
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const id = abhaken({ recurring_id: f.r.id, jahr: f.jahr, periode: f.periode, bezahlt_am: datum, betrag_cent: betrag, transaction_id: txId, notiz, zuordnen });
      if (mitBeleg) {
        const e = txId ? eigenbelegAusBuchung(txId, grund) : manuellerEigenbeleg(f, datum ?? todayISO(), betrag ?? 0, grund);
        belegZuZahlung(id, await eigenbelegSpeichern(e));
        toast('Abgehakt und Eigenbeleg erstellt');
      } else toast('Abgehakt');
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'bad');
      setBusy(false);
    }
  };

  return (
    <Modal
      size="wide"
      title={`${f.r.name} ${f.jahr} abhaken`}
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Abbrechen</button>
        <button className="primary" disabled={busy || !datum || (mitBeleg && !grund.trim())} onClick={() => void save()}>{busy ? 'Wird gespeichert …' : mitBeleg ? 'Abhaken & Eigenbeleg erstellen' : 'Abhaken'}</button>
      </>}
    >
      <p className="muted small">
        Laut Tabelle {f.betrag_cent != null ? formatEUR(f.betrag_cent) : 'kein Betrag'} · fällig im {MONATE[f.monat - 1]} {f.jahr}
        {f.r.partner ? ` · an ${f.r.partner}` : ''}
      </p>
      <h3>Zugehörige Buchung</h3>
      <div className="radio-list">
        {kandidaten.map((t) => (
          <label key={t.id} className="checkbox">
            <input type="radio" checked={txId === t.id} onChange={() => waehle(t)} />
            <span>
              {formatDate(t.buchungsdatum)} · <strong>{formatEUR(t.betrag_cent)}</strong> · {t.gegen_name}
              {t.exakt ? <> <Badge tone="ok">Betrag passt</Badge></> : null}
              <div className="muted small clamp">{t.verwendungszweck}</div>
            </span>
          </label>
        ))}
        <label className="checkbox">
          <input type="radio" checked={txId === null} onChange={() => waehle(null)} />
          <span>Ohne Buchung abhaken <span className="muted small">(z. B. Umsätze noch nicht importiert)</span></span>
        </label>
      </div>
      {!kandidaten.length && <p className="muted small">Keine passende Kontobewegung gefunden{f.r.partner ? ` (gesucht: ${f.r.partner}, IBAN oder Name)` : ' – für Vorschläge einen Zahlungspartner hinterlegen'}.</p>}
      <div className="form-grid cols-2 mt">
        <Field label="Bezahlt am"><DateInput value={datum} onChange={setDatum} /></Field>
        <Field label="Betrag"><MoneyInput value={betrag} onChange={setBetrag} /></Field>
        <Field label="Notiz" span={2}><TextInput value={notiz} onChange={setNotiz} /></Field>
      </div>
      {gewaehlt && unzugeordnet && (f.r.category_id || f.r.partner_id) && (
        <Checkbox checked={zuordnen} onChange={setZuordnen} label={<>Buchung gleich zuordnen: {[f.r.kategorie, f.r.partner].filter(Boolean).join(' · ')}</>} />
      )}
      <div className="callout">
        <Checkbox checked={mitBeleg} onChange={setMitBeleg} label={<>Eigenbeleg erzeugen{hatBeleg && <span className="muted"> (die Buchung hat schon einen Beleg)</span>}</>} />
        {mitBeleg && (
          <div className="mt">
            <Field label="Grund für den Eigenbeleg"><TextArea value={grund} onChange={setGrund} rows={2} /></Field>
          </div>
        )}
      </div>
    </Modal>
  );
}

type AmountRow = { key: number; ab_jahr: number; betrag_cent: number | null };

export function RecurringDialog({ r, onClose, onSaved, hinweis }: {
  r: Partial<RecurringView>;
  onClose: () => void;
  /** Nach dem Speichern, z. B. um die auslösende Buchung abzuhaken */
  onSaved?: (id: number) => void;
  hinweis?: string;
}) {
  const [v, setV] = useState<Partial<Recurring>>(r);
  const [rows, setRows] = useState<AmountRow[]>(() =>
    r.amounts?.length ? r.amounts.map((a) => ({ key: a.id, ab_jahr: a.ab_jahr, betrag_cent: a.betrag_cent })) : [{ key: -1, ab_jahr: new Date().getFullYear(), betrag_cent: null }]);
  const [seq, setSeq] = useState(1e9);
  const set = <K extends keyof Recurring>(k: K) => (x: Recurring[K] | null) => setV({ ...v, [k]: x });
  const partners = useQuery(() => partnerOptions());
  const cats = useQuery(() => categoryOptions());
  const jahr = new Date().getFullYear();
  const aktuell = betragFuer(rows.filter((x) => x.betrag_cent != null) as { ab_jahr: number; betrag_cent: number }[], jahr);

  const choosePartner = (id: number | null) => {
    const p = id ? get<{ name: string; default_category_id: number | null }>('SELECT name, default_category_id FROM partners WHERE id = ?', [id]) : undefined;
    setV({ ...v, partner_id: id, category_id: v.category_id ?? p?.default_category_id ?? null, name: v.name || (p ? `${p.name} – Jahresbeitrag` : v.name) });
  };
  const save = () => {
    let id = 0;
    const ok = attempt(() => {
      id = saveRecurring(v, rows.map((x) => ({ ab_jahr: Number(x.ab_jahr), betrag_cent: x.betrag_cent ?? 0 })));
    }, 'Gespeichert');
    if (!ok) return;
    if (onSaved) onSaved(id);
    else if (!r.id) {
      const n = abgleichSeitBeginn(id);
      if (n) toast(n === 1 ? '1 passende Buchung automatisch abgehakt' : `${n} passende Buchungen automatisch abgehakt`, 'info');
    }
    onClose();
  };
  const remove = () => confirm(`„${r.name}" mit allen abgehakten Jahren löschen? Buchungen und Belege bleiben erhalten.`) && attempt(() => deleteRecurring(r.id!), 'Gelöscht') && onClose();

  return (
    <Modal
      size="wide"
      title={r.id ? `${r.name} bearbeiten` : 'Wiederkehrende Zahlung anlegen'}
      onClose={onClose}
      footer={<>{r.id && <button className="danger-outline" onClick={remove}>Löschen</button>}<button onClick={onClose}>Abbrechen</button><button className="primary" disabled={!v.name?.trim()} onClick={save}>Speichern</button></>}
    >
      {hinweis && <p className="muted small">{hinweis}</p>}
      <div className="form-grid">
        <Field label="Zahlungspartner" span={2} hint="Für den automatischen Abgleich mit den Kontobewegungen">
          <Select value={v.partner_id ?? null} onChange={choosePartner} empty="– keiner –" options={partners} />
        </Field>
        <Field label="Bezeichnung" span={2}><TextInput value={v.name} onChange={set('name')} placeholder="z. B. Jahresbeitrag Dachverband" /></Field>
        <Field label="Kategorie" span={2}><Select value={v.category_id ?? null} onChange={set('category_id')} empty="– wählen –" options={cats} /></Field>
        <Field label="Art">
          <Select value={v.richtung ?? 'aus'} onChange={(x) => set('richtung')(x ?? 'aus')} options={[{ value: 'aus', label: 'Ausgabe (wir zahlen)' }, { value: 'ein', label: 'Einnahme (wir erhalten)' }]} />
        </Field>
        <Field label="Rhythmus">
          <Select<Rhythmus> value={v.rhythmus ?? 'jaehrlich'} onChange={(x) => set('rhythmus')(x ?? 'jaehrlich')} options={RHYTHMEN.map((x) => ({ value: x.id, label: x.label }))} />
        </Field>
        <Field label={v.rhythmus && v.rhythmus !== 'jaehrlich' ? 'Erste Fälligkeit im' : 'Fällig im'}>
          <Select value={v.faellig_monat ?? 1} onChange={(x) => set('faellig_monat')(x ?? 1)} options={MONATE.map((m, i) => ({ value: i + 1, label: m }))} />
        </Field>
        <Field label="Letztes Jahr" hint="leer = unbefristet">
          <TextInput type="number" value={v.bis_jahr ? String(v.bis_jahr) : ''} onChange={(x) => set('bis_jahr')(x ? Number(x) : null)} placeholder="unbefristet" />
        </Field>

        <h3 className="span-4">Betrag je Fälligkeit</h3>
        <div className="span-4">
          <table className="table compact">
            <thead><tr><th>ab Jahr</th><th>Betrag</th><th /></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.key}>
                  <td style={{ width: 140 }}><TextInput type="number" value={String(x.ab_jahr)} onChange={(y) => setRows(rows.map((z) => (z.key === x.key ? { ...z, ab_jahr: Number(y) } : z)))} /></td>
                  <td style={{ width: 180 }}><MoneyInput value={x.betrag_cent} onChange={(y) => setRows(rows.map((z) => (z.key === x.key ? { ...z, betrag_cent: y } : z)))} /></td>
                  <td>{rows.length > 1 && <button className="link danger" onClick={() => setRows(rows.filter((z) => z.key !== x.key))}>entfernen</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions mt">
            <button className="link" onClick={() => {
              const last = Math.max(...rows.map((x) => x.ab_jahr), jahr - 1);
              setRows([...rows, { key: seq, ab_jahr: last + 1, betrag_cent: rows[rows.length - 1]?.betrag_cent ?? null }]);
              setSeq(seq + 1);
            }}>+ Neuer Betrag ab weiterem Jahr</button>
            <span className="muted small">Ein Betrag gilt so lange, bis ein Eintrag für ein späteres Jahr folgt.{aktuell != null ? ` Aktuell (${jahr}): ${formatEUR(aktuell)}.` : ''}</span>
          </div>
        </div>

        <h3 className="span-4">Beleg</h3>
        <div className="span-4">
          <Checkbox checked={!!v.eigenbeleg} onChange={(x) => setV({ ...v, eigenbeleg: x ? 1 : 0, eigenbeleg_grund: v.eigenbeleg_grund ?? EIGENBELEG_GRUENDE[0] })} label="Es gibt keine Rechnung – beim Abhaken automatisch einen Eigenbeleg erzeugen" />
        </div>
        {!!v.eigenbeleg && (
          <Field label="Begründung für den Eigenbeleg" span={4}>
            <TextArea value={v.eigenbeleg_grund} onChange={set('eigenbeleg_grund')} rows={2} />
          </Field>
        )}
        <Field label="Notiz" span={4}><TextArea value={v.notiz} onChange={set('notiz')} rows={2} /></Field>
        {r.id && <div className="span-4"><Checkbox checked={v.aktiv !== 0} onChange={(x) => set('aktiv')(x ? 1 : 0)} label="Aktiv (erscheint in den Fälligkeiten)" /></div>}
      </div>
    </Modal>
  );
}
