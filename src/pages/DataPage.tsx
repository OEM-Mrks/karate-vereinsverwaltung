import { useEffect, useRef, useState } from 'react';
import { getSetting, scalar, setSetting } from '../db/db';
import { downloadBackup, openFile, startDemo, wipeBrowser } from '../db/session';
import { useQuery } from '../hooks';
import { formatSize } from '../lib/docs';
import { earliestExitDate, formatDate, todayISO } from '../lib/format';
import { categoryOptions } from '../lib/lookups';
import { CHECK_FIELDS, requiredFields } from '../lib/completeness';
import { attempt, Field, PageHeader, Select, toast } from '../components/ui';

export function DataPage({ onWiped }: { onWiped: () => void }) {
  const s = useQuery(() => ({
    frist: Number(getSetting('kuendigungsfrist_monate', '3')) || 3,
    startYear: Number(getSetting('beitragskonto_ab', '0')) || 0,
    pflicht: requiredFields(),
    beitragCat: Number(getSetting('beitrag_category_id')) || null,
    lastExport: getSetting('last_export_at'),
    changes: Number(getSetting('changes_since_export', '0')),
    docs: scalar<number>('SELECT (SELECT COALESCE(SUM(groesse),0) FROM documents) + (SELECT COALESCE(SUM(groesse),0) FROM member_documents)') ?? 0,
    counts: {
      Mitglieder: scalar<number>('SELECT COUNT(*) FROM members') ?? 0,
      Buchungen: scalar<number>('SELECT COUNT(*) FROM transactions') ?? 0,
      Belege: scalar<number>('SELECT COUNT(*) FROM documents') ?? 0,
      Mitgliederunterlagen: scalar<number>('SELECT COUNT(*) FROM member_documents') ?? 0,
      Partner: scalar<number>('SELECT COUNT(*) FROM partners') ?? 0,
    },
  }));
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const e = await navigator.storage?.estimate?.();
        const persisted = await navigator.storage?.persisted?.();
        setEstimate({ usage: e?.usage, quota: e?.quota, persisted });
      } catch {
        setEstimate(null);
      }
    })();
  }, []);
  const fileInput = useRef<HTMLInputElement>(null);

  const open = async (f: File) => {
    if (s.changes > 0 && !confirm(`Es gibt ${s.changes} ungesicherte Änderungen. Trotzdem die Datei „${f.name}" öffnen und die aktuellen Daten ersetzen?`)) return;
    try {
      await openFile(f);
      toast(`„${f.name}" geöffnet`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    }
  };

  return (
    <div className="page">
      <PageHeader title="Daten & Einstellungen" />
      <div className="grid-2">
        <div className="card">
          <h3>Sicherung</h3>
          <p className="small">
            Alle Daten – Mitglieder, Buchungen, Kategorien <strong>und alle Belege (PDFs)</strong> – stecken in <strong>einer SQLite-Datei</strong>.
            Lade sie regelmäßig herunter und bewahre sie sicher auf (z. B. verschlüsselter USB-Stick). Mit „Datei öffnen" arbeitest du später – auch auf einem anderen Computer – genau dort weiter.
          </p>
          <div className="stats">
            <div className={`stat ${s.changes ? 'stat-warn' : 'stat-ok'}`}>
              <div className="stat-label">Letzte Sicherung</div>
              <div className="stat-value small-value">{s.lastExport ? s.lastExport.replace(/^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d).*/, '$3.$2.$1 $4') : 'noch nie'}</div>
              <div className="stat-sub">{s.changes ? `${s.changes} Änderungen seitdem` : 'keine Änderungen seitdem'}</div>
            </div>
          </div>
          <div className="actions">
            <button className="primary" onClick={() => void downloadBackup().then((ok) => ok && toast('Sicherung gespeichert'))}>💾 Datenbank herunterladen (.sqlite)</button>
            <button onClick={() => fileInput.current?.click()}>📂 Datei öffnen …</button>
            <input ref={fileInput} type="file" accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3,application/x-sqlite3" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = ''; }} />
          </div>
          <ul className="small muted">
            {Object.entries(s.counts).map(([k, v]) => <li key={k}>{v} {k}</li>)}
            <li>Dateien gesamt (Belege und Mitgliederunterlagen): {formatSize(s.docs)}</li>
          </ul>
        </div>
        <div className="card">
          <h3>Datenschutz (DSGVO)</h3>
          <ul className="small">
            <li>Die App läuft <strong>vollständig lokal in deinem Browser</strong>. Es gibt keinen Server, keine Cloud, kein Tracking.</li>
            <li>Eine Sicherheitsrichtlinie (Content-Security-Policy) blockiert technisch jede Verbindung ins Internet.</li>
            <li>Die Arbeitskopie liegt im Speicher dieses Browsers (IndexedDB) auf diesem Gerät. Wer Zugriff auf dein Benutzerkonto hat, kann die Daten sehen – nutze ein eigenes, passwortgeschütztes Benutzerkonto.</li>
            <li>Gib die Sicherungsdatei nur an berechtigte Personen weiter (z. B. Kassenprüfer). Sie enthält personenbezogene Daten und Bankverbindungen.</li>
            <li>Ausgetretene Mitglieder nach Ablauf der Aufbewahrungsfristen (i. d. R. 10 Jahre für Buchungsbelege) löschen.</li>
          </ul>
          {estimate && (
            <p className="muted small">
              Browser-Speicher: {estimate.usage != null ? formatSize(estimate.usage) : '?'} belegt
              {estimate.persisted ? ' · dauerhaft (wird nicht automatisch gelöscht)' : ' · nicht dauerhaft – Browser könnte bei Platzmangel löschen. Regelmäßig sichern!'}
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Einstellungen</h3>
        <div className="form-grid">
          <p className="span-4 muted small">Name, Anschrift, Register- und Steuerdaten sowie Vorstand pflegst du unter <a href="#/verein">Stammdaten → Verein &amp; Vorstand</a>.</p>
          <Field label="Kündigungsfrist (Monate)" hint={`Kündigung heute → Austritt zum ${formatDate(earliestExitDate(todayISO(), s.frist))}`}>
            <input type="number" min={0} max={24} value={s.frist} onChange={(e) => attempt(() => setSetting('kuendigungsfrist_monate', Math.max(0, Number(e.target.value) || 0)))} />
          </Field>
          <Field label="Beitragskonten führen ab Jahr" hint="Ältere Jahre gelten als ausgeglichen">
            <input type="number" min={1990} max={2100} value={s.startYear || ''} onChange={(e) => attempt(() => setSetting('beitragskonto_ab', Number(e.target.value) || 0))} />
          </Field>
          <Field label="Kategorie für Mitgliedsbeiträge" hint="Für die automatische Zuordnung">
            <Select value={s.beitragCat} onChange={(v) => v && attempt(() => setSetting('beitrag_category_id', v))} options={categoryOptions((c) => c.typ === 'einnahme')} />
          </Field>
        </div>
      </div>

      <div className="card">
        <h3>Pflichtangaben für Mitglieder</h3>
        <p className="muted small">Fehlt eine dieser Angaben, erscheint das Mitglied unter „Mitglieder → Unvollständig". Anlegen geht trotzdem schon mit dem Namen allein.</p>
        <div className="check-grid">
          {CHECK_FIELDS.map((f) => (
            <label key={f.id} className="checkbox">
              <input
                type="checkbox"
                checked={s.pflicht.includes(f.id)}
                onChange={(e) => attempt(() => setSetting('pflichtfelder', JSON.stringify(e.target.checked ? [...s.pflicht, f.id] : s.pflicht.filter((x) => x !== f.id))))}
              />
              <span>{f.label}{f.id === 'erziehungsberechtigte' ? ' (nur bei Minderjährigen)' : ''}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card danger-zone">
        <h3>Neu beginnen</h3>
        <p className="small">Entfernt alle Daten aus diesem Browser. Vorher unbedingt eine Sicherung herunterladen!</p>
        <div className="actions">
          <button className="danger-outline" onClick={() => {
            if (!confirm('Demodaten laden? Die aktuellen Daten in diesem Browser werden ersetzt.')) return;
            void startDemo().then(() => toast('Demoverein geladen'));
          }}>Demodaten laden</button>
          <button className="danger" onClick={() => {
            if (!confirm(`Wirklich ALLE Daten aus diesem Browser löschen?${s.changes ? `\n\nAchtung: ${s.changes} Änderungen sind noch nicht gesichert!` : ''}`)) return;
            void wipeBrowser().then(onWiped);
          }}>Alle Daten aus diesem Browser löschen</button>
        </div>
      </div>
    </div>
  );
}
