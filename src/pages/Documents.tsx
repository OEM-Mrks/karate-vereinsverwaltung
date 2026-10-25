import { useState } from 'react';
import { all, run } from '../db/db';
import type { DocumentMeta } from '../db/schema';
import { navigate, useLocalState, useQuery } from '../hooks';
import { addDocument, fehlendeBelege, formatSize } from '../lib/docs';
import { formatDate, formatEUR, todayISO } from '../lib/format';
import { DocUpload, DocViewer } from '../components/Docs';
import { attempt, Badge, Empty, Field, Modal, PageHeader, Tabs, TextInput, toast, YearSelect, DateInput } from '../components/ui';

type Tab = 'alle' | 'fehlend' | 'unverknuepft';

export function DocumentsPage() {
  const [tab, setTab] = useLocalState<Tab>('docs.tab', 'alle');
  const [year, setYear] = useLocalState('year', new Date().getFullYear());
  const [view, setView] = useState<number | null>(null);
  const [edit, setEdit] = useState<DocumentMeta | null>(null);

  const docs = useQuery(() =>
    all<DocumentMeta & { buchung: string | null; betrag: number | null; gegen: string | null }>(
      `SELECT d.id, d.belegnr, d.belegdatum, d.beschreibung, d.transaction_id, d.partner_id, d.dateiname, d.mime, d.groesse, d.eigenbeleg, d.created_at,
              t.buchungsdatum AS buchung, t.betrag_cent AS betrag, COALESCE(t.gegen_name, p.name) AS gegen
       FROM documents d LEFT JOIN transactions t ON t.id = d.transaction_id LEFT JOIN partners p ON p.id = d.partner_id
       WHERE COALESCE(d.belegdatum, substr(d.created_at,1,10)) BETWEEN ? AND ? OR (d.transaction_id IS NULL AND ? = 1)
       ORDER BY d.belegnr DESC, d.id DESC`,
      [`${year}-01-01`, `${year}-12-31`, tab === 'unverknuepft' ? 1 : 0],
    ),
  [year, tab]);
  const missing = useQuery(() => fehlendeBelege(`${year}-01-01`, `${year}-12-31`), [year]);

  const upload = async (files: File[]) => {
    for (const f of files) {
      try {
        await addDocument(f, { belegdatum: todayISO() });
        toast(`„${f.name}" gespeichert – jetzt einer Buchung zuordnen`);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'bad');
      }
    }
    setTab('unverknuepft');
  };

  const list = tab === 'unverknuepft' ? docs.filter((d) => !d.transaction_id) : docs;
  const totalSize = docs.reduce((s, d) => s + d.groesse, 0);

  return (
    <div className="page">
      <PageHeader title="Belege" subtitle="Rechnungen und Quittungen als PDF oder Foto – gespeichert direkt in der Vereinsdatenbank und Teil jeder Sicherung." />
      <DocUpload onFiles={upload} label="Belege hierher ziehen oder klicken – mehrere Dateien möglich" />
      <div className="toolbar">
        <YearSelect value={year} onChange={setYear} />
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { id: 'alle', label: `Belege ${year}` },
          { id: 'fehlend', label: <>Beleg fehlt {missing.length > 0 && <Badge tone="warn">{missing.length}</Badge>}</> },
          { id: 'unverknuepft', label: 'Nicht verknüpft' },
        ]} />
        <span className="spacer" />
        <span className="muted small">{docs.length} Belege · {formatSize(totalSize)}</span>
      </div>
      {tab === 'fehlend' ? (
        missing.length ? (<>
          <p className="muted small">Bei Splitbuchungen wird je belegpflichtiger Zeile ein Beleg erwartet. Gehört alles zu einer Rechnung oder gibt es keinen Beleg, in der Buchung „Alle Belege erfasst“ anhaken oder einen Eigenbeleg erstellen.</p>
          <div className="table-wrap">
            <table className="table clickable-rows">
              <thead><tr><th>Datum</th><th>Zahlungspartner / Zweck</th><th>Kategorie</th><th>Belege</th><th className="num">Betrag</th></tr></thead>
              <tbody>
                {missing.map((t) => (
                  <tr key={t.id} onClick={() => navigate(`konto/${t.id}`)}>
                    <td>{formatDate(t.buchungsdatum)}</td>
                    <td><strong>{t.gegen_name}</strong><div className="muted small clamp">{t.verwendungszweck}</div></td>
                    <td className="small">{t.kat}</td>
                    <td className="small">{t.ist ? <Badge tone="warn">{t.ist} von {t.soll}</Badge> : <Badge tone="bad">fehlt</Badge>}</td>
                    <td className={`num ${t.betrag_cent < 0 ? 'neg' : ''}`}>{formatEUR(t.betrag_cent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>) : <Empty>Zu allen belegpflichtigen Buchungen in {year} sind die Belege hinterlegt. 👍</Empty>
      ) : list.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Beleg-Nr.</th><th>Belegdatum</th><th>Datei</th><th>Beschreibung</th><th>Buchung</th><th /></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.belegnr}</td>
                  <td>{formatDate(d.belegdatum)}</td>
                  <td><button className="link" onClick={() => setView(d.id)}>📄 {d.dateiname}</button> <span className="muted small">{formatSize(d.groesse)}</span>{d.eigenbeleg ? <> <Badge tone="info">Eigenbeleg</Badge></> : null}</td>
                  <td className="small">{d.beschreibung}</td>
                  <td className="small">
                    {d.transaction_id ? (
                      <a href={`#/konto/${d.transaction_id}`}>{formatDate(d.buchung)} · {d.gegen} · {formatEUR(d.betrag)}</a>
                    ) : <Badge tone="warn">nicht verknüpft</Badge>}
                  </td>
                  <td><button className="link" onClick={() => setEdit(d)}>bearbeiten</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Keine Belege.</Empty>}
      {view && <DocViewer id={view} onClose={() => setView(null)} />}
      {edit && <DocEdit d={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function DocEdit({ d, onClose }: { d: DocumentMeta; onClose: () => void }) {
  const [v, setV] = useState(d);
  const save = () =>
    attempt(() => {
      run('UPDATE documents SET belegnr = ?, belegdatum = ?, beschreibung = ? WHERE id = ?', [v.belegnr || null, v.belegdatum || null, v.beschreibung || null, d.id]);
      onClose();
    }, 'Gespeichert');
  const remove = () => confirm(`Beleg „${d.dateiname}" endgültig löschen?`) && attempt(() => run('DELETE FROM documents WHERE id = ?', [d.id]), 'Beleg gelöscht') && onClose();
  return (
    <Modal title="Beleg bearbeiten" onClose={onClose}
      footer={<><button className="danger-outline" onClick={remove}>Löschen</button><button onClick={onClose}>Abbrechen</button><button className="primary" onClick={save}>Speichern</button></>}>
      <div className="form-grid cols-2">
        <Field label="Beleg-Nr."><TextInput value={v.belegnr} onChange={(x) => setV({ ...v, belegnr: x })} /></Field>
        <Field label="Belegdatum"><DateInput value={v.belegdatum} onChange={(x) => setV({ ...v, belegdatum: x })} /></Field>
        <Field label="Beschreibung" span={2}><TextInput value={v.beschreibung} onChange={(x) => setV({ ...v, beschreibung: x })} /></Field>
      </div>
      <p className="muted small">Die Verknüpfung mit einer Buchung erfolgt im Zuordnungsdialog der Buchung (Konto → Buchung anklicken → Belege).</p>
    </Modal>
  );
}
