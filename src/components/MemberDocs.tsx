import { useEffect, useRef, useState } from 'react';
import { run } from '../db/db';
import type { Member, MemberDocumentArt } from '../db/schema';
import { useQuery } from '../hooks';
import { ANTRAG_FELDER, parseAntragText, type AntragDaten, type AntragFeld } from '../lib/antrag';
import { formatSize } from '../lib/docs';
import { formatDate, formatIBAN, isValidIBAN } from '../lib/format';
import {
  ACCEPT_MEMBER_DOCS, addMemberDocument, applyAntrag, listMemberDocuments, MEMBER_DOC_ARTEN, memberDocumentBlobUrl,
  memberDocumentFile, memberDocumentText, setMemberDocumentText,
} from '../lib/memberDocs';
import type { OcrProgress } from '../lib/ocr';
import { DocViewer } from './Docs';
import { attempt, Badge, Checkbox, DateInput, Empty, Modal, Select, TextInput, toast } from './ui';

/** Texterkennung erst bei Bedarf laden (Programm und Sprachmodell sind groß). */
async function erkenneText(file: { bytes: Uint8Array; mime: string }, onProgress: (p: OcrProgress) => void) {
  const { documentText } = await import('../lib/ocr');
  return documentText(file, onProgress);
}

/** Unterlagen eines Mitglieds: Mitgliedsantrag, SEPA-Mandat … – mit Auslesen per Texterkennung. */
export function MemberDocuments({ m }: { m: Member }) {
  const docs = useQuery(() => listMemberDocuments(m.id), [m.id]);
  const [art, setArt] = useState<MemberDocumentArt>('antrag');
  const [view, setView] = useState<number | null>(null);
  const [auslesen, setAuslesen] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const upload = async (files: File[]) => {
    let last: number | null = null;
    for (const f of files) {
      try {
        last = await addMemberDocument(m.id, f, art);
        toast(`„${f.name}" gespeichert`);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'bad');
      }
    }
    // Ein einzelner Antrag wird gleich ausgelesen
    if (last && files.length === 1 && art === 'antrag') setAuslesen(last);
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Unterlagen</h3>
        <span className="muted small">Gespeichert in der Vereinsdatenbank und Teil jeder Sicherung</span>
      </div>
      <div className="inline">
        <span className="muted small">Art:</span>
        <Select value={art} onChange={(v) => setArt((v ?? 'antrag') as MemberDocumentArt)} options={MEMBER_DOC_ARTEN.map((a) => ({ value: a.id, label: a.name }))} />
      </div>
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void upload([...e.dataTransfer.files]); }}
      >
        <input ref={input} type="file" multiple accept={ACCEPT_MEMBER_DOCS} hidden onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ''; }} />
        📎 {MEMBER_DOC_ARTEN.find((a) => a.id === art)?.name} (PDF/Scan/Foto) hierher ziehen oder klicken
      </div>
      {docs.length ? (
        <table className="table">
          <thead><tr><th>Art</th><th>Datei</th><th>Hinzugefügt</th><th /></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  <select
                    value={d.art}
                    aria-label="Art der Unterlage"
                    onChange={(e) => attempt(() => run('UPDATE member_documents SET art = ? WHERE id = ?', [e.target.value, d.id]))}
                  >
                    {MEMBER_DOC_ARTEN.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </td>
                <td>
                  <button className="link" onClick={() => setView(d.id)}>📄 {d.dateiname}</button>
                  <span className="muted small"> {formatSize(d.groesse)}</span>
                  {d.text != null && <> <Badge tone="info" title="Text wurde erkannt">Text erkannt</Badge></>}
                </td>
                <td className="small">{formatDate(d.created_at.slice(0, 10))}</td>
                <td className="num">
                  <button className="link small" onClick={() => setAuslesen(d.id)}>🔍 Daten auslesen</button>{' '}
                  <button
                    className="link danger small"
                    onClick={() => confirm(`„${d.dateiname}" endgültig löschen?`) && attempt(() => run('DELETE FROM member_documents WHERE id = ?', [d.id]), 'Unterlage gelöscht')}
                  >löschen</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty>Noch keine Unterlagen. Lege hier z. B. den unterschriebenen Mitgliedsantrag ab – Angaben wie Geburtsdatum, Anschrift und IBAN lassen sich daraus auslesen.</Empty>}
      {view && <DocViewer id={view} load={memberDocumentBlobUrl} onClose={() => setView(null)} />}
      {auslesen && (
        <AntragDialog
          aktuell={m}
          quelle={{ docId: auslesen }}
          onClose={() => setAuslesen(null)}
          onApply={(daten) => attempt(() => applyAntrag(m.id, daten), 'Angaben übernommen') && setAuslesen(null)}
        />
      )}
    </div>
  );
}

/** Liest den Text eines Dokuments (gespeicherter Text oder Texterkennung) und zeigt die erkannten Angaben zur Übernahme. */
export function AntragDialog(props: {
  aktuell: Partial<Member>;
  /** Gespeicherte Unterlage oder eine (noch nicht gespeicherte) Datei */
  quelle: { docId: number } | { file: File };
  onClose: () => void;
  onApply: (daten: AntragDaten, text: string) => void;
  applyLabel?: string;
}) {
  const { quelle } = props;
  const [text, setText] = useState<string | null>(null);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [durchlauf, setDurchlauf] = useState(0);
  const [werte, setWerte] = useState<AntragDaten>({});
  const [nehmen, setNehmen] = useState<Set<AntragFeld>>(new Set());
  const [zeigeText, setZeigeText] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setText(null);
    (async () => {
      try {
        let t: string | null = null;
        let ocr = false;
        if ('docId' in quelle) {
          const f = memberDocumentFile(quelle.docId);
          if (!f) throw new Error('Unterlage nicht gefunden.');
          if (durchlauf === 0) t = memberDocumentText(quelle.docId);
          if (t == null) {
            t = (await erkenneText(f, (p) => !cancelled && setProgress(p))).text;
            ocr = true;
          }
        } else {
          const bytes = new Uint8Array(await quelle.file.arrayBuffer());
          t = (await erkenneText({ bytes, mime: quelle.file.type }, (p) => !cancelled && setProgress(p))).text;
        }
        if (cancelled) return;
        if (ocr && 'docId' in quelle) setMemberDocumentText(quelle.docId, t);
        const erkannt = parseAntragText(t);
        setText(t);
        setWerte(erkannt);
        // Vorausgewählt: erkannte Angaben für leere Felder
        setNehmen(new Set(ANTRAG_FELDER.filter((f) => erkannt[f.id] && !String(props.aktuell[f.id] ?? '').trim()).map((f) => f.id)));
      } catch (e) {
        console.error(e);
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setProgress(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [durchlauf]);

  const felder = ANTRAG_FELDER.filter((f) => werte[f.id] !== undefined);
  const leer = ANTRAG_FELDER.filter((f) => werte[f.id] === undefined);
  const toggle = (id: AntragFeld, v: boolean) => {
    const n = new Set(nehmen);
    if (v) n.add(id); else n.delete(id);
    setNehmen(n);
  };
  const setWert = (id: AntragFeld, v: string | null) => {
    setWerte({ ...werte, [id]: v ?? '' });
    toggle(id, !!v?.trim());
  };
  const apply = () => {
    const daten: AntragDaten = {};
    for (const id of nehmen) if (werte[id]?.trim()) daten[id] = werte[id];
    props.onApply(daten, text ?? '');
  };
  const anzeige = (id: AntragFeld, v: unknown) => (v == null || v === '' ? '–' : id === 'iban' ? formatIBAN(String(v)) : ANTRAG_FELDER.find((f) => f.id === id)?.datum ? formatDate(String(v)) : String(v));

  return (
    <Modal
      size="wide"
      title="Angaben aus dem Mitgliedsantrag"
      onClose={props.onClose}
      footer={<>
        {text != null && <button className="link small" onClick={() => setDurchlauf(durchlauf + 1)}>Text neu erkennen</button>}
        <span className="spacer" />
        <button onClick={props.onClose}>Abbrechen</button>
        <button className="primary" disabled={text == null || (!nehmen.size && !props.applyLabel)} onClick={apply}>{props.applyLabel ?? `${nehmen.size} Angabe${nehmen.size === 1 ? '' : 'n'} übernehmen`}</button>
      </>}
    >
      {error ? (
        <p className="field-error">Texterkennung fehlgeschlagen: {error}</p>
      ) : text == null ? (
        <div>
          <p>{progress?.status ?? 'Dokument wird vorbereitet'} …</p>
          <div className="progress"><span style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }} /></div>
          <p className="muted small">Die Texterkennung läuft vollständig in diesem Browser – das Dokument verlässt den Rechner nicht. Beim ersten Mal dauert der Start einige Sekunden.</p>
        </div>
      ) : (
        <>
          {felder.length ? (
            <>
              <p className="muted small">Bitte prüfen: Gedruckte Angaben werden meist zuverlässig erkannt, handschriftliche oft nicht oder fehlerhaft. Werte lassen sich hier noch korrigieren.</p>
              <table className="table">
                <thead><tr><th /><th>Feld</th><th>Bisher</th><th>Aus dem Antrag</th></tr></thead>
                <tbody>
                  {felder.map((f) => {
                    const bisher = props.aktuell[f.id];
                    const gleich = String(bisher ?? '') === String(werte[f.id] ?? '');
                    return (
                      <tr key={f.id}>
                        <td><Checkbox checked={nehmen.has(f.id)} onChange={(v) => toggle(f.id, v)} label="" /></td>
                        <td>{f.label}</td>
                        <td className="small">{anzeige(f.id, bisher)}{gleich && bisher ? <> <Badge tone="ok">gleich</Badge></> : null}</td>
                        <td>
                          {f.datum
                            ? <DateInput value={werte[f.id]} onChange={(v) => setWert(f.id, v)} />
                            : <TextInput value={werte[f.id]} onChange={(v) => setWert(f.id, v)} />}
                          {f.id === 'iban' && werte.iban && !isValidIBAN(werte.iban) && <span className="field-error">IBAN-Prüfziffer stimmt nicht</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : (
            <div className="callout warn">Im erkannten Text wurden keine Angaben gefunden. Handschrift wird von der Texterkennung kaum gelesen – die Felder lassen sich unten von Hand ergänzen.</div>
          )}
          {leer.length > 0 && (
            <p className="small">
              <span className="muted">Nicht erkannt: </span>
              {leer.map((f, i) => (
                <span key={f.id}>{i > 0 && ', '}<button className="link small" onClick={() => setWerte({ ...werte, [f.id]: '' })}>{f.label}</button></span>
              ))}
              <span className="muted"> – anklicken, um den Wert von Hand einzutragen.</span>
            </p>
          )}
          <button className="link small" onClick={() => setZeigeText(!zeigeText)}>{zeigeText ? 'Erkannten Text ausblenden' : 'Erkannten Text anzeigen'}</button>
          {zeigeText && <pre className="pre small ocr-text">{text || '(kein Text erkannt)'}</pre>}
        </>
      )}
    </Modal>
  );
}
