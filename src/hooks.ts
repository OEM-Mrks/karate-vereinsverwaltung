import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getVersion, subscribe } from './db/db';

export function useDbVersion(): number {
  return useSyncExternalStore(subscribe, getVersion);
}

/** Führt eine (synchrone) Datenbankabfrage aus und wiederholt sie nach jeder Änderung. */
export function useQuery<T>(fn: () => T, deps: unknown[] = []): T {
  const v = useDbVersion();
  return useMemo(fn, [v, ...deps]);
}

function readHash(): string[] {
  const h = window.location.hash.replace(/^#\/?/, '');
  return h ? h.split('/').map(decodeURIComponent) : ['uebersicht'];
}

export function useRoute(): string[] {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    let page = readHash()[0];
    const on = () => {
      const next = readHash();
      // Beim Wechsel der Seite nach oben scrollen (nicht beim Öffnen eines Dialogs innerhalb der Seite)
      if (next[0] !== page) window.scrollTo(0, 0);
      page = next[0];
      setRoute(next);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = '/' + path.replace(/^\//, '');
}

/** Merkt sich einen Wert pro Browser (z. B. gewähltes Jahr, Filter). */
export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem('vv:' + key);
      return s ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try {
      localStorage.setItem('vv:' + key, JSON.stringify(nv));
    } catch {
      /* Speicher nicht verfügbar – egal */
    }
  };
  return [v, set];
}
