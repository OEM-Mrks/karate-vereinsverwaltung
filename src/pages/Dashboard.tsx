import { useState } from 'react';
import { all, getSetting, scalar } from '../db/db';
import type { Account, Member } from '../db/schema';
import { GRADES } from '../db/seed';
import { navigate, useQuery } from '../hooks';
import { balanceAt, isCalibrated } from '../lib/bank';
import { balanceBefore, isActive, loadFeeContext, yearSummary } from '../lib/fees';
import { earliestExitDate, formatDate, formatEUR, todayISO } from '../lib/format';
import { buildReport } from '../lib/report';
import { memberName } from '../lib/lookups';
import { missingFields, requiredFields } from '../lib/completeness';
import { officers } from '../lib/verein';
import { faelligkeiten } from '../lib/recurring';
import { Checkbox, PageHeader, Stat } from '../components/ui';
import { PdfPreview } from '../components/PdfPreview';
import { vorstandsberichtPdf } from '../lib/pdfDocs';

export function Dashboard() {
  const today = todayISO();
  const [bericht, setBericht] = useState(false);
  const [mitNamen, setMitNamen] = useState(false);
  const year = new Date().getFullYear();
  const d = useQuery(() => {
    const members = all<Member>('SELECT * FROM members');
    const active = members.filter((m) => isActive(m, today));
    const ctx = loadFeeContext();
    let offenFaellig = 0;
    const debtors: { m: Member; offen: number }[] = [];
    for (const m of members) {
      const s = yearSummary(m, year, ctx);
      const v = balanceBefore(m, year, ctx);
      const f = s.offenFaellig + v;
      if (f > 0) {
        offenFaellig += f;
        debtors.push({ m, offen: f });
      }
    }
    debtors.sort((a, b) => b.offen - a.offen);
    const accounts = all<Account>('SELECT * FROM accounts WHERE aktiv = 1');
    const saldo = accounts.reduce((s, a) => s + (balanceAt(a, today) ?? 0), 0);
    const unabgeglichen = accounts.filter((a) => !isCalibrated(a));
    const open = scalar<number>('SELECT COUNT(*) FROM transactions t WHERE NOT EXISTS (SELECT 1 FROM allocations a WHERE a.transaction_id = t.id)') ?? 0;
    const r = buildReport(year);
    const upcomingExits = members.filter((m) => m.austritt && m.austritt >= today).sort((a, b) => a.austritt!.localeCompare(b.austritt!));
    const recentJoins = members.filter((m) => m.eintritt.startsWith(String(year))).length;
    const gradeCounts = GRADES.map((g) => ({ g, n: active.filter((m) => m.grad === g.id).length })).filter((x) => x.n);
    const lastTx = scalar<string>('SELECT MAX(buchungsdatum) FROM transactions');
    const changes = Number(getSetting('changes_since_export', '0'));
    const aemter = officers();
    const amtszeitAbgelaufen = aemter.filter((o) => o.abgelaufen);
    const ohneVorstand = aemter.length === 0;
    const req = requiredFields();
    // Kontostand zum 31.12. des Vorjahres laut Auszug erfasst?
    const ultimo = `${year - 1}-12-31`;
    const ohneAuszug = accounts.filter((a) => a.anfangsdatum <= ultimo && !scalar('SELECT 1 FROM balance_checkpoints WHERE account_id = ? AND datum = ?', [a.id, ultimo]));
    const wiederkehrend = faelligkeiten(year).filter((f) => f.status === 'ueberfaellig' || f.status === 'faellig');
    const incomplete = members.filter((m) => (!m.austritt || m.austritt >= today) && missingFields(m, req).length).length;
    return { members, active, offenFaellig, debtors, saldo, open, r, upcomingExits, recentJoins, gradeCounts, lastTx, accounts, changes, incomplete, ohneAuszug, unabgeglichen, amtszeitAbgelaufen, ohneVorstand, wiederkehrend };
  });
  const frist = Number(getSetting('kuendigungsfrist_monate', '3')) || 3;
  const maxGrade = Math.max(1, ...d.gradeCounts.map((x) => x.n));

  return (
    <div className="page">
      <PageHeader
        title="Übersicht"
        subtitle={`${getSetting('verein_name')} · Stand ${formatDate(today)}`}
        actions={<button className="primary" onClick={() => setBericht(true)}>Vorstandsbericht (PDF)</button>}
      />
      {bericht && (
        <PdfPreview
          title={`Vorstandsbericht ${formatDate(today)}`}
          filename={`Vorstandsbericht_${today}.pdf`}
          build={() => vorstandsberichtPdf(today, { mitNamen })}
          deps={[mitNamen]}
          options={<Checkbox checked={mitNamen} onChange={setMitNamen} label="Säumige Mitglieder namentlich aufführen (vertraulich)" />}
          onClose={() => setBericht(false)}
        />
      )}
      <div className="stats">
        <Stat label="Aktive Mitglieder" value={d.active.length} sub={`${d.recentJoins} Eintritte ${year}`} onClick={() => navigate('mitglieder')} />
        <Stat
          label="Kontostand"
          value={formatEUR(d.saldo)}
          tone={d.unabgeglichen.length ? 'warn' : undefined}
          sub={d.unabgeglichen.length ? '⚠︎ nicht abgeglichen – nur Summe der Buchungen' : d.lastTx ? `letzte Buchung ${formatDate(d.lastTx)}` : 'noch keine Buchungen'}
          onClick={() => { try { localStorage.setItem('vv:bank.tab', '"konten"'); } catch { /* egal */ } navigate('konto'); }}
        />
        <Stat label={`Ergebnis ${year}`} value={formatEUR(d.r.ergebnis)} tone={d.r.ergebnis >= 0 ? 'ok' : 'bad'} sub={`${formatEUR(d.r.summeEin)} Einnahmen · ${formatEUR(d.r.summeAus)} Ausgaben`} onClick={() => navigate('guv')} />
        <Stat label="Fällige offene Beiträge" value={formatEUR(d.offenFaellig)} tone={d.offenFaellig > 0 ? 'warn' : 'ok'} sub={`${d.debtors.length} Mitglieder`} onClick={() => navigate('beitraege')} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Zu erledigen</h3>
          <ul className="todo">
            {d.changes > 0 && <li className="warn"><a href="#/daten">💾 {d.changes} Änderungen seit der letzten Sicherung – jetzt sichern</a></li>}
            {!d.accounts.length && <li><a href="#/import">⇪ Erste Umsätze (CSV) importieren</a></li>}
            {d.open > 0 && <li><a href="#/konto" onClick={() => { try { localStorage.setItem('vv:bank.tab', '"einrichtung"'); } catch { /* egal */ } }}>🔗 {d.open} Buchungen noch nicht zugeordnet</a></li>}
            {d.incomplete > 0 && <li><a href="#/mitglieder" onClick={() => { try { localStorage.setItem('vv:members.filter', '"unvollstaendig"'); } catch { /* egal */ } }}>👤 {d.incomplete} Mitglieder mit fehlenden Angaben</a></li>}
            {d.unabgeglichen.length > 0 && <li className="warn"><a href="#/konto" onClick={() => { try { localStorage.setItem('vv:bank.tab', '"konten"'); } catch { /* egal */ } }}>🏦 Kontostand noch nicht abgeglichen ({d.unabgeglichen.map((a) => a.name).join(', ')}) – einmal den aktuellen Kontostand eingeben</a></li>}
            {d.amtszeitAbgelaufen.length > 0 && <li><a href="#/verein">🏛 Amtszeit abgelaufen: {d.amtszeitAbgelaufen.map((o) => `${o.funktion} ${o.anzeigename}`).join(', ')}</a></li>}
            {d.ohneVorstand && <li><a href="#/verein">🏛 Vorstand und Kassenprüfer eintragen</a></li>}
            {d.ohneAuszug.length > 0 && <li><a href="#/konto" onClick={() => { try { localStorage.setItem('vv:bank.tab', '"konten"'); } catch { /* egal */ } }}>🏦 Kontostand 31.12.{year - 1} laut Auszug noch nicht erfasst ({d.ohneAuszug.map((a) => a.name).join(', ')})</a></li>}
            {d.wiederkehrend.length > 0 && <li className={d.wiederkehrend.some((f) => f.status === 'ueberfaellig') ? 'warn' : ''}><a href="#/wiederkehrend">↻ {d.wiederkehrend.length === 1 ? `„${d.wiederkehrend[0].r.name}" ist fällig` : `${d.wiederkehrend.length} wiederkehrende Zahlungen fällig`} – abhaken</a></li>}
            {d.r.fehlendeBelege > 0 && <li><a href="#/belege">📄 {d.r.fehlendeBelege} Buchungen {year} ohne (vollständige) Belege</a></li>}
            {d.members.length === 0 && <li><a href="#/mitglieder">👤 Mitglieder anlegen</a></li>}
            {d.changes === 0 && d.open === 0 && d.r.fehlendeBelege === 0 && d.wiederkehrend.length === 0 && d.incomplete === 0 && d.ohneAuszug.length === 0 && d.unabgeglichen.length === 0 && !d.ohneVorstand && !d.amtszeitAbgelaufen.length && d.accounts.length > 0 && <li className="ok">✓ Alles erledigt</li>}
          </ul>
          <div className="callout">
            <strong>Kündigung heute eingehend:</strong> frühester Austritt zum <strong>{formatDate(earliestExitDate(today, frist))}</strong>
            <div className="muted small">{frist} Monate Frist zum Monatsende</div>
          </div>
        </div>
        <div className="card">
          <h3>Bevorstehende Austritte</h3>
          {d.upcomingExits.length ? (
            <table className="table clickable-rows">
              <tbody>
                {d.upcomingExits.slice(0, 8).map((m) => (
                  <tr key={m.id} onClick={() => navigate(`mitglieder/${m.id}`)}><td>{memberName(m)}</td><td className="num">{formatDate(m.austritt)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted small">Keine.</p>}
          <h3 className="mt">Höchste Rückstände</h3>
          {d.debtors.length ? (
            <table className="table clickable-rows">
              <tbody>
                {d.debtors.slice(0, 6).map(({ m, offen }) => (
                  <tr key={m.id} onClick={() => navigate(`mitglieder/${m.id}`)}><td>{memberName(m)}</td><td className="num neg">{formatEUR(offen)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted small">Keine fälligen Rückstände. 👍</p>}
        </div>
      </div>
      {d.gradeCounts.length > 0 && (
        <div className="card">
          <h3>Graduierungen (aktive Mitglieder)</h3>
          <div className="grade-chart">
            {d.gradeCounts.map(({ g, n }) => (
              <div key={g.id} className="grade-bar" title={`${g.name}: ${n}`}>
                <span className="grade-bar-label">{g.name}</span>
                <span className="grade-bar-track"><span className="grade-bar-fill" style={{ width: `${(n / maxGrade) * 100}%`, background: g.farbe, borderColor: g.rand ?? g.farbe }} /></span>
                <span className="grade-bar-n">{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
