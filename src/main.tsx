import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { boot } from './db/session';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}

async function start() {
  // Nur ein Tab gleichzeitig darf die Datenbank bearbeiten – sonst überschreiben sich Änderungen gegenseitig.
  if (navigator.locks) {
    const got = await new Promise<boolean>((resolve) => {
      void navigator.locks.request('vereinsverwaltung-db', { ifAvailable: true }, (lock) => {
        resolve(!!lock);
        // Sperre halten, solange der Tab offen ist
        return lock ? new Promise(() => {}) : undefined;
      });
    });
    if (!got) {
      root.render(<Message title="Bereits geöffnet" text="Die Vereinsverwaltung ist schon in einem anderen Tab oder Fenster geöffnet. Bitte dort weiterarbeiten oder den anderen Tab schließen und diese Seite neu laden." />);
      return;
    }
  }
  try {
    await boot();
  } catch (e) {
    root.render(<Message title="Start fehlgeschlagen" text={`Die Datenbank konnte nicht geladen werden: ${e instanceof Error ? e.message : String(e)}`} />);
    return;
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
