// Erzeugt einen fiktiven Beispielverein zum Ausprobieren. Alle Namen, Adressen und IBANs sind erfunden.

import { autoAssign } from '../lib/bank';
import { activeMonths, rateFor } from '../lib/fees';
import { toISO } from '../lib/format';
import { all, createNew, run, scalar, setSetting, tx } from './db';
import type { FeeRate, Member } from './schema';
import { saveVereinsdaten } from '../lib/verein';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Erzeugt eine formal gültige (fiktive) deutsche IBAN. */
function fakeIban(r: () => number): string {
  const blz = '1' + String(Math.floor(r() * 1e7)).padStart(7, '0');
  const kto = String(Math.floor(r() * 1e10)).padStart(10, '0');
  const bban = blz + kto;
  const num = bban + '131400'; // DE = 13 14, Prüfziffer 00
  let rest = 0;
  for (const d of num) rest = (rest * 10 + Number(d)) % 97;
  return `DE${String(98 - rest).padStart(2, '0')}${bban}`;
}

const VORNAMEN = ['Lukas', 'Mia', 'Jonas', 'Emma', 'Leon', 'Hannah', 'Finn', 'Sofia', 'Paul', 'Lea', 'Ben', 'Marie', 'Elias', 'Lina', 'Noah', 'Emilia', 'Felix', 'Clara', 'Anton', 'Ida', 'Karl', 'Greta', 'Tim', 'Nele', 'Moritz', 'Frieda'];
const NACHNAMEN = ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Richter', 'Klein', 'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Braun', 'Zimmermann', 'Krüger'];
const STRASSEN = ['Hauptstraße', 'Gartenweg', 'Lindenallee', 'Schulstraße', 'Am Sportplatz', 'Bergstraße', 'Mühlweg', 'Waldstraße'];
const GRADE = ['unranked', 'kyu9', 'kyu8', 'kyu7', 'kyu6', 'kyu5', 'kyu4', 'kyu3', 'kyu2', 'kyu1', 'dan1', 'dan2', 'dan3'];

export function loadDemo() {
  createNew({ vereinName: 'Karate-Dojo Musterstadt e. V. (Demo)' });
  const r = rng(42);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const now = new Date();
  const thisYear = now.getFullYear();
  const lastYear = thisYear - 1;
  const today = toISO(now);

  tx(() => {
    saveVereinsdaten({
      verein_strasse: 'Am Dojo 1', verein_plz: '12345', verein_ort: 'Musterstadt', verein_email: 'vorstand@example.org',
      verein_registergericht: 'Amtsgericht Musterstadt', verein_registernummer: 'VR 1234', verein_finanzamt: 'Musterstadt',
      verein_gruendung: '1985', verein_verband: 'Karate-Landesverband (Demo)',
    });
    setSetting('beitragskonto_ab', lastYear);
    const cat = (nr: string) => scalar<number>('SELECT id FROM categories WHERE nummer = ?', [nr])!;
    const groups = all<{ id: number; name: string }>('SELECT id, name FROM fee_groups');
    const gid = (n: string) => groups.find((g) => g.name.startsWith(n))!.id;
    // Beitragssätze: Vorjahr etwas günstiger
    for (const g of groups) {
      const cur = scalar<number>('SELECT monatsbeitrag_cent FROM fee_rates WHERE fee_group_id = ? AND jahr = ?', [g.id, thisYear]) ?? 0;
      run('INSERT OR IGNORE INTO fee_rates(fee_group_id, jahr, monatsbeitrag_cent) VALUES (?,?,?)', [g.id, lastYear, Math.max(0, cur - 200)]);
    }

    // Mitglieder
    const ids: number[] = [];
    for (let i = 0; i < 26; i++) {
      const kind = i % 3 === 0;
      const birthYear = kind ? thisYear - 7 - Math.floor(r() * 9) : thisYear - 20 - Math.floor(r() * 40);
      const eintrittYear = i < 20 ? lastYear - Math.floor(r() * 6) : thisYear;
      const eintritt = `${eintrittYear}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-01`;
      const vorname = VORNAMEN[i % VORNAMEN.length];
      const nachname = pick(NACHNAMEN);
      const grad = kind ? GRADE[Math.floor(r() * 6)] : GRADE[Math.floor(r() * GRADE.length)];
      const zahlweise = i % 4 === 0 ? 'monatlich' : i % 5 === 0 ? 'halbjaehrlich' : 'jaehrlich';
      const austritt = i === 5 ? `${lastYear}-12-31` : i === 9 ? toISO(new Date(thisYear, now.getMonth() + 4, 0)) : null;
      const plz = String(12340 + Math.floor(r() * 9));
      const id = run(
        `INSERT INTO members(mitgliedsnr, anrede, vorname, nachname, geburtsdatum, strasse, plz, ort, email, telefon, mobil, grad, fee_group_id,
           zahlweise, eintritt, austritt, kuendigung_eingang, kontoinhaber, iban, sepa_mandat_ref, sepa_mandat_datum, erziehungsberechtigte)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          String(1001 + i), i % 2 ? 'Frau' : 'Herr', vorname, nachname,
          `${birthYear}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`,
          `${pick(STRASSEN)} ${1 + Math.floor(r() * 80)}`, plz, 'Musterstadt',
          `${vorname.toLowerCase()}.${nachname.toLowerCase().replace(/ü/g, 'ue').replace(/ö/g, 'oe')}@example.org`,
          `06181 ${100000 + Math.floor(r() * 899999)}`, `0151 ${10000000 + Math.floor(r() * 89999999)}`,
          grad, kind ? gid('Kinder') : i === 11 ? gid('Ehren') : i === 13 ? gid('Familie') : gid('Erwachsene'),
          zahlweise, eintritt, austritt, i === 9 ? today : null,
          kind ? `${pick(['Andrea', 'Thomas', 'Sabine', 'Michael'])} ${nachname}` : `${vorname} ${nachname}`,
          i % 7 === 3 ? null : fakeIban(r), `MITGL-${1001 + i}`, eintritt,
          kind ? `${pick(['Andrea', 'Thomas', 'Sabine', 'Michael'])} ${nachname}` : null,
        ],
      );
      ids.push(id);
      if (grad !== 'unranked') run('INSERT INTO graduations(member_id, grad, datum, pruefer) VALUES (?,?,?,?)', [id, grad, `${lastYear}-06-15`, 'Sensei Beispiel']);
    }
    // Vorstand und Ämter
    const amt = (funktion: string, memberId: number, vorstand: 0 | 1) =>
      run('INSERT INTO officers(funktion, member_id, gewaehlt_am, amtszeit_bis, vertretungsberechtigt) VALUES (?,?,?,?,?)', [
        funktion, memberId, `${lastYear}-03-15`, `${thisYear + 1}-03-31`, vorstand,
      ]);
    amt('Vorsitzende/r', ids[1], 1);
    amt('2. Vorsitzende/r', ids[2], 1);
    amt('Kassenwart/in', ids[4], 1);
    amt('Schriftführer/in', ids[6], 0);
    amt('Beisitzer/in', ids[7], 0);
    amt('Kassenprüfer/in', ids[8], 0);
    amt('Kassenprüfer/in', ids[10], 0);
    run('INSERT INTO member_charges(member_id, jahr, datum, betrag_cent, beschreibung, category_id) VALUES (?,?,?,?,?,?)', [ids[22], thisYear, `${thisYear}-02-01`, 3000, 'Aufnahmegebühr', cat('4011')]);

    // Partner
    const halle = run('INSERT INTO partners(name, typ, iban, default_category_id) VALUES (?,?,?,?)', ['Stadt Musterstadt – Sporthalle', 'vermieter', fakeIban(r), cat('6310')]);
    const shop = run('INSERT INTO partners(name, typ, iban, default_category_id) VALUES (?,?,?,?)', ['Budo-Shop Beispiel GmbH', 'lieferant', fakeIban(r), cat('5200')]);
    const dkv = run('INSERT INTO partners(name, typ, iban, default_category_id) VALUES (?,?,?,?)', ['Karate-Landesverband (Demo)', 'verband', fakeIban(r), cat('6420')]);
    const vers = run('INSERT INTO partners(name, typ, iban, default_category_id) VALUES (?,?,?,?)', ['Vereinsversicherung Beispiel AG', 'lieferant', fakeIban(r), cat('6400')]);
    const lsb = run('INSERT INTO partners(name, typ, iban, default_category_id) VALUES (?,?,?,?)', ['Kreissportbund (Demo)', 'zuschussgeber', fakeIban(r), cat('4030')]);
    const trainer = run('INSERT INTO partners(name, typ, iban, default_category_id) VALUES (?,?,?,?)', ['Sensei Beispiel (Übungsleiter)', 'sonstige', fakeIban(r), cat('6020')]);
    const partner = (id: number) => all<{ name: string; iban: string }>('SELECT name, iban FROM partners WHERE id = ?', [id])[0];

    // Konto
    const acc = run('INSERT INTO accounts(name, bank, iban, anfangssaldo_cent, anfangsdatum) VALUES (?,?,?,?,?)', ['Girokonto Verein', 'Sparkasse (Demo)', 'DE02120300000000202051', 412345, `${lastYear}-01-01`]);
    const book = (datum: string, betrag: number, name: string, iban: string | null, zweck: string, text: string) => {
      if (datum > today) return;
      run('INSERT INTO transactions(account_id, buchungsdatum, valutadatum, betrag_cent, gegen_name, gegen_iban, verwendungszweck, buchungstext) VALUES (?,?,?,?,?,?,?,?)', [acc, datum, datum, betrag, name, iban, zweck, text]);
    };
    const rates = all<FeeRate>('SELECT * FROM fee_rates');
    const members = all<Member>('SELECT * FROM members');
    for (const year of [lastYear, thisYear]) {
      const d = (m: number, day: number) => `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      for (let m = 1; m <= 12; m++) {
        const h = partner(halle);
        book(d(m, 3), -12000, h.name, h.iban, `Hallennutzung ${String(m).padStart(2, '0')}/${year}`, 'FOLGELASTSCHRIFT');
        const t = partner(trainer);
        book(d(m, 28), -15000, t.name, t.iban, `Übungsleiterpauschale ${String(m).padStart(2, '0')}/${year}`, 'DAUERAUFTRAG');
        book(d(m, 30), -790, '', null, 'Entgeltabrechnung Kontoführung', 'ENTGELTABSCHLUSS');
      }
      const v = partner(dkv);
      book(d(2, 15), -(members.length * 1500), v.name, v.iban, `Jahresbeitrag Verband ${year}, ${members.length} Mitglieder`, 'LASTSCHRIFT');
      const vs = partner(vers);
      book(d(1, 20), -38900, vs.name, vs.iban, `Haftpflicht/Unfall Police 4711 ${year}`, 'LASTSCHRIFT');
      const sb = partner(lsb);
      book(d(9, 12), 60000, sb.name, sb.iban, `Übungsleiterzuschuss ${year}`, 'GUTSCHRIFT');
      const s = partner(shop);
      book(d(4, 8), -64980, s.name, s.iban, `Rechnung RE-${year}-0815 Karateanzüge`, 'ONLINE-UEBERWEISUNG');
      book(d(5, 10), -12990, s.name, s.iban, `Rechnung RE-${year}-0912 Gürtel`, 'ONLINE-UEBERWEISUNG');
      book(d(6, 20), 4500, 'Erlös Prüfung', null, `Prüfungsgebühren Juni ${year} bar eingezahlt`, 'BAREINZAHLUNG');
      book(d(7, 2), 25000, 'Bäckerei Beispiel', fakeIban(r), 'Spende Sommerfest', 'GUTSCHRIFT');
      book(d(11, 5), -8950, 'Pokale & Medaillen Shop', fakeIban(r), 'Bestellung 55123 Pokale Vereinsmeisterschaft', 'ONLINE-UEBERWEISUNG');
      book(d(12, 31), 112, '', null, 'Habenzinsen', 'ABSCHLUSS');

      // Beitragszahlungen
      for (const m of members) {
        const months = activeMonths(m.eintritt, m.austritt, year);
        if (!months.length || !m.iban) continue;
        const fee = rateFor(rates, m.fee_group_id, year).cent;
        if (!fee) continue;
        const name = m.kontoinhaber ?? `${m.vorname} ${m.nachname}`;
        const skip = m.mitgliedsnr === '1004' && year === thisYear; // ein säumiges Mitglied
        if (skip) continue;
        if (m.zahlweise === 'monatlich') {
          for (const mo of months) book(d(mo, 1), fee, name, m.iban, `Mitgliedsbeitrag ${String(mo).padStart(2, '0')}/${year} ${m.vorname} ${m.nachname}`, 'GUTSCHR. UEBERW. DAUERAUFTR');
        } else if (m.zahlweise === 'halbjaehrlich') {
          const h1 = months.filter((x) => x <= 6).length;
          const h2 = months.filter((x) => x > 6).length;
          if (h1) book(d(Math.max(1, months[0]), 5), fee * h1, name, m.iban, `Beitrag 1. Halbjahr ${year} Mitgl.-Nr. ${m.mitgliedsnr}`, 'GUTSCHR. UEBERW.');
          if (h2) book(d(7, 5), fee * h2, name, m.iban, `Beitrag 2. Halbjahr ${year} Mitgl.-Nr. ${m.mitgliedsnr}`, 'GUTSCHR. UEBERW.');
        } else {
          book(d(Math.max(1, months[0]), 10), fee * months.length, name, m.iban, `Jahresbeitrag ${year} ${m.vorname} ${m.nachname}`, 'GUTSCHR. UEBERW.');
        }
      }
    }
    run('INSERT INTO balance_checkpoints(account_id, datum, saldo_cent, notiz) SELECT ?, ?, ?, ?', [acc, `${lastYear}-12-31`, 0, 'Jahreskontoauszug']);
  });
  autoAssign();
  // Kontostand laut Auszug = berechneter Stand, damit die Demo-Abstimmung aufgeht
  const end = scalar<number>('SELECT anfangssaldo_cent + (SELECT COALESCE(SUM(betrag_cent),0) FROM transactions WHERE buchungsdatum <= ?) FROM accounts LIMIT 1', [`${lastYear}-12-31`]) ?? 0;
  run('UPDATE balance_checkpoints SET saldo_cent = ?', [end]);
}
