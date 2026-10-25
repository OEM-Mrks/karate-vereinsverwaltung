import { useState } from 'react';
import { useLocalState, useQuery } from '../hooks';
import { formatDate, todayISO } from '../lib/format';
import { anwesenheitslistePdf } from '../lib/pdfDocs';
import { getVereinsdaten } from '../lib/verein';
import { teilnehmer, type VersammlungOptionen } from '../lib/versammlung';
import { PdfPreview } from '../components/PdfPreview';
import { Badge, Checkbox, DateInput, Empty, Field, PageHeader, Select, TextInput } from '../components/ui';

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

export function MeetingPage() {
  // Einstellungen bleiben im Browser gemerkt, damit die Liste am Versammlungstag nur noch erzeugt werden muss
  const [gespeichert, setGespeichert] = useLocalState<Partial<VersammlungOptionen>>('versammlung.optionen', {});
  const o: VersammlungOptionen = { ...standard(), ...gespeichert };
  const set = <K extends keyof VersammlungOptionen>(k: K) => (v: VersammlungOptionen[K]) => setGespeichert({ ...gespeichert, [k]: v });
  const [pdf, setPdf] = useState(false);
  const liste = useQuery(() => teilnehmer(o.datum, o.sortierung), [o.datum, o.sortierung]);
  const minderjaehrig = liste.filter((m) => m.minderjaehrig).length;

  return (
    <div className="page">
      <PageHeader
        title="Mitgliederversammlung"
        subtitle="Anwesenheitsliste aller am Versammlungstag aktiven Mitglieder – als PDF zum Ausdrucken und Unterschreiben."
        actions={<button className="primary" disabled={!liste.length} onClick={() => setPdf(true)}>Anwesenheitsliste (PDF)</button>}
      />
      <div className="card">
        <div className="card-head">
          <h3>Versammlung</h3>
          {Object.keys(gespeichert).length > 0 && <button className="link small" onClick={() => setGespeichert({})}>Zurücksetzen</button>}
        </div>
        <div className="form-grid">
          <Field label="Bezeichnung" span={2}><TextInput value={o.titel} onChange={set('titel')} /></Field>
          <Field label="Datum" hint="Stichtag: wer an diesem Tag Mitglied ist"><DateInput value={o.datum} onChange={(v) => set('datum')(v ?? todayISO())} /></Field>
          <Field label="Uhrzeit"><TextInput value={o.uhrzeit} onChange={set('uhrzeit')} placeholder="z. B. 19:00" /></Field>
          <Field label="Ort" span={2}><TextInput value={o.ort} onChange={set('ort')} placeholder="z. B. Vereinsheim, Sporthalle …" /></Field>
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

      {pdf && (
        <PdfPreview
          title={`Anwesenheitsliste ${formatDate(o.datum)}`}
          filename={`Anwesenheitsliste_Mitgliederversammlung_${o.datum}.pdf`}
          build={() => anwesenheitslistePdf(o, liste)}
          onClose={() => setPdf(false)}
        />
      )}
    </div>
  );
}
