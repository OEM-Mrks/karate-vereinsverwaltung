import { useState } from 'react';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { useLocalState, useQuery } from '../hooks';
import { formatDate, todayISO } from '../lib/format';
import { anwesenheitslistePdf, einladungPdf, protokollPdf } from '../lib/pdfDocs';
import { getVereinsdaten } from '../lib/verein';
import { all } from '../db/db';
import type { Audit } from '../db/schema';
import { jahresbericht, pruefungsStand } from '../lib/kennzahlen';
import {
  berichtsjahrVon, ladeTagesordnung, pruefungsjahreVon, punktHinzufuegen, speichereTagesordnung, teilnehmer, tops, verschieben, verwerfeTagesordnung,
  type Tagesordnung, type TopPunkt, type VersammlungOptionen,
} from '../lib/versammlung';
import { PdfPreview } from '../components/PdfPreview';
import { attempt, Badge, Checkbox, DateInput, Empty, Field, PageHeader, Select, Tabs, TextArea, TextInput } from '../components/ui';

const standard = (): VersammlungOptionen => ({
  titel: `Ordentliche Mitgliederversammlung ${new Date().getFullYear()}`,
  datum: todayISO(),
  uhrzeit: '',
  ort: getVereinsdaten().verein_ort,
  anschrift: true,
  telefon: true,
  email: false,
  minderjaehrige: true,
  leerzeilen: 5,
  sortierung: 'name',
});

type Pdf = { title: string; filename: string; build: () => TDocumentDefinitions };

export function MeetingPage() {
  // Einstellungen bleiben im Browser gemerkt, damit die Unterlagen am Versammlungstag nur noch erzeugt werden müssen
  const [gespeichert, setGespeichert] = useLocalState<Partial<VersammlungOptionen>>('versammlung.optionen', {});
  const o: VersammlungOptionen = { ...standard(), ...gespeichert };
  const set = <K extends keyof VersammlungOptionen>(k: K) => (v: VersammlungOptionen[K]) => setGespeichert({ ...gespeichert, [k]: v });
  const [tab, setTab] = useLocalState<'tagesordnung' | 'anwesenheit'>('versammlung.tab', 'tagesordnung');
  const [pdf, setPdf] = useState<Pdf | null>(null);

  return (
    <div className="page">
      <PageHeader
        title="Mitgliederversammlung"
        subtitle="Tagesordnung zusammenstellen, Einladung und Protokollvorlage erzeugen, Anwesenheitsliste zum Unterschreiben."
      />
      <div className="card">
        <div className="card-head">
          <h3>Versammlung</h3>
          {Object.keys(gespeichert).length > 0 && <button className="link small" onClick={() => setGespeichert({})}>Zurücksetzen</button>}
        </div>
        <div className="form-grid">
          <Field label="Bezeichnung" span={2}><TextInput value={o.titel} onChange={set('titel')} /></Field>
          <Field label="Datum" hint="Stichtag für die Anwesenheitsliste"><DateInput value={o.datum} onChange={(v) => set('datum')(v ?? todayISO())} /></Field>
          <Field label="Uhrzeit"><TextInput value={o.uhrzeit} onChange={set('uhrzeit')} placeholder="z. B. 19:00" /></Field>
          <Field label="Ort" span={2}><TextInput value={o.ort} onChange={set('ort')} placeholder="z. B. Vereinsheim, Sporthalle …" /></Field>
          <Field label="Berichtsjahr" hint="Geschäftsjahr für Kassenbericht und Kassenprüfung">
            <TextInput type="number" value={String(berichtsjahrVon(o))} onChange={(v) => set('berichtsjahr')(Number(v) || undefined)} />
          </Field>
        </div>
      </div>

      <div className="toolbar">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'tagesordnung', label: 'Tagesordnung' }, { id: 'anwesenheit', label: 'Anwesenheitsliste' }]} />
      </div>
      {tab === 'tagesordnung'
        ? <TagesordnungEditor o={o} set={set} onPdf={setPdf} />
        : <Anwesenheit o={o} set={set} onPdf={setPdf} />}

      {pdf && <PdfPreview title={pdf.title} filename={pdf.filename} build={pdf.build} onClose={() => setPdf(null)} />}
    </div>
  );
}

// ---------- Tagesordnung ----------

function TagesordnungEditor({ o, set, onPdf }: {
  o: VersammlungOptionen;
  set: <K extends keyof VersammlungOptionen>(k: K) => (v: VersammlungOptionen[K]) => void;
  onPdf: (p: Pdf) => void;
}) {
  const t = useQuery(() => ladeTagesordnung(o.datum), [o.datum]);
  const [neu, setNeu] = useState('');
  const [details, setDetails] = useState<string[]>([]);
  const save = (n: Tagesordnung) => attempt(() => speichereTagesordnung(n));
  const patch = (id: string, p: Partial<TopPunkt>) => save({ ...t, punkte: t.punkte.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const add = () => {
    if (!neu.trim()) return;
    save(punktHinzufuegen(t, neu));
    setNeu('');
  };
  const nummern = new Map(tops(t).map((p) => [p.id, p.nr]));
  // Wählbar: alle Jahre mit Kassenprüfung, Berichtsjahr und Vorjahr (falls über zwei Jahre berichtet wird), bereits gewählte Jahre
  const pruefungen = useQuery(() => all<Audit>('SELECT * FROM audits'));
  const jahre = [...new Set([...pruefungen.map((p) => p.jahr), berichtsjahrVon(o), berichtsjahrVon(o) - 1, ...pruefungsjahreVon(o)])].sort((a, b) => b - a);
  const anzahl = nummern.size;

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Tagesordnung</h3>
            <div className="muted small">Punkte anhaken, die auf die Tagesordnung sollen – die Nummerierung ergibt sich automatisch.</div>
          </div>
          <div className="actions">
            <button disabled={!anzahl} onClick={() => onPdf({ title: 'Einladung', filename: `Einladung_Mitgliederversammlung_${o.datum}.pdf`, build: () => einladungPdf(o, t) })}>Einladung (PDF)</button>
            <button disabled={!anzahl} onClick={() => onPdf({
              title: 'Protokollvorlage',
              filename: `Protokoll_Mitgliederversammlung_${o.datum}.pdf`,
              build: () => protokollPdf(
                o, t,
                o.eckdaten === false ? undefined : jahresbericht(berichtsjahrVon(o)),
                o.eckdaten === false ? [] : pruefungsjahreVon(o).map(pruefungsStand),
              ),
            })}>Protokollvorlage (PDF)</button>
          </div>
        </div>
        <div className="mb">
          <Checkbox
            checked={o.eckdaten !== false}
            onChange={(v) => set('eckdaten')(v)}
            label={<>Eckdaten {berichtsjahrVon(o)} in die Protokollvorlage übernehmen <span className="muted small">(Kontostände, Einnahmen/Ausgaben, Mitgliederzahlen, Beitragsstand, Kassenprüfung – ohne Namen)</span></>}
          />
          {o.eckdaten !== false && (
            <div className="pruefjahre">
              <span className="muted small">Bericht der Kassenprüfer über:</span>
              {jahre.map((j) => {
                const p = pruefungen.find((x) => x.jahr === j);
                const gewaehlt = pruefungsjahreVon(o).includes(j);
                return (
                  <Checkbox
                    key={j}
                    checked={gewaehlt}
                    onChange={(v) => set('pruefungsjahre')(v ? [...pruefungsjahreVon(o), j] : pruefungsjahreVon(o).filter((x) => x !== j))}
                    label={<>{j} <span className="muted small">{p?.pruefdatum ? `geprüft am ${formatDate(p.pruefdatum)}` : p ? 'Prüfung angelegt' : 'keine Prüfung erfasst'}</span></>}
                  />
                );
              })}
            </div>
          )}
        </div>
        <ul className="agenda">
          {t.punkte.map((p, i) => {
            const offen = details.includes(p.id) || !!p.details;
            return (
              <li key={p.id} className={p.aktiv ? '' : 'inaktiv'}>
                <div className="agenda-row">
                  <input type="checkbox" checked={p.aktiv} onChange={(e) => patch(p.id, { aktiv: e.target.checked })} aria-label="Auf die Tagesordnung" />
                  <span className="agenda-nr">{nummern.has(p.id) ? `TOP ${nummern.get(p.id)}` : '–'}</span>
                  <div className="agenda-main">
                    {/* Lange Titel bekommen mehr Platz, die Werkzeuge rutschen dann in die nächste Zeile */}
                    <input className="agenda-titel" style={{ flexBasis: Math.max(320, p.titel.length * 8.5) }} value={p.titel} onChange={(e) => patch(p.id, { titel: e.target.value })} />
                    {!p.standard && <Badge tone="info">eigener Punkt</Badge>}
                    <span className="agenda-tools">
                      <label className="checkbox small" title="Im Protokoll Felder für Ja/Nein/Enthaltung">
                        <input type="checkbox" checked={p.abstimmung} onChange={(e) => patch(p.id, { abstimmung: e.target.checked })} /> <span>Abstimmung</span>
                      </label>
                      {!offen && <button className="link small" onClick={() => setDetails([...details, p.id])}>+ Erläuterung</button>}
                      <button className="icon-btn" disabled={i === 0} onClick={() => save(verschieben(t, p.id, -1))} aria-label="Nach oben">↑</button>
                      <button className="icon-btn" disabled={i === t.punkte.length - 1} onClick={() => save(verschieben(t, p.id, 1))} aria-label="Nach unten">↓</button>
                      {!p.standard && <button className="icon-btn" onClick={() => confirm(`„${p.titel}" entfernen?`) && save({ ...t, punkte: t.punkte.filter((x) => x.id !== p.id) })} aria-label="Entfernen">✕</button>}
                    </span>
                  </div>
                </div>
                {offen && (
                  <textarea
                    className="agenda-details"
                    rows={1}
                    value={p.details}
                    placeholder="Erläuterung, z. B. zu wählende Ämter oder vorgeschlagene Beitragshöhe"
                    onChange={(e) => patch(p.id, { details: e.target.value })}
                  />
                )}
              </li>
            );
          })}
        </ul>
        <div className="agenda-add">
          <input value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Eigenen Punkt hinzufügen, z. B. „Anschaffung neuer Matten“" />
          <button className="primary" disabled={!neu.trim()} onClick={add}>+ Hinzufügen</button>
        </div>
      </div>

      <div className="card">
        <h3>Einladung</h3>
        <div className="form-grid">
          <Field label="Einleitungstext (nach „Liebe Mitglieder,“)" span={4}>
            <TextArea value={t.einladung} onChange={(v) => save({ ...t, einladung: v })} rows={2} />
          </Field>
          <Field label="Frist für Anträge" hint="leer = kein Hinweis in der Einladung">
            <DateInput value={t.antragsfrist} onChange={(v) => save({ ...t, antragsfrist: v })} />
          </Field>
        </div>
        <div className="actions mt">
          <span className="muted small">Tagesordnung wird in der Vereinsdatenbank gespeichert.</span>
          <span className="spacer" />
          <button className="link small" onClick={() => confirm('Tagesordnung auf die Standardpunkte zurücksetzen? Eigene Punkte gehen verloren.') && attempt(() => verwerfeTagesordnung(), 'Zurückgesetzt')}>Auf Standard zurücksetzen</button>
        </div>
      </div>
    </>
  );
}

// ---------- Anwesenheitsliste ----------

function Anwesenheit({ o, set, onPdf }: {
  o: VersammlungOptionen;
  set: <K extends keyof VersammlungOptionen>(k: K) => (v: VersammlungOptionen[K]) => void;
  onPdf: (p: Pdf) => void;
}) {
  const liste = useQuery(() => teilnehmer(o.datum, o.sortierung), [o.datum, o.sortierung]);
  const minderjaehrig = liste.filter((m) => m.minderjaehrig).length;
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h3>Anwesenheitsliste</h3>
          <button className="primary" disabled={!liste.length} onClick={() => onPdf({
            title: `Anwesenheitsliste ${formatDate(o.datum)}`,
            filename: `Anwesenheitsliste_Mitgliederversammlung_${o.datum}.pdf`,
            build: () => anwesenheitslistePdf(o, liste),
          })}>Anwesenheitsliste (PDF)</button>
        </div>
        <div className="form-grid">
          <Field label="Sortierung">
            <Select value={o.sortierung} onChange={(v) => set('sortierung')(v ?? 'name')} options={[{ value: 'name', label: 'nach Nachname' }, { value: 'nr', label: 'nach Mitgliedsnummer' }]} />
          </Field>
          <Field label="Leerzeilen für Gäste">
            <TextInput type="number" value={String(o.leerzeilen)} onChange={(v) => set('leerzeilen')(Math.max(0, Math.min(50, Number(v) || 0)))} />
          </Field>
          <div className="span-4 actions">
            <Checkbox checked={o.anschrift} onChange={set('anschrift')} label="Anschrift" />
            <Checkbox checked={o.telefon} onChange={set('telefon')} label="Telefon" />
            <Checkbox checked={o.email} onChange={set('email')} label="E-Mail" />
            <Checkbox checked={o.minderjaehrige} onChange={set('minderjaehrige')} label="Minderjährige kennzeichnen" />
          </div>
        </div>
        <p className="muted small mt">
          Die Liste enthält personenbezogene Daten – nur für die Versammlung verwenden und danach mit dem Protokoll aufbewahren.
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>{liste.length} aktive Mitglieder am {formatDate(o.datum)}</h3>
          {o.minderjaehrige && minderjaehrig > 0 && <span className="muted small">davon {minderjaehrig} minderjährig</span>}
        </div>
        {liste.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nr.</th><th>Name</th>
                  {o.anschrift && <th>Anschrift</th>}
                  {o.telefon && <th>Telefon</th>}
                  {o.email && <th>E-Mail</th>}
                </tr>
              </thead>
              <tbody>
                {liste.map((m, i) => (
                  <tr key={m.id}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <strong>{m.nachname}, {m.vorname}</strong>
                      {m.mitgliedsnr && <span className="muted small"> · {m.mitgliedsnr}</span>}
                      {o.minderjaehrige && m.minderjaehrig && <> <Badge tone="muted">minderjährig</Badge></>}
                    </td>
                    {o.anschrift && <td className="small">{[m.strasse, `${m.plz ?? ''} ${m.ort ?? ''}`.trim()].filter(Boolean).join(', ') || <span className="muted">–</span>}</td>}
                    {o.telefon && <td className="small">{[m.mobil, m.telefon].filter(Boolean).join(' · ') || <span className="muted">–</span>}</td>}
                    {o.email && <td className="small">{m.email || <span className="muted">–</span>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Am {formatDate(o.datum)} gibt es keine aktiven Mitglieder.</Empty>}
      </div>
    </>
  );
}
