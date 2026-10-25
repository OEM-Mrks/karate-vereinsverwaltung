// Stammdaten des Vereins (Anschrift, Register, Steuer) und Vorstand/Ämter.

import { all, getSetting, run, setSetting, tx } from '../db/db';
import type { Member, Officer } from '../db/schema';
import { todayISO } from './format';

export const FUNKTIONEN = [
  'Vorsitzende/r',
  '2. Vorsitzende/r',
  'Kassenwart/in',
  'Schriftführer/in',
  'Beisitzer/in',
  'Kassenprüfer/in',
  'Jugendwart/in',
  'Sportwart/in',
  'Cheftrainer/in',
];

export const VEREIN_FELDER = [
  'verein_name', 'verein_strasse', 'verein_plz', 'verein_ort', 'verein_email', 'verein_telefon', 'verein_website',
  'verein_gruendung', 'verein_registergericht', 'verein_registernummer', 'verein_finanzamt', 'verein_steuernummer',
  'verein_freistellung_datum', 'verein_verband', 'verein_verband_nr',
] as const;

export type VereinFeld = (typeof VEREIN_FELDER)[number];
export type Vereinsdaten = Record<VereinFeld, string>;

export function getVereinsdaten(): Vereinsdaten {
  const v = Object.fromEntries(VEREIN_FELDER.map((k) => [k, getSetting(k)])) as Vereinsdaten;
  // Übernahme der früheren, einzeiligen Anschrift ("Straße\nPLZ Ort")
  if (!v.verein_strasse && !v.verein_ort) {
    const [strasse, plzOrt] = getSetting('verein_anschrift').split('\n');
    const m = (plzOrt ?? '').trim().match(/^(\d{4,5})\s+(.*)$/);
    v.verein_strasse = strasse?.trim() ?? '';
    v.verein_plz = m?.[1] ?? '';
    v.verein_ort = m?.[2] ?? (plzOrt ?? '').trim();
  }
  return v;
}

export function saveVereinsdaten(v: Partial<Vereinsdaten>) {
  tx(() => {
    // Mit dem aktuellen Stand zusammenführen, damit aus der alten Anschrift übernommene Felder nicht verloren gehen
    const merged = { ...getVereinsdaten(), ...v };
    for (const [k, val] of Object.entries(merged)) setSetting(k, (val ?? '').trim());
    const d = getVereinsdaten();
    // Zusammengesetzte Anschrift für Briefköpfe
    setSetting('verein_anschrift', [d.verein_strasse, `${d.verein_plz} ${d.verein_ort}`.trim()].filter(Boolean).join('\n'));
  });
}

export type OfficerView = Officer & { anzeigename: string; kontakt: string; abgelaufen: boolean };

export function officers(): OfficerView[] {
  const members = new Map(all<Member>('SELECT * FROM members').map((m) => [m.id, m]));
  const order = (f: string) => {
    const i = FUNKTIONEN.indexOf(f);
    return i < 0 ? 99 : i;
  };
  return all<Officer>('SELECT * FROM officers')
    .map((o) => {
      const m = o.member_id ? members.get(o.member_id) : undefined;
      return {
        ...o,
        anzeigename: m ? [m.titel, m.vorname, m.nachname].filter(Boolean).join(' ') : o.name ?? '–',
        kontakt: [o.email || m?.email, o.telefon || m?.mobil || m?.telefon].filter(Boolean).join(' · '),
        abgelaufen: !!o.amtszeit_bis && o.amtszeit_bis < todayISO(),
      };
    })
    .sort((a, b) => order(a.funktion) - order(b.funktion) || a.sort - b.sort || a.anzeigename.localeCompare(b.anzeigename));
}

/** Namen der aktuellen Inhaber einer Funktion (abgelaufene Amtszeiten ausgenommen). */
export function namesFor(funktion: string): string[] {
  return officers().filter((o) => o.funktion === funktion && !o.abgelaufen).map((o) => o.anzeigename);
}

export function saveOfficer(o: Partial<Officer>): number {
  const vals = [
    o.funktion!.trim(), o.member_id ?? null, o.member_id ? null : o.name?.trim() || null, o.email?.trim() || null, o.telefon?.trim() || null,
    o.gewaehlt_am || null, o.amtszeit_bis || null, o.vertretungsberechtigt ? 1 : 0, o.notiz?.trim() || null,
  ];
  if (o.id) {
    run('UPDATE officers SET funktion=?, member_id=?, name=?, email=?, telefon=?, gewaehlt_am=?, amtszeit_bis=?, vertretungsberechtigt=?, notiz=? WHERE id=?', [...vals, o.id]);
    return o.id;
  }
  return run('INSERT INTO officers(funktion, member_id, name, email, telefon, gewaehlt_am, amtszeit_bis, vertretungsberechtigt, notiz) VALUES (?,?,?,?,?,?,?,?,?)', vals);
}

export function deleteOfficer(id: number) {
  run('DELETE FROM officers WHERE id = ?', [id]);
}

/** Unterschrift für Briefe: Name und „Vorsitz“ (Fallback: frühere Einstellung bzw. „Der Vorstand“). */
export function signatory(): string {
  const v = officers().find((o) => o.funktion === 'Vorsitzende/r' && !o.abgelaufen);
  if (v) return `${v.anzeigename}\nVorsitz`;
  return getSetting('verein_unterzeichner', 'Der Vorstand');
}
