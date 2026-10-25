import { useRef, useState, useSyncExternalStore } from 'react';
import { getSetting, hasDatabase } from './db/db';
import { downloadBackup, getSaveState, openFile, startDemo, startNew, subscribeSave } from './db/session';
import { useDbVersion, useRoute } from './hooks';
import { Toaster, toast } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { MembersPage } from './pages/Members';
import { MemberDetail } from './pages/MemberDetail';
import { FeesPage } from './pages/Fees';
import { BankPage } from './pages/Bank';
import { ImportPage } from './pages/Import';
import { DocumentsPage } from './pages/Documents';
import { CategoriesPage, PartnersPage, RulesPage } from './pages/MasterData';
import { ReportPage } from './pages/Report';
import { DataPage } from './pages/DataPage';
import { AuditPage } from './pages/Audit';

const NAV: { id: string; label: string; icon: string; group?: string }[] = [
  { id: 'uebersicht', label: 'Übersicht', icon: '◉' },
  { id: 'mitglieder', label: 'Mitglieder', icon: '👤', group: 'Verein' },
  { id: 'beitraege', label: 'Beiträge', icon: '€' },
  { id: 'konto', label: 'Konto', icon: '🏦', group: 'Finanzen' },
  { id: 'import', label: 'CSV-Import', icon: '⇪' },
  { id: 'belege', label: 'Belege', icon: '📄' },
  { id: 'guv', label: 'GuV', icon: '📊' },
  { id: 'kassenpruefung', label: 'Kassenprüfung', icon: '✓' },
  { id: 'partner', label: 'Lieferanten', icon: '🏷', group: 'Stammdaten' },
  { id: 'kategorien', label: 'Kategorien', icon: '▤' },
  { id: 'regeln', label: 'Regeln', icon: '⚡' },
  { id: 'daten', label: 'Daten & Sicherung', icon: '💾', group: 'System' },
];

export function App() {
  useDbVersion();
  const [, force] = useState(0);
  if (!hasDatabase()) return <><Welcome onReady={() => force((x) => x + 1)} /><Toaster /></>;
  return <><Shell onWiped={() => force((x) => x + 1)} /><Toaster /></>;
}

function Shell({ onWiped }: { onWiped: () => void }) {
  const route = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const save = useSyncExternalStore(subscribeSave, getSaveState);
  const changes = Number(getSetting('changes_since_export', '0'));
  const page = route[0];
  const id = route[1] ? Number(route[1]) : undefined;

  let content;
  switch (page) {
    case 'mitglieder': content = id ? <MemberDetail id={id} /> : <MembersPage />; break;
    case 'beitraege': content = <FeesPage />; break;
    case 'konto': content = <BankPage txId={id} />; break;
    case 'import': content = <ImportPage />; break;
    case 'belege': content = <DocumentsPage />; break;
    case 'guv': content = <ReportPage />; break;
    case 'kassenpruefung': content = <AuditPage />; break;
    case 'partner': content = <PartnersPage />; break;
    case 'kategorien': content = <CategoriesPage />; break;
    case 'regeln': content = <RulesPage />; break;
    case 'daten': content = <DataPage onWiped={onWiped} />; break;
    default: content = <Dashboard />;
  }

  return (
    <div className={`shell ${menuOpen ? 'menu-open' : ''}`}>
      <aside className="sidebar" onClick={() => setMenuOpen(false)}>
        <div className="brand">
          <span className="brand-logo" aria-hidden>空</span>
          <div>
            <div className="brand-name">{getSetting('verein_name')}</div>
            <div className="brand-sub">Vereinsverwaltung · lokal</div>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <div key={n.id}>
              {n.group && <div className="nav-group">{n.group}</div>}
              <a href={`#/${n.id}`} className={page === n.id || (!page && n.id === 'uebersicht') ? 'active' : ''}>
                <span className="nav-icon" aria-hidden>{n.icon}</span>{n.label}
              </a>
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className={`save-state ${save.error ? 'bad' : ''}`}>
            {save.error ? `⚠︎ Speichern fehlgeschlagen: ${save.error}` : save.saving ? 'Speichert …' : '✓ Im Browser gespeichert'}
          </div>
          <button className={`backup-btn ${changes ? 'pending' : ''}`} onClick={(e) => { e.stopPropagation(); void downloadBackup().then((ok) => ok && toast('Sicherung gespeichert')); }}>
            💾 Sichern{changes ? <span className="pill">{changes}</span> : null}
          </button>
          <div className="offline">🔒 Offline · keine Cloud</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menü">☰</button>
          <span className="topbar-title">{getSetting('verein_name')}</span>
        </header>
        <main>{content}</main>
      </div>
    </div>
  );
}

function Welcome({ onReady }: { onReady: () => void }) {
  const [name, setName] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    fn().then(onReady).catch((e) => toast(e instanceof Error ? e.message : String(e), 'bad')).finally(() => setBusy(false));
  };
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-logo" aria-hidden>空手</div>
        <h1>Vereinsverwaltung</h1>
        <p className="muted">Mitglieder, Beiträge, Kontoauszüge, Belege und GuV für deinen Karateverein – komplett lokal im Browser. Keine Cloud, kein Konto, keine Datenübertragung.</p>
        <div className="welcome-options">
          <div className="welcome-option">
            <h3>Neu beginnen</h3>
            <input placeholder="Name des Vereins, z. B. Karate-Dojo Musterstadt e. V." value={name} onChange={(e) => setName(e.target.value)} />
            <button className="primary" disabled={busy || !name.trim()} onClick={() => run(() => startNew(name.trim()))}>Verein anlegen</button>
            <p className="muted small">Mit SKR04-Kategorien, Beitragsgruppen und Grundregeln vorbelegt.</p>
          </div>
          <div className="welcome-option">
            <h3>Weiterarbeiten</h3>
            <button disabled={busy} onClick={() => file.current?.click()}>📂 Sicherungsdatei (.sqlite) öffnen</button>
            <input ref={file} type="file" accept=".sqlite,.sqlite3,.db" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => openFile(f)); e.target.value = ''; }} />
            <p className="muted small">Öffnet eine zuvor heruntergeladene Datenbank inklusive aller Belege.</p>
            <h3 className="mt">Ausprobieren</h3>
            <button disabled={busy} onClick={() => run(startDemo)}>Demoverein laden</button>
            <p className="muted small">Fiktive Mitglieder und Buchungen zum Kennenlernen.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
