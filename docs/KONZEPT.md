# Konzept & Architektur

## Ziele

1. Mitgliederverwaltung für einen kleinen Karateverein inkl. Graduierungen (unranked, 9. Kyu – 5. Dan).
2. Beitragsforderungen je Mitglied und Geschäftsjahr aus Monatsbeitrag × aktive Monate.
3. Frühestes Kündigungsdatum: Stichtag + Frist (Standard 3 Monate), zum Monatsende.
4. Bankunabhängiger CSV-Import der Kontoumsätze, automatische Zuordnung zu Mitgliedern, Lieferanten und Kategorien.
5. Kategorien angelehnt an SKR04, keine Umsatzsteuer (Bruttobeträge), kein Kassenbuch – alles läuft über das Konto.
6. GuV mit Kontostand 1.1./31.12. und Abstimmung.
7. PDF-Belege an Buchungen.
8. Alles lokal: keine Cloud, Datenbank als SQLite-Datei herunterladbar und wieder zu öffnen.

## Architektur

```
Browser
├── index.html (eine Datei: React-App + SQLite-WebAssembly + CSS)
├── sql.js  →  SQLite-Datenbank im Arbeitsspeicher
│     └── nach jeder Änderung (entprellt) → IndexedDB (Arbeitskopie im Browser)
└── Sicherung: Datenbank → .sqlite-Datei (Download bzw. „Speichern unter“)
```

- **Kein Backend.** Die Build-Ausgabe ist eine einzige HTML-Datei (`vite-plugin-singlefile`), das SQLite-WASM ist eingebettet.
- **CSP** im Build: `default-src 'none'`, `connect-src 'self' data: blob:` – keine externen Verbindungen möglich.
- **Ein Tab gleichzeitig** (Web Locks API), damit sich zwei Fenster nicht gegenseitig überschreiben.
- **Geld in Cent** (Integer), **Datum als ISO-Text** (`yyyy-mm-dd`).
- **Dokumente** entstehen im Browser: PDF mit pdfmake (Schrift eingebettet), Word (.docx) mit `docx` – gemeinsame Inhalte (z. B. Eckdaten der Protokollvorlage) liegen in `src/lib/protokoll.ts`.

## Datenmodell (SQLite)

| Tabelle | Zweck |
|---|---|
| `meta` | Einstellungen (Vereinsname, Kündigungsfrist, Beitragskonten ab Jahr, Sicherungsstatus) |
| `members` | Mitglieder inkl. Anschrift, Kontakt, Grad, Beitragsgruppe, Zahlweise, Ein-/Austritt, IBAN/SEPA |
| `graduations` | Prüfungshistorie |
| `fee_groups`, `fee_rates` | Beitragsgruppen und Monatsbeitrag je Jahr |
| `member_charges` | Sonderforderungen/Gutschriften (Aufnahmegebühr, Prüfungsgebühr, Übertrag) |
| `categories` | Einnahme-/Ausgabe-/Neutralkategorien (SKR04-Nummer, steuerlicher Bereich, Belegpflicht, zählt aufs Mitgliedskonto) |
| `partners` | Lieferanten/Einkaufsquellen/Verbände mit IBAN und Standardkategorie |
| `accounts`, `balance_checkpoints` | Bankkonten mit Anfangssaldo; Kontostände laut Auszug |
| `imports`, `import_profiles` | Importprotokoll; gespeicherte Spaltenzuordnung je Bankformat |
| `transactions` | Kontoumsätze (Datum, Betrag, Gegenpartei, IBAN, Verwendungszweck, Mandat, Gläubiger-ID, End-to-End-Referenz, Saldo) |
| `allocations` | Zuordnung (Split) eines Umsatzes zu Kategorie / Mitglied / Partner, Beitragsjahr, Herkunft der Automatik |
| `rules` | Zuordnungsregeln (IBAN, Textmuster, Richtung, Betragsbereich → Kategorie/Partner/Mitglied) |
| `documents` | Belege als BLOB (PDF/Bild) mit Belegnummer, verknüpft mit Umsatz und Partner; Kennzeichen für Eigenbelege |
| `recurring`, `recurring_amounts`, `recurring_payments` | Wiederkehrende Zahlungen, Betrag ab Jahr, abgehakte Fälligkeiten mit Buchung und Eigenbeleg |

## Fachlogik

**Beitrag:** Ein Monat zählt, wenn das Mitglied in diesem Monat Mitglied ist (Eintritts- und Austrittsmonat zählen voll).
Soll = aktive Monate × Monatsbeitrag (Gruppe des Jahres, sonst letzter früherer Satz, oder individueller Beitrag) + Sonderforderungen.
Bezahlt = Zuordnungen mit Mitglied in Kategorien mit „Mitgliedskonto“, nach Beitragsjahr. Fälligkeit je Zahlweise zum Periodenbeginn.
Beitragskonten werden ab einem einstellbaren Jahr geführt, damit beim Umstieg keine fiktiven Altrückstände entstehen.

**Kündigung:** `endOfMonth(addMonths(eingang, frist))`, Monatsende-Kürzung bei kurzen Monaten (30.11. + 3 → 28./29.02.).

**CSV-Import:** UTF-8, sonst Windows-1252 · Trennzeichen nach konsistenter Spaltenzahl · Kopfzeile = Zeile mit den meisten bekannten Spaltennamen · Spaltenzuordnung über normalisierte Synonyme · Betrag mit Vorzeichen oder Soll/Haben oder S/H-Kennzeichen · Dezimaltrennzeichen per Mehrheit · vorgemerkte Umsätze optional übersprungen · Fingerabdruck aus Konto, Datum, Betrag, IBAN, Verwendungszweck und laufender Nummer identischer Zeilen gegen Duplikate.

**Automatische Zuordnung (Reihenfolge):** Regeln mit Priorität < 500 → IBAN Mitglied (mehrere Mitglieder = Familie, Aufteilung nach Beitrag) → IBAN Partner → Mitgliedsnummer im Verwendungszweck → Vor- und Nachname im Text bzw. Kontoinhaber → Partnername → übrige Regeln (z. B. Kontoführung, Zinsen).

**Belegpflicht:** Erwartet wird je belegpflichtiger Zuordnungszeile ein Beleg. Fehlend = belegpflichtig, nicht als „Alle Belege erfasst“ markiert und weniger Belege als Zeilen.

**Wiederkehrende Zahlungen:** Betrag je Fälligkeit aus dem letzten Eintrag „ab Jahr“ ≤ Jahr. Vorschlag einer Buchung: richtige Richtung, Buchungsdatum 4 Monate vor bis 7 Monate nach Fälligkeit, Partner per Zuordnung, IBAN oder Name, noch keiner Fälligkeit zugeordnet; exakter Betrag zuerst, dann Nähe zum Fälligkeitsmonat. Rhythmus beim Übernehmen aus einer Buchung: Median der Abstände gleichartiger Zahlungen (≤ 45 Tage monatlich, ≤ 120 vierteljährlich, ≤ 230 halbjährlich, sonst jährlich). Automatisches Abhaken nur bei exaktem Betrag und Nähe zum üblichen Zahltag (halber Rhythmus + 16 Tage).

**GuV:** Summe der Zuordnungen je Kategorie nach Buchungsdatum (Zuflussprinzip), gegliedert nach steuerlichem Bereich. Neutrale Kategorien und nicht zugeordnete Beträge erscheinen getrennt. Abstimmung: Kontostand Anfang + Ergebnis + neutral + nicht zugeordnet = Kontostand Ende (berechnet), Vergleich mit Kontostand laut Auszug.

## Tests

`npm test` prüft Beträge/Datum/IBAN, Kündigungsdatum, Beitragsberechnung, CSV-Erkennung (Sparkasse CAMT/MT940, ING mit Vorspann, Soll/Haben), Duplikate, automatische Zuordnung, GuV-Abstimmung sowie Export/Import der Datenbank inkl. Belegen.
