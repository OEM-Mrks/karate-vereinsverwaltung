import { useEffect, useRef, useState } from 'react';
import type { Audit } from '../db/schema';
import { downloadBlob } from '../db/storage';
import { useLocalState, useQuery } from '../hooks';
import {
  auditItems, auditSummary, clearCheck, exportProtocol, getAudit, importProtocol, setAnswer, setCheck, startAudit, updateAudit,
  type AuditItem, type AuditSummary,
} from '../lib/audit';
import { documentBlobUrl } from '../lib/docs';
import { formatDate, formatEUR, formatIBAN, todayISO } from '../lib/format';
import { auditPdf } from '../lib/pdfDocs';
import { PdfPreview } from '../components/PdfPreview';
import { getVereinsdaten, namesFor } from '../lib/verein';
import { attempt, Badge, Checkbox, DateInput, Empty, Field, PageHeader, Select, Stat, Tabs, TextArea, TextInput, toast, YearSelect } from '../components/ui';

type Tab = 'pruefen' | 'liste' | 'bericht';

export function AuditPage() {
  const [year, setYear] = useLocalState('audit.year', new Date().getFullYear() - 1);
  const audit = useQuery(() => getAudit(year), [year]);
  return (
    <div className="page">
      <PageHeader
        title={`Kassenprüfung ${year}`}
        subtitle="Buchungen und digitale Belege gemeinsam am Bildschirm durchgehen, abhaken, Rückfragen klären – und den Bericht zum Unterschreiben drucken."
        actions={<YearSelect value={year} onChange={setYear} />}
      />
      {audit ? <AuditWorkspace audit={audit} /> : <StartAudit year={year} />}
    </div>
  );
}

function StartAudit({ year }: { year: number }) {
  // Kassenprüfer/innen und Ort aus „Verein & Vorstand“ vorbelegen
  const [v, setV] = useState(() => ({ pruefer: namesFor('Kassenprüfer/in').join('\n'), pruefdatum: todayISO(), ort: getVereinsdaten().verein_ort, umfang: 'alle' as Audit['umfang'] }));
  return (
    <div className="card">
      <h3>Prüfung für {year} beginnen</h3>
      <div className="form-grid cols-2">
        <Field label="Kassenprüfer/innen" hint="Ein Name pro Zeile" span={2}><TextArea value={v.pruefer} onChange={(x) => setV({ ...v, pruefer: x })} rows={2} /></Field>
        <Field label="Prüfungsdatum"><DateInput value={v.pruefdatum} onChange={(x) => setV({ ...v, pruefdatum: x ?? todayISO() })} /></Field>
        <Field label="Ort"><TextInput value={v.ort} onChange={(x) => setV({ ...v, ort: x })} /></Field>
        <Field label="Prüfungsumfang" span={2}>
          <Select value={v.umfang} onChange={(x) => setV({ ...v, umfang: (x ?? 'alle') as Audit['umfang'] })} options={[
            { value: 'alle', label: 'Alle Buchungen des Jahres' },
            { value: 'ausgaben', label: 'Nur Ausgaben' },
            { value: 'belegpflichtig', label: 'Nur belegpflichtige Buchungen bzw. Buchungen mit Beleg' },
          ]} />
        </Field>
      </div>
      <button className="primary mt" onClick={() => attempt(() => startAudit(year, v), 'Kassenprüfung angelegt')}>Prüfung beginnen</button>
    </div>
  );
}

function AuditWorkspace({ audit }: { audit: Audit }) {
  const [tab, setTab] = useLocalState<Tab>('audit.tab', 'pruefen');
  const [jumpTo, setJumpTo] = useState<number | null>(null);
  const items = useQuery(() => auditItems(audit), [audit]);
  const summary = useQuery(() => auditSummary(audit, items), [audit, items]);
  const pct = summary.gesamt ? Math.round((summary.geprueft / summary.gesamt) * 100) : 0;
  return (
    <>
      <div className="stats">
        <Stat label="Fortschritt" value={`${summary.geprueft} / ${summary.gesamt}`} sub={<div className="progress"><span style={{ width: `${pct}%` }} /></div>} tone={summary.geprueft === summary.gesamt && summary.gesamt ? 'ok' : undefined} />
        <Stat label="In Ordnung" value={summary.ok} tone="ok" />
        <Stat label="Rückfragen" value={summary.fragen} tone={summary.offeneFragen ? 'warn' : undefined} sub={summary.fragen ? `${summary.offeneFragen} noch unbeantwortet` : undefined} />
        <Stat label="Ergebnis" value={formatEUR(summary.report.ergebnis)} tone={summary.report.ergebnis >= 0 ? 'ok' : 'bad'} />
      </div>
      <div className="card">
        <h3>Automatische Prüfpunkte</h3>
        <ul className="checklist">
          {summary.hinweise.map((h, i) => <li key={i} className={h.ok ? 'ok' : 'warn'}>{h.ok ? '✓' : '⚠︎'} {h.text}</li>)}
        </ul>
        {summary.hinweise.some((h) => !h.ok && h.text.includes('noch nicht erfasst')) && (
          <p className="muted small">Den Kontostand laut Auszug erfasst du unter <a href="#/konto">Konto → Konten &amp; Kontostände</a> oder direkt in der <a href="#/guv">GuV</a>.</p>
        )}
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'pruefen', label: 'Beleg für Beleg prüfen' },
        { id: 'liste', label: <>Prüfprotokoll {summary.offeneFragen > 0 && <Badge tone="warn">{summary.offeneFragen}</Badge>}</> },
        { id: 'bericht', label: 'Bericht & Unterschrift' },
      ]} />
      {tab === 'pruefen' && <Stepper audit={audit} items={items} jumpTo={jumpTo} onJumped={() => setJumpTo(null)} />}
      {tab === 'liste' && <Protocol audit={audit} items={items} onOpen={(id) => { setJumpTo(id); setTab('pruefen'); }} />}
      {tab === 'bericht' && <ReportTab audit={audit} items={items} summary={summary} />}
    </>
  );
}

// ---------- Beleg für Beleg ----------

type StepFilter = 'ungeprueft' | 'alle' | 'fragen';

function Stepper({ audit, items, jumpTo, onJumped }: { audit: Audit; items: AuditItem[]; jumpTo: number | null; onJumped: () => void }) {
  const [filter, setFilter] = useLocalState<StepFilter>('audit.filter', 'ungeprueft');
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [kommentar, setKommentar] = useState('');
  const [docIdx, setDocIdx] = useState(0);
  const list = items.filter((i) => filter === 'alle' || (filter === 'fragen' ? i.check?.status === 'frage' : !i.check));

  useEffect(() => {
    if (jumpTo != null) {
      setFilter('alle');
      setCurrentId(jumpTo);
      onJumped();
    }
  }, [jumpTo]);

  // Aktuelle Buchung bleibt angezeigt, auch wenn sie nach dem Abhaken aus dem Filter fällt
  const current = items.find((i) => i.id === currentId) ?? list[0];
  const pos = current ? list.findIndex((i) => i.id === current.id) : -1;
  useEffect(() => {
    setKommentar(current?.check?.kommentar ?? '');
    setDocIdx(0);
  }, [current?.id]);

  const go = (delta: number) => {
    if (!list.length) return;
    const base = pos >= 0 ? pos : 0;
    const next = list[Math.min(Math.max(base + delta, 0), list.length - 1)];
    setCurrentId(next.id);
  };
  const nextAfterMark = () => {
    // Nach dem Abhaken zur nächsten Buchung im Filter (ohne die gerade bearbeitete)
    const rest = list.filter((i) => i.id !== current?.id);
    const after = rest.find((i) => (i.buchungsdatum > current!.buchungsdatum) || (i.buchungsdatum === current!.buchungsdatum && i.id > current!.id));
    setCurrentId((after ?? rest[0])?.id ?? null);
  };
  const markOk = () => {
    if (!current) return;
    if (attempt(() => setCheck(audit.id, current.id, 'ok', kommentar || null))) nextAfterMark();
  };
  const markQuestion = () => {
    if (!current) return;
    if (!kommentar.trim()) {
      toast('Bitte die Rückfrage kurz beschreiben', 'info');
      return;
    }
    if (attempt(() => setCheck(audit.id, current.id, 'frage', kommentar))) nextAfterMark();
  };

  // Tastatur: Enter = in Ordnung, Pfeiltasten = blättern (nicht beim Tippen)
  const handlers = useRef({ markOk, go });
  handlers.current = { markOk, go };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || document.querySelector('.modal')) return;
      if (e.key === 'Enter') { e.preventDefault(); handlers.current.markOk(); }
      if (e.key === 'ArrowRight') handlers.current.go(1);
      if (e.key === 'ArrowLeft') handlers.current.go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="toolbar">
        <select value={filter} onChange={(e) => { setFilter(e.target.value as StepFilter); setCurrentId(null); }}>
          <option value="ungeprueft">Noch nicht geprüft ({items.filter((i) => !i.check).length})</option>
          <option value="fragen">Rückfragen ({items.filter((i) => i.check?.status === 'frage').length})</option>
          <option value="alle">Alle Buchungen ({items.length})</option>
        </select>
        <button onClick={() => go(-1)} disabled={pos <= 0}>← Zurück</button>
        <span className="muted small">{pos >= 0 ? `${pos + 1} von ${list.length}` : current ? 'bearbeitet' : ''}</span>
        <button onClick={() => go(1)} disabled={pos < 0 || pos >= list.length - 1}>Weiter →</button>
        <span className="muted small">Tastatur: Enter = in Ordnung, ← → = blättern</span>
      </div>
      {!current ? (
        <Empty>{filter === 'ungeprueft' ? 'Alle Buchungen sind geprüft. 🎉 Weiter mit „Bericht & Unterschrift".' : 'Keine Buchungen in dieser Auswahl.'}</Empty>
      ) : (
        <div className="audit-grid">
          <div className="card audit-tx">
            <div className="card-head">
              <div>
                <div className="muted small">{formatDate(current.buchungsdatum)} · {current.buchungstext}</div>
                <h3 className={current.betrag_cent < 0 ? 'neg big' : 'pos big'}>{formatEUR(current.betrag_cent)}</h3>
              </div>
              {current.check ? (
                <Badge tone={current.check.status === 'ok' ? 'ok' : 'warn'}>{current.check.status === 'ok' ? '✓ geprüft' : '? Rückfrage'}</Badge>
              ) : <Badge>ungeprüft</Badge>}
            </div>
            <dl className="dl compact">
              <div><dt>Zahlungspartner</dt><dd><strong>{current.gegen_name || '–'}</strong>{current.gegen_iban && <div className="mono muted">{formatIBAN(current.gegen_iban)}</div>}</dd></div>
              <div><dt>Verwendungszweck</dt><dd>{current.verwendungszweck || '–'}</dd></div>
              <div><dt>Zuordnung</dt><dd>
                {current.zuordnung.length ? current.zuordnung.map((z, i) => (
                  <div key={i}>{z.kat ?? <em className="muted">ohne Kategorie</em>}{z.name && <span className="muted"> · {z.name}</span>}{current.zuordnung.length > 1 && <span className="muted"> ({formatEUR(z.betrag_cent)})</span>}</div>
                )) : <Badge tone="bad">nicht zugeordnet</Badge>}
              </dd></div>
              {current.notiz && <div><dt>Notiz Kassenwart</dt><dd className="pre">{current.notiz}</dd></div>}
              <div><dt>Belege</dt><dd>
                {current.belege.length ? current.belege.map((b, i) => (
                  <button key={b.id} className={`link ${i === docIdx ? 'strong' : ''}`} onClick={() => setDocIdx(i)}>📄 {b.belegnr} {b.dateiname}</button>
                )) : current.zuordnung.some((z) => z.beleg_pflicht) ? <Badge tone="bad">Beleg fehlt</Badge> : <span className="muted">keiner (nicht belegpflichtig)</span>}
              </dd></div>
            </dl>
            <Field label="Bemerkung / Rückfrage">
              <TextArea value={kommentar} onChange={setKommentar} rows={2} />
            </Field>
            {current.check?.antwort && <div className="callout"><strong>Antwort Kassenwart:</strong> {current.check.antwort}</div>}
            <div className="actions mt">
              <button className="primary" onClick={markOk}>✓ In Ordnung</button>
              <button onClick={markQuestion}>? Rückfrage</button>
              {current.check && <button className="link" onClick={() => attempt(() => clearCheck(audit.id, current.id))}>Vermerk entfernen</button>}
              <a className="small" href={`#/konto/${current.id}`}>Buchung öffnen</a>
            </div>
          </div>
          <div className="card audit-doc">
            {current.belege[docIdx] ? <DocPreview id={current.belege[docIdx].id} /> : <Empty>Kein digitaler Beleg zu dieser Buchung.</Empty>}
          </div>
        </div>
      )}
    </>
  );
}

function DocPreview({ id }: { id: number }) {
  const [doc, setDoc] = useState<{ url: string; mime: string; name: string } | null>(null);
  useEffect(() => {
    const d = documentBlobUrl(id);
    setDoc(d);
    return () => { if (d) URL.revokeObjectURL(d.url); };
  }, [id]);
  if (!doc) return null;
  return (
    <div className="doc-preview">
      {doc.mime.startsWith('image/') ? <img src={doc.url} alt={doc.name} className="doc-image" /> : <iframe src={doc.url} title={doc.name} className="doc-frame" />}
      <a className="small" href={doc.url} download={doc.name}>Herunterladen</a>
    </div>
  );
}

// ---------- Protokoll ----------

function Protocol({ audit, items, onOpen }: { audit: Audit; items: AuditItem[]; onOpen: (id: number) => void }) {
  const [onlyQuestions, setOnlyQuestions] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const list = items.filter((i) => !onlyQuestions || i.check?.status === 'frage');
  const exportFile = () => downloadBlob(exportProtocol(audit), `pruefprotokoll-${audit.jahr}.json`, 'application/json');
  const importFile = async (f: File) => {
    try {
      const r = importProtocol(audit, await f.text());
      toast(`${r.uebernommen} Prüfvermerke übernommen${r.unbekannt ? `, ${r.unbekannt} Buchungen nicht gefunden` : ''}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    }
  };
  return (
    <>
      <div className="toolbar">
        <Checkbox checked={onlyQuestions} onChange={setOnlyQuestions} label="nur Rückfragen" />
        <span className="spacer" />
        <button onClick={exportFile} title="Für Kassenprüfer, die mit einer Kopie der Datenbank auf ihrem eigenen Rechner prüfen">Prüfvermerke exportieren</button>
        <button onClick={() => file.current?.click()}>Prüfvermerke importieren …</button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Datum</th><th>Zahlungspartner</th><th>Zuordnung</th><th>Beleg</th><th className="num">Betrag</th><th>Prüfung</th><th>Rückfrage / Antwort</th></tr></thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id}>
                <td className="nowrap"><button className="link" onClick={() => onOpen(i.id)}>{formatDate(i.buchungsdatum)}</button></td>
                <td><strong>{i.gegen_name || i.buchungstext}</strong><div className="muted small clamp">{i.verwendungszweck}</div></td>
                <td className="small">{i.zuordnung.map((z) => z.kat).filter(Boolean).join(', ') || '–'}</td>
                <td className="small">{i.belege.map((b) => b.belegnr).join(', ') || (i.zuordnung.some((z) => z.beleg_pflicht) ? <Badge tone="bad">fehlt</Badge> : '–')}</td>
                <td className={`num ${i.betrag_cent < 0 ? 'neg' : 'pos'}`}>{formatEUR(i.betrag_cent)}</td>
                <td>{i.check ? <Badge tone={i.check.status === 'ok' ? 'ok' : 'warn'} title={i.check.geprueft_am}>{i.check.status === 'ok' ? '✓' : '?'}</Badge> : <span className="muted">–</span>}</td>
                <td className="small">
                  {i.check?.kommentar && <div><strong>Prüfer:</strong> {i.check.kommentar}</div>}
                  {i.check?.status === 'frage' && <AnswerField auditId={audit.id} item={i} />}
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} className="empty">Keine Einträge.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AnswerField({ auditId, item }: { auditId: number; item: AuditItem }) {
  const [v, setV] = useState(item.check?.antwort ?? '');
  return (
    <div className="answer" onBlur={() => v !== (item.check?.antwort ?? '') && attempt(() => setAnswer(auditId, item.id, v), 'Antwort gespeichert')}>
      <TextInput value={v} onChange={setV} placeholder="Antwort Kassenwart …" />
    </div>
  );
}

// ---------- Bericht ----------

function ReportTab({ audit, items, summary }: { audit: Audit; items: AuditItem[]; summary: AuditSummary }) {
  const [v, setV] = useState({
    pruefer: audit.pruefer ?? '', pruefdatum: audit.pruefdatum ?? todayISO(), ort: audit.ort ?? '', feststellungen: audit.feststellungen ?? '',
    entlastung: !!audit.entlastung,
  });
  const [anlage, setAnlage] = useLocalState('audit.anlage', true);
  const [pdf, setPdf] = useState(false);
  const save = (patch: Partial<typeof v>) => {
    const n = { ...v, ...patch };
    setV(n);
    attempt(() => updateAudit(audit.id, { ...n, entlastung: n.entlastung ? 1 : 0 }));
  };
  return (
    <div className="grid-2">
      <div className="card">
        <h3>Angaben für den Bericht</h3>
        <div className="form-grid cols-2">
          <Field label="Kassenprüfer/innen (je Zeile)" span={2}><TextArea value={v.pruefer} onChange={(x) => setV({ ...v, pruefer: x })} rows={2} /></Field>
          <Field label="Prüfungsdatum"><DateInput value={v.pruefdatum} onChange={(x) => save({ pruefdatum: x ?? todayISO() })} /></Field>
          <Field label="Ort"><TextInput value={v.ort} onChange={(x) => setV({ ...v, ort: x })} /></Field>
          <Field label="Feststellungen / Bemerkungen" span={2} hint="Erscheint im Bericht. Leer = keine Beanstandungen.">
            <TextArea value={v.feststellungen} onChange={(x) => setV({ ...v, feststellungen: x })} rows={5} />
          </Field>
        </div>
        <Checkbox checked={v.entlastung} onChange={(x) => save({ entlastung: x })} label="Die Kassenprüfer empfehlen die Entlastung des Vorstands" />
        <Checkbox checked={anlage} onChange={setAnlage} label="Prüfprotokoll aller Buchungen als Anlage drucken" />
        <div className="actions mt">
          <button onClick={() => save({})}>Angaben speichern</button>
          <button className="primary" onClick={() => { save({}); setPdf(true); }}>📄 Bericht als PDF</button>
        </div>
      </div>
      <div className="card">
        <h3>Stand der Prüfung</h3>
        <ul className="checklist">
          <li className={summary.geprueft === summary.gesamt ? 'ok' : 'warn'}>{summary.geprueft === summary.gesamt ? '✓' : '⚠︎'} {summary.geprueft} von {summary.gesamt} Buchungen geprüft</li>
          <li className={summary.offeneFragen ? 'warn' : 'ok'}>{summary.offeneFragen ? '⚠︎' : '✓'} {summary.fragen} Rückfragen, davon {summary.offeneFragen} unbeantwortet</li>
          {summary.hinweise.map((h, i) => <li key={i} className={h.ok ? 'ok' : 'warn'}>{h.ok ? '✓' : '⚠︎'} {h.text}</li>)}
        </ul>
        <p className="muted small">
          Arbeiten die Kassenprüfer auf einem eigenen Rechner, gib ihnen eine Kopie der Sicherungsdatei. Ihre Prüfvermerke exportieren sie
          unter „Prüfprotokoll" und du übernimmst sie hier mit „Prüfvermerke importieren".
        </p>
      </div>
      {pdf && (
        <PdfPreview
          title={`Bericht der Kassenprüfung ${audit.jahr}`}
          filename={`Kassenpruefung_${audit.jahr}.pdf`}
          build={() => auditPdf({ ...audit, ...v, entlastung: v.entlastung ? 1 : 0 }, items, summary, anlage)}
          onClose={() => setPdf(false)}
        />
      )}
    </div>
  );
}
