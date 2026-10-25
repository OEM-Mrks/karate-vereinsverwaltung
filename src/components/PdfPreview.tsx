import { useEffect, useState, type ReactNode } from 'react';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { pdfBlob } from '../lib/pdf';
import { Modal } from './ui';

/** Erzeugt ein PDF, zeigt es an und bietet es zum Herunterladen an. */
export function PdfPreview(props: {
  title: string;
  filename: string;
  build: () => TDocumentDefinitions;
  onClose: () => void;
  /** Zusätzliche Optionen links in der Fußzeile; ändern sich `deps`, wird das PDF neu erzeugt */
  options?: ReactNode;
  deps?: unknown[];
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let cancelled = false;
    setUrl(null);
    (async () => {
      try {
        const blob = await pdfBlob(props.build());
        if (cancelled) return;
        u = URL.createObjectURL(blob);
        setUrl(u);
      } catch (e) {
        console.error(e);
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, props.deps ?? []);
  return (
    <Modal
      size="full"
      title={props.title}
      onClose={props.onClose}
      footer={<>
        {props.options ?? <span className="muted small">Erzeugt im Browser – es wird nichts übertragen.</span>}
        <span className="spacer" />
        {url && <a className="button primary-link" href={url} download={props.filename}>⬇ PDF herunterladen</a>}
      </>}
    >
      {error ? <p className="field-error">PDF konnte nicht erstellt werden: {error}</p> : url ? <iframe src={url} title={props.title} className="doc-frame" /> : <p className="muted">PDF wird erstellt …</p>}
    </Modal>
  );
}
