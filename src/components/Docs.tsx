import { useEffect, useRef, useState } from 'react';
import { all, run } from '../db/db';
import type { DocumentMeta } from '../db/schema';
import { useQuery } from '../hooks';
import { ACCEPT_DOCS, addDocument, documentBlobUrl, formatSize } from '../lib/docs';
import { formatDate } from '../lib/format';
import { attempt, Modal, toast } from './ui';

export function DocViewer({ id, onClose, load = documentBlobUrl }: {
  id: number;
  onClose: () => void;
  /** Quelle der Datei – Standard: Belege; für Kontoauszüge eine andere Tabelle */
  load?: (id: number) => { url: string; mime: string; name: string } | null;
}) {
  const [doc, setDoc] = useState<{ url: string; mime: string; name: string } | null>(null);
  useEffect(() => {
    const d = load(id);
    setDoc(d);
    return () => {
      if (d) URL.revokeObjectURL(d.url);
    };
  }, [id]);
  if (!doc) return null;
  return (
    <Modal
      size="full"
      title={doc.name}
      onClose={onClose}
      footer={<a className="button" href={doc.url} download={doc.name}>Herunterladen</a>}
    >
      {doc.mime.startsWith('image/') ? (
        <img src={doc.url} alt={doc.name} className="doc-image" />
      ) : doc.mime === 'application/pdf' ? (
        <iframe src={doc.url} title={doc.name} className="doc-frame" />
      ) : (
        <p>Keine Vorschau verfügbar. <a href={doc.url} download={doc.name}>Herunterladen</a></p>
      )}
    </Modal>
  );
}

/** Hochladen per Klick oder Drag & Drop. */
export function DocUpload(props: {
  onFiles: (files: File[]) => void | Promise<void>;
  label?: string;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''} ${props.compact ? 'compact' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void props.onFiles([...e.dataTransfer.files]);
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_DOCS}
        hidden
        onChange={(e) => {
          void props.onFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      📎 {props.label ?? 'Beleg (PDF/Bild) hierher ziehen oder klicken'}
    </div>
  );
}

/** Belegliste einer Buchung inkl. Upload. */
export function TransactionDocs({ transactionId, belegdatum, partnerId }: { transactionId: number; belegdatum: string; partnerId?: number | null }) {
  const [view, setView] = useState<number | null>(null);
  const [linking, setLinking] = useState(false);
  const docs = useQuery(
    () => all<DocumentMeta>('SELECT id, belegnr, belegdatum, beschreibung, transaction_id, partner_id, dateiname, mime, groesse, created_at FROM documents WHERE transaction_id = ? ORDER BY id', [transactionId]),
    [transactionId],
  );
  const unlinked = useQuery(
    () => (linking ? all<DocumentMeta>('SELECT id, belegnr, belegdatum, beschreibung, dateiname, groesse FROM documents WHERE transaction_id IS NULL ORDER BY id DESC') : []),
    [linking],
  );
  const upload = async (files: File[]) => {
    for (const f of files) {
      try {
        await addDocument(f, { transaction_id: transactionId, belegdatum, partner_id: partnerId ?? null });
        toast(`Beleg „${f.name}" gespeichert`);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'bad');
      }
    }
  };
  return (
    <div className="docs">
      {docs.map((d) => (
        <div key={d.id} className="doc-row">
          <button className="link" onClick={() => setView(d.id)}>📄 {d.belegnr} · {d.dateiname}</button>
          <span className="muted small">{formatSize(d.groesse)}</span>
          <button className="link danger" onClick={() => attempt(() => run('UPDATE documents SET transaction_id = NULL WHERE id = ?', [d.id]), 'Verknüpfung gelöst')}>lösen</button>
        </div>
      ))}
      <DocUpload onFiles={upload} compact />
      <button className="link small" onClick={() => setLinking(!linking)}>{linking ? 'Auswahl schließen' : 'Vorhandenen, nicht verknüpften Beleg auswählen …'}</button>
      {linking && (
        <div className="doc-pick">
          {unlinked.length ? unlinked.map((d) => (
            <button key={d.id} className="link" onClick={() => attempt(() => run('UPDATE documents SET transaction_id = ? WHERE id = ?', [transactionId, d.id]), 'Beleg verknüpft')}>
              {d.belegnr} · {d.dateiname} · {formatDate(d.belegdatum)}{d.beschreibung ? ` · ${d.beschreibung}` : ''}
            </button>
          )) : <span className="muted small">Keine unverknüpften Belege vorhanden.</span>}
        </div>
      )}
      {view && <DocViewer id={view} onClose={() => setView(null)} />}
    </div>
  );
}
