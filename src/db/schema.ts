// Datenbankschema (SQLite). Alle Geldbeträge in Cent (INTEGER), alle Datumswerte als ISO-Text (yyyy-mm-dd).

export const SCHEMA_VERSION = 3;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Beitragsgruppen (z. B. Erwachsene, Kinder, Familie, Ehrenmitglied)
CREATE TABLE IF NOT EXISTS fee_groups (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  beschreibung TEXT,
  aktiv        INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0
);

-- Beitragssätze je Gruppe und Jahr. Der Jahresbeitrag ergibt sich aus Monatsbeitrag × 12.
CREATE TABLE IF NOT EXISTS fee_rates (
  id                INTEGER PRIMARY KEY,
  fee_group_id      INTEGER NOT NULL REFERENCES fee_groups(id) ON DELETE CASCADE,
  jahr              INTEGER NOT NULL,
  monatsbeitrag_cent INTEGER NOT NULL,
  UNIQUE (fee_group_id, jahr)
);

CREATE TABLE IF NOT EXISTS members (
  id                   INTEGER PRIMARY KEY,
  mitgliedsnr          TEXT,
  anrede               TEXT,
  titel                TEXT,
  vorname              TEXT NOT NULL,
  nachname             TEXT NOT NULL,
  geburtsdatum         TEXT,
  strasse              TEXT,
  adresszusatz         TEXT,
  plz                  TEXT,
  ort                  TEXT,
  land                 TEXT DEFAULT 'Deutschland',
  email                TEXT,
  telefon              TEXT,
  mobil                TEXT,
  grad                 TEXT NOT NULL DEFAULT 'unranked',
  fee_group_id         INTEGER REFERENCES fee_groups(id) ON DELETE SET NULL,
  beitrag_individuell_cent INTEGER,          -- abweichender Monatsbeitrag (überschreibt die Gruppe)
  zahlweise            TEXT NOT NULL DEFAULT 'jaehrlich', -- jaehrlich | halbjaehrlich | quartal | monatlich
  eintritt             TEXT NOT NULL,
  austritt             TEXT,
  kuendigung_eingang   TEXT,
  kontoinhaber         TEXT,
  iban                 TEXT,
  bic                  TEXT,
  sepa_mandat_ref      TEXT,
  sepa_mandat_datum    TEXT,
  erziehungsberechtigte TEXT,
  notizen              TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_members_iban ON members(iban);

-- Prüfungs-/Graduierungshistorie
CREATE TABLE IF NOT EXISTS graduations (
  id        INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  grad      TEXT NOT NULL,
  datum     TEXT NOT NULL,
  pruefer   TEXT,
  notiz     TEXT
);

-- Einnahme-/Ausgabekategorien, angelehnt an den DATEV-Kontenrahmen SKR04
CREATE TABLE IF NOT EXISTS categories (
  id             INTEGER PRIMARY KEY,
  nummer         TEXT NOT NULL,
  name           TEXT NOT NULL,
  typ            TEXT NOT NULL CHECK (typ IN ('einnahme','ausgabe','neutral')),
  sphaere        TEXT NOT NULL DEFAULT 'ideell' CHECK (sphaere IN ('ideell','vermoegen','zweck','wgb','neutral')),
  mitgliedskonto INTEGER NOT NULL DEFAULT 0, -- Zahlungen zählen auf das Beitragskonto des Mitglieds
  beleg_pflicht  INTEGER NOT NULL DEFAULT 0,
  aktiv          INTEGER NOT NULL DEFAULT 1
);

-- Zusätzliche Forderungen an Mitglieder (Aufnahmegebühr, Prüfungsgebühr …) oder Gutschriften (negativ)
CREATE TABLE IF NOT EXISTS member_charges (
  id           INTEGER PRIMARY KEY,
  member_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  jahr         INTEGER NOT NULL,
  datum        TEXT NOT NULL,
  betrag_cent  INTEGER NOT NULL,
  beschreibung TEXT NOT NULL,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL
);

-- Lieferanten, Einkaufsquellen und sonstige Zahlungspartner
CREATE TABLE IF NOT EXISTS partners (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  typ                 TEXT NOT NULL DEFAULT 'lieferant', -- lieferant | zuschussgeber | verband | sonstige
  iban                TEXT,
  email               TEXT,
  telefon             TEXT,
  anschrift           TEXT,
  kundennummer        TEXT,
  default_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  notizen             TEXT
);
CREATE INDEX IF NOT EXISTS idx_partners_iban ON partners(iban);

-- Bankkonten des Vereins
CREATE TABLE IF NOT EXISTS accounts (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  bank              TEXT,
  iban              TEXT,
  bic               TEXT,
  anfangssaldo_cent INTEGER NOT NULL DEFAULT 0,  -- Kontostand zu Beginn des Anfangsdatums
  anfangsdatum      TEXT NOT NULL,
  aktiv             INTEGER NOT NULL DEFAULT 1
);

-- Kontostände laut Kontoauszug (zur Abstimmung, z. B. zum 31.12.)
CREATE TABLE IF NOT EXISTS balance_checkpoints (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  datum       TEXT NOT NULL,       -- Kontostand am Ende dieses Tages
  saldo_cent  INTEGER NOT NULL,
  notiz       TEXT,
  UNIQUE (account_id, datum)
);

CREATE TABLE IF NOT EXISTS imports (
  id           INTEGER PRIMARY KEY,
  account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  dateiname    TEXT,
  profil       TEXT,
  importiert_am TEXT NOT NULL DEFAULT (datetime('now')),
  anzahl_neu   INTEGER NOT NULL DEFAULT 0,
  anzahl_dupl  INTEGER NOT NULL DEFAULT 0
);

-- Gespeicherte Spaltenzuordnungen für CSV-Dateien verschiedener Banken
CREATE TABLE IF NOT EXISTS import_profiles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  signatur    TEXT NOT NULL UNIQUE,   -- normalisierte Kopfzeile
  config_json TEXT NOT NULL
);

-- Kontobewegungen
CREATE TABLE IF NOT EXISTS transactions (
  id               INTEGER PRIMARY KEY,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  buchungsdatum    TEXT NOT NULL,
  valutadatum      TEXT,
  betrag_cent      INTEGER NOT NULL,
  waehrung         TEXT NOT NULL DEFAULT 'EUR',
  gegen_name       TEXT,
  gegen_iban       TEXT,
  gegen_bic        TEXT,
  verwendungszweck TEXT,
  buchungstext     TEXT,
  mandatsreferenz  TEXT,
  glaeubiger_id    TEXT,
  e2e_ref          TEXT,
  saldo_cent       INTEGER,               -- Saldo nach Buchung, falls die Bank ihn liefert
  import_id        INTEGER REFERENCES imports(id) ON DELETE SET NULL,
  hash             TEXT UNIQUE,
  geprueft         INTEGER NOT NULL DEFAULT 0,
  notiz            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(buchungsdatum);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);

-- Zuordnung (Splitbuchung) einer Kontobewegung zu Kategorie / Mitglied / Partner
CREATE TABLE IF NOT EXISTS allocations (
  id             INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  member_id      INTEGER REFERENCES members(id) ON DELETE SET NULL,
  partner_id     INTEGER REFERENCES partners(id) ON DELETE SET NULL,
  betrag_cent    INTEGER NOT NULL,
  beitragsjahr   INTEGER,          -- für welches Beitragsjahr eine Mitgliedszahlung gilt
  notiz          TEXT,
  auto           TEXT              -- Herkunft der automatischen Zuordnung (Regel, IBAN, Name …), NULL = manuell
);
CREATE INDEX IF NOT EXISTS idx_alloc_tx ON allocations(transaction_id);
CREATE INDEX IF NOT EXISTS idx_alloc_member ON allocations(member_id);

-- Regeln für die automatische Zuordnung
CREATE TABLE IF NOT EXISTS rules (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  prioritaet    INTEGER NOT NULL DEFAULT 100,
  aktiv         INTEGER NOT NULL DEFAULT 1,
  iban          TEXT,       -- Gegen-IBAN muss exakt passen
  text_enthaelt TEXT,       -- Name/Verwendungszweck/Buchungstext enthält … (Alternativen mit | trennen)
  richtung      TEXT NOT NULL DEFAULT 'beide', -- ein | aus | beide
  betrag_min_cent INTEGER,  -- Betrag (absolut) von
  betrag_max_cent INTEGER,  -- Betrag (absolut) bis
  category_id   INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  partner_id    INTEGER REFERENCES partners(id) ON DELETE SET NULL,
  member_id     INTEGER REFERENCES members(id) ON DELETE SET NULL,
  treffer       INTEGER NOT NULL DEFAULT 0
);

-- Belege (PDF/Bild) – liegen als BLOB direkt in der Datenbank
CREATE TABLE IF NOT EXISTS documents (
  id             INTEGER PRIMARY KEY,
  belegnr        TEXT,
  belegdatum     TEXT,
  beschreibung   TEXT,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  partner_id     INTEGER REFERENCES partners(id) ON DELETE SET NULL,
  dateiname      TEXT NOT NULL,
  mime           TEXT NOT NULL,
  groesse        INTEGER NOT NULL,
  daten          BLOB NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_tx ON documents(transaction_id);

-- Kontoauszüge (PDF) je Konto, Jahr und Monat
CREATE TABLE IF NOT EXISTS statements (
  id             INTEGER PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  jahr           INTEGER NOT NULL,
  monat          INTEGER NOT NULL CHECK (monat BETWEEN 1 AND 12),
  nummer         TEXT,             -- Auszugsnummer, z. B. 3/2026
  von            TEXT,
  bis            TEXT,
  saldo_alt_cent INTEGER,          -- Kontostand vor dem Zeitraum
  saldo_neu_cent INTEGER,          -- Kontostand am Ende des Zeitraums
  dateiname      TEXT NOT NULL,
  mime           TEXT NOT NULL,
  groesse        INTEGER NOT NULL,
  daten          BLOB NOT NULL,
  erkannt        INTEGER NOT NULL DEFAULT 0,  -- Angaben automatisch aus dem PDF gelesen
  notiz          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_statements_period ON statements(account_id, jahr, monat);

-- Kassenprüfung je Geschäftsjahr
CREATE TABLE IF NOT EXISTS audits (
  id            INTEGER PRIMARY KEY,
  jahr          INTEGER NOT NULL UNIQUE,
  pruefer       TEXT,                 -- Namen, eine Zeile je Prüfer
  pruefdatum    TEXT,
  ort           TEXT,
  umfang        TEXT NOT NULL DEFAULT 'alle',  -- alle | ausgaben | belegpflichtig
  feststellungen TEXT,
  entlastung    INTEGER NOT NULL DEFAULT 1,     -- Empfehlung zur Entlastung des Vorstands
  abgeschlossen INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prüfvermerk je Buchung
CREATE TABLE IF NOT EXISTS audit_checks (
  audit_id       INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN ('ok','frage')),
  kommentar      TEXT,   -- Rückfrage der Kassenprüfer
  antwort        TEXT,   -- Antwort des Kassenwarts
  geprueft_am    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (audit_id, transaction_id)
);
`;

export type Sphaere = 'ideell' | 'vermoegen' | 'zweck' | 'wgb' | 'neutral';
export type CatTyp = 'einnahme' | 'ausgabe' | 'neutral';

export const SPHAEREN: { id: Sphaere; name: string; kurz: string }[] = [
  { id: 'ideell', name: 'Ideeller Bereich', kurz: 'Ideell' },
  { id: 'vermoegen', name: 'Vermögensverwaltung', kurz: 'Vermögen' },
  { id: 'zweck', name: 'Zweckbetrieb (Sportbetrieb)', kurz: 'Zweckbetrieb' },
  { id: 'wgb', name: 'Wirtschaftlicher Geschäftsbetrieb', kurz: 'WGB' },
  { id: 'neutral', name: 'Neutral (nicht ergebniswirksam)', kurz: 'Neutral' },
];

export type Category = {
  id: number; nummer: string; name: string; typ: CatTyp; sphaere: Sphaere;
  mitgliedskonto: number; beleg_pflicht: number; aktiv: number;
};

export type FeeGroup = { id: number; name: string; beschreibung: string | null; aktiv: number; sort: number };
export type FeeRate = { id: number; fee_group_id: number; jahr: number; monatsbeitrag_cent: number };

export type Zahlweise = 'jaehrlich' | 'halbjaehrlich' | 'quartal' | 'monatlich';

export type Member = {
  id: number; mitgliedsnr: string | null; anrede: string | null; titel: string | null;
  vorname: string; nachname: string; geburtsdatum: string | null;
  strasse: string | null; adresszusatz: string | null; plz: string | null; ort: string | null; land: string | null;
  email: string | null; telefon: string | null; mobil: string | null;
  grad: string; fee_group_id: number | null; beitrag_individuell_cent: number | null; zahlweise: Zahlweise;
  eintritt: string; austritt: string | null; kuendigung_eingang: string | null;
  kontoinhaber: string | null; iban: string | null; bic: string | null;
  sepa_mandat_ref: string | null; sepa_mandat_datum: string | null;
  erziehungsberechtigte: string | null; notizen: string | null;
  created_at: string; updated_at: string;
};

export type Graduation = { id: number; member_id: number; grad: string; datum: string; pruefer: string | null; notiz: string | null };

export type MemberCharge = {
  id: number; member_id: number; jahr: number; datum: string; betrag_cent: number;
  beschreibung: string; category_id: number | null;
};

export type Partner = {
  id: number; name: string; typ: string; iban: string | null; email: string | null; telefon: string | null;
  anschrift: string | null; kundennummer: string | null; default_category_id: number | null; notizen: string | null;
};

export type Account = {
  id: number; name: string; bank: string | null; iban: string | null; bic: string | null;
  anfangssaldo_cent: number; anfangsdatum: string; aktiv: number;
};

export type BalanceCheckpoint = { id: number; account_id: number; datum: string; saldo_cent: number; notiz: string | null };

export type Transaction = {
  id: number; account_id: number; buchungsdatum: string; valutadatum: string | null; betrag_cent: number;
  waehrung: string; gegen_name: string | null; gegen_iban: string | null; gegen_bic: string | null;
  verwendungszweck: string | null; buchungstext: string | null; mandatsreferenz: string | null;
  glaeubiger_id: string | null; e2e_ref: string | null; saldo_cent: number | null;
  import_id: number | null; hash: string | null; geprueft: number; notiz: string | null; created_at: string;
};

export type Allocation = {
  id: number; transaction_id: number; category_id: number | null; member_id: number | null;
  partner_id: number | null; betrag_cent: number; beitragsjahr: number | null; notiz: string | null; auto: string | null;
};

export type Rule = {
  id: number; name: string; prioritaet: number; aktiv: number; iban: string | null; text_enthaelt: string | null;
  richtung: 'ein' | 'aus' | 'beide'; betrag_min_cent: number | null; betrag_max_cent: number | null;
  category_id: number | null; partner_id: number | null; member_id: number | null; treffer: number;
};

export type Statement = {
  id: number; account_id: number; jahr: number; monat: number; nummer: string | null; von: string | null; bis: string | null;
  saldo_alt_cent: number | null; saldo_neu_cent: number | null; dateiname: string; mime: string; groesse: number;
  daten: Uint8Array; erkannt: number; notiz: string | null; created_at: string;
};

export type Audit = {
  id: number; jahr: number; pruefer: string | null; pruefdatum: string | null; ort: string | null;
  umfang: 'alle' | 'ausgaben' | 'belegpflichtig'; feststellungen: string | null; entlastung: number; abgeschlossen: number; created_at: string;
};

export type AuditCheck = {
  audit_id: number; transaction_id: number; status: 'ok' | 'frage'; kommentar: string | null; antwort: string | null; geprueft_am: string;
};

export type DocumentMeta = {
  id: number; belegnr: string | null; belegdatum: string | null; beschreibung: string | null;
  transaction_id: number | null; partner_id: number | null; dateiname: string; mime: string; groesse: number; created_at: string;
};
