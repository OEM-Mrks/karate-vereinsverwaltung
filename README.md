# Vereinsverwaltung für Karatevereine

Mitglieder, Beiträge, Kontoauszüge, Belege und Gewinn- und Verlustrechnung – **komplett lokal im Browser**.
Keine Cloud, kein Server, kein Konto. Alle Daten liegen in einer SQLite-Datei, die du jederzeit herunterladen und wieder öffnen kannst.

## Funktionen

**Mitglieder**
- Vollständige Stammdaten: Anschrift, E-Mail, Telefon, Handy, Geburtsdatum, Erziehungsberechtigte, Bankverbindung, SEPA-Mandat
- Graduierung von *ohne Graduierung* über 9. Kyu bis 5. Dan, mit Prüfungshistorie
- Eintritt, Kündigungseingang, Austritt
- Anlegen schon mit dem Namen allein; die Liste **„Unvollständig“** zeigt, wo noch Angaben fehlen (Pflichtangaben einstellbar), Ergänzen mit „Speichern & nächstes“
- **Frühestes Kündigungsdatum**: heute + 3 Monate zum Monatsende (Frist einstellbar), z. B. Kündigung am 25.10.2026 → Austritt 31.01.2027
- Kündigungsbestätigung als druckfertiger Brief
- **Mitgliederversammlung – Tagesordnung**: Checkliste mit Standardpunkten (Begrüßung, Beschlussfähigkeit, Berichte von Vorstand, Kassenwart und Kassenprüfern, Entlastung, Neuwahlen, Kassenprüferwahl, Mitgliedsbeiträge, Satzungsänderungen, Anträge, Verschiedenes …) zum Anhaken, eigene Punkte hinzufügen, Reihenfolge ändern, Erläuterungen; ablaufende Amtszeiten schlagen Neuwahlen vor. Daraus als PDF: **Einladung mit Tagesordnung** und **Protokollvorlage** mit Schreiblinien und Abstimmungsfeldern
- **Mitgliederversammlung – Anwesenheitsliste** aller am Versammlungstag aktiven Mitglieder als PDF (Name, Anschrift, Telefon, optional E-Mail, Minderjährige gekennzeichnet) mit Unterschriftsspalte, Leerzeilen für Gäste und Feldern für Anwesende/Stimmberechtigte

**Verein & Vorstand**
- Vereinslogo (erscheint in der Seitenleiste und auf allen PDF-Dokumenten)
- Vereinsdaten: Geschäftsanschrift, Kontakt, Registergericht und VR-Nummer, Finanzamt, Steuernummer, Freistellungsbescheid, Dachverband
- Ämter: Vorsitz, 2. Vorsitz, Kassenwart/in, Schriftführer/in, Beisitzer/innen, Kassenprüfer/innen u. a. – als Mitglied verknüpft oder externe Person, mit Wahl- und Amtszeitende und Kennzeichnung des Vorstands nach § 26 BGB
- Wird automatisch verwendet: Absender und Unterschrift in Briefen, Kassenprüfer und Kassenwart im Prüfbericht, Unterschriftszeilen der GuV; Hinweis bei abgelaufenen Amtszeiten

**Beiträge**
- Beitragsgruppen (Erwachsene, Kinder, Familie, Ehrenmitglied …) mit **Monatsbeitrag je Jahr** – der Jahresbeitrag wird automatisch berechnet (× 12)
- Neues Beitragsjahr per Klick (übernimmt die Sätze des Vorjahres); fehlt ein Satz, gilt der des Vorjahres
- Anteilige Berechnung nach Eintritts- und Austrittsmonat, individuelle Beiträge, Zahlweise (jährlich/halbjährlich/vierteljährlich/monatlich)
- Beitragskonto je Mitglied: Soll, Zahlungen, Sonderforderungen (Aufnahme-, Prüfungsgebühr), Rückstände aus Vorjahren
- Liste offener Beiträge zum Drucken und als CSV

**Konto & Buchhaltung**
- **CSV-Import aus dem Online-Banking** – bankunabhängig: Zeichensatz, Trennzeichen, Kopfzeile und Spalten werden automatisch erkannt (Sparkasse CSV-CAMT und CSV-MT940, Volksbank, DKB, ING, Commerzbank, Deutsche Bank …), Zuordnung manuell anpassbar und wird je Bankformat gespeichert
- Duplikaterkennung – überlappende Zeiträume können gefahrlos mehrfach importiert werden
- **Automatische Zuordnung**: Regeln → IBAN des Mitglieds → IBAN des Lieferanten → Mitgliedsnummer im Verwendungszweck → Name des Mitglieds/Kontoinhabers → Name des Lieferanten
- Lernfunktion: Eine manuelle Zuordnung kann als Regel gemerkt werden; die IBAN eines Mitglieds wird auf Wunsch übernommen
- **Ersteinrichtung aus dem Kontoauszug**: offene Buchungen nach Zahlungspartner gruppiert – pro Zahler mit einem Klick *neues Mitglied*, *bestehendes Mitglied*, *neuer/bestehender Lieferant* oder *nur Kategorie*; alle Buchungen werden sofort zugeordnet, künftige automatisch
- Neues Mitglied bzw. neuer Lieferant direkt im Zuordnungsdialog; Vorschläge aus der Zahlung: Name (auch das Kind, wenn ein Elternteil zahlt), Mitgliedsnummer aus dem Verwendungszweck, Beitragsgruppe und Zahlweise anhand des Betrags
- Splitbuchungen (ein Umsatz auf mehrere Kategorien/Mitglieder), Familienzahlungen werden auf mehrere Mitglieder aufgeteilt
- Kategorien **angelehnt an SKR04**, gegliedert nach den steuerlichen Bereichen gemeinnütziger Vereine (ideeller Bereich, Vermögensverwaltung, Zweckbetrieb, wirtschaftlicher Geschäftsbetrieb) – alles brutto, keine Umsatzsteuer
- Lieferanten/Einkaufsquellen mit Standardkategorie
- **Belege als PDF oder Foto** an jede Buchung hängen (Drag & Drop), fortlaufende Belegnummern, Liste fehlender Belege
- Mehrere Belege je Buchung: Bei Splitbuchungen wird je belegpflichtiger Zeile ein Beleg erwartet („1 von 2 Belegen“); gehört alles zu einer Rechnung, genügt der Haken „Alle Belege erfasst“
- **Eigenbeleg-Generator** für Zahlungen ohne Rechnung (z. B. Verbandsbeiträge): übernimmt Datum, Betrag, Empfänger, Zweck und Kategorie aus der Buchung, dazu eine Begründung – wird als PDF mit Unterschriftszeilen gespeichert und der Buchung zugeordnet
- **Wiederkehrende Zahlungen** (Dachverband, Landesverband, Versicherungen …): Betrag ab Jahr, jährlich/halbjährlich/vierteljährlich/monatlich, Fälligkeiten je Jahr abhaken – die passende Kontobewegung wird vorgeschlagen, auf Wunsch zugeordnet und gleich mit Eigenbeleg versehen; überfällige Zahlungen erscheinen in der Übersicht
- Jede Buchung lässt sich mit **„Als wiederkehrende Zahlung übernehmen“** in die Tabelle aufnehmen (z. B. Ionos): Partner, Kategorie und Betrag werden übernommen, der Rhythmus aus früheren Zahlungen erkannt und alle passenden Buchungen seit Beginn automatisch abgehakt; **Monatsvorschau** mit noch offenen Beträgen für die Planung

- **Sammelbearbeitung**: Buchungen anhaken (z. B. nach Suche „Ionos“) und Lieferant, Kategorie oder „geprüft“ für alle auf einmal setzen; Filter „Ausgaben ohne Lieferant“; beim Zuordnen eines Lieferanten auf Wunsch auch alle weiteren Buchungen desselben Zahlungspartners ergänzen

**Kontoauszüge**
- Ablage der PDF-Kontoauszüge nach Jahr und Monat (Drag & Drop, mehrere Dateien auf einmal)
- PDFs aus dem Online-Banking werden im Browser ausgelesen (pdf.js): Auszugsnummer, Zeitraum, alter und neuer Kontostand – der Auszug wird automatisch dem richtigen Monat zugeordnet
- Erkannte Kontostände werden mit den Buchungen abgeglichen (✓ oder Differenz); fehlende Monate werden angezeigt
- Gescannte Auszüge ohne Textebene legt man per Drop auf den gewünschten Monat ab

**Kassenprüfung**
- Beleg für Beleg am Bildschirm prüfen: Buchung links, PDF-Beleg rechts, abhaken mit Enter, Rückfragen mit Kommentar
- Prüfprotokoll mit Antworten des Kassenwarts; Austausch per kleiner Protokolldatei, falls die Prüfer mit einer Kopie auf dem eigenen Rechner arbeiten
- Automatische Prüfpunkte: Kontostand 31.12. laut Auszug = Buchungen, alles zugeordnet, Belege vollständig
- **Bericht der Kassenprüfung** zum Unterschreiben (Kontenentwicklung, Einnahmen/Ausgaben je Bereich, Feststellungen, Entlastungsempfehlung, Prüfprotokoll als Anlage)

**Gewinn- und Verlustrechnung**
- Einnahmen-Überschuss-Rechnung nach Zahlungsfluss mit Vorjahresvergleich – für das ganze Jahr oder **unterjährig** (bis heute, Quartal, Halbjahr, Monat, frei wählbar)
- **Kontostand zum 1.1. und 31.12.** je Konto und Abstimmung: Anfangsbestand + Einnahmen − Ausgaben = Endbestand
- Vergleich mit dem Kontostand laut Kontoauszug – fehlende oder doppelte Importe fallen sofort auf
- Export als CSV

**PDF-Dokumente**
- GuV, Bericht der Kassenprüfung, Kündigungsbestätigung, Liste offener Beiträge, Eigenbelege und Anwesenheitsliste werden als echte PDF-Dateien direkt im Browser erzeugt (pdfmake, Schrift eingebettet) – mit Vereinslogo, Briefkopf, Fußzeile mit Vereinsdaten und Seitenzahlen; kein Druckdialog nötig

## Datenschutz (DSGVO)

- Die App ist eine einzelne HTML-Datei, die **ausschließlich im Browser** läuft. Es gibt keinen Server und keine Datenübertragung.
- Eine Content-Security-Policy blockiert technisch jede Verbindung ins Internet (auch keine Schriften oder Skripte aus einem CDN).
- Die Arbeitskopie liegt im Browser-Speicher (IndexedDB) des jeweiligen Geräts. Die Sicherung ist eine SQLite-Datei inklusive aller Belege.
- Es dürfen niemals echte Vereinsdaten in dieses Repository eingecheckt werden (`.gitignore` schließt `*.sqlite` und `*.csv` aus).

## Benutzung

**Variante A – online öffnen:** über GitHub Pages (Adresse siehe Repository-Seite → *Deployments*). Auch dort bleiben alle Daten lokal im Browser.

**Variante B – komplett offline:** `vereinsverwaltung.html` aus den [Releases](../../releases) herunterladen und per Doppelklick im Browser öffnen (Chrome, Edge oder Firefox empfohlen).

**Arbeitsablauf**
1. Verein anlegen (oder zum Ausprobieren den Demoverein laden).
2. Beitragsgruppen und -sätze prüfen, Mitglieder anlegen (mit IBAN, damit Zahlungen automatisch erkannt werden).
3. Im Online-Banking die Umsätze als CSV exportieren (Sparkasse: *Umsätze → Exportieren → CSV-CAMT V2*) und unter **CSV-Import** hochladen.
4. Unter **Konto → Offene nach Zahlungspartner** Mitglieder und Lieferanten direkt aus den Zahlungen anlegen (Ersteinrichtung), restliche Buchungen einzeln zuordnen, Belege anhängen.
   Fehlende Mitgliedsdaten danach unter **Mitglieder → Unvollständig** ergänzen.
5. Unter **Konto → Konten & Kontostände** den Anfangssaldo und den Kontostand laut Auszug zum 31.12. eintragen.
6. **GuV** drucken bzw. als PDF speichern.
7. Regelmäßig **💾 Sichern** – die `.sqlite`-Datei sicher aufbewahren. Mit *Datei öffnen* geht es später (auch auf einem anderen Rechner) genau dort weiter.

## Entwicklung

```bash
npm install
npm run dev      # Entwicklungsserver
npm test         # Tests (Beitragsberechnung, Kündigung, CSV-Import, Zuordnung, GuV)
npm run build    # erzeugt dist/index.html (eine einzige Datei, ~1,3 MB inkl. SQLite)
```

Technik: React + TypeScript + Vite, SQLite über [sql.js](https://github.com/sql-js/sql.js) (WebAssembly), alles in eine HTML-Datei gebündelt.
Aufbau und Datenmodell: [docs/KONZEPT.md](docs/KONZEPT.md).

## Hinweis

Die Kategorien orientieren sich am DATEV-Kontenrahmen SKR04, sind aber für Vereine vereinfacht und frei anpassbar. Die App ersetzt keine steuerliche Beratung.

© oemedia.de – alle Rechte vorbehalten. Nutzung nur mit ausdrücklicher Genehmigung, siehe [LICENSE](LICENSE).
