import { useState } from 'react';
import { getSetting } from '../db/db';
import type { Account } from '../db/schema';
import { downloadBlob } from '../db/storage';
import { useLocalState, useQuery } from '../hooks';
import { formatDate, formatEUR, todayISO, toISO } from '../lib/format';
import { buildReport, reportToCSV, shiftYear, type ReportLine } from '../lib/report';
import { Badge, DateInput, PageHeader, YearSelect } from '../components/ui';
import { CalibrateDialog } from '../components/Calibrate';
import { isCalibrated } from '../lib/bank';

type Period = 'jahr' | 'bisHeute' | 'q1' | 'q2' | 'q3' | 'q4' | 'h1' | 'h2' | 'monat' | 'frei';

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function periodRange(year: number, p: Period, monat: number, frei: { von: string; bis: string }): { von: string; bis: string } {
  const d = (m: number, day: number) => toISO(new Date(year, m - 1, day));
  const end = (m: number) => toISO(new Date(year, m, 0));
  switch (p) {
    case 'bisHeute': {
      const t = todayISO();
      return { von: d(1, 1), bis: t < `${year}-12-31` && t >= `${year}-01-01` ? t : `${year}-12-31` };
    }
    case 'q1': return { von: d(1, 1), bis: end(3) };
    case 'q2': return { von: d(4, 1), bis: end(6) };
    case 'q3': return { von: d(7, 1), bis: end(9) };
    case 'q4': return { von: d(10, 1), bis: end(12) };
    case 'h1': return { von: d(1, 1), bis: end(6) };
    case 'h2': return { von: d(7, 1), bis: end(12) };
    case 'monat': return { von: d(monat, 1), bis: end(monat) };
    case 'frei': return frei;
    default: return { von: d(1, 1), bis: end(12) };
  }
}

export function ReportPage() {
  const [year, setYear] = useLocalState('year', new Date().getFullYear());
  const [showPrev, setShowPrev] = useLocalState('report.prev', true);
  const [period, setPeriod] = useLocalState<Period>('report.period', 'jahr');
  const [monat, setMonat] = useState(new Date().getMonth() + 1);
  const [frei, setFrei] = useState({ von: `${year}-01-01`, bis: todayISO() });
  const [checkpointFor, setCheckpointFor] = useState<Account | null>(null);
  const range = periodRange(year, period, monat, frei);
  const r = useQuery(() => buildReport(year, range.von, range.bis), [year, range.von, range.bis]);
  const zeitraum = r.ganzesJahr ? String(year) : `${formatDate(r.von)} – ${formatDate(r.bis)}`;
  const fehlendAuszug = r.konten.filter((k) => !k.laut_auszug);
  const unabgeglichen = r.konten.filter((k) => !isCalibrated(k.account));
  const abweichung = r.konten.filter((k) => k.laut_auszug && k.ende != null && k.ende !== k.laut_auszug.saldo_cent);
  const verein = useQuery(() => getSetting('verein_name'));

  const exportCsv = () => downloadBlob('﻿' + reportToCSV(r, verein), `guv-${r.ganzesJahr ? year : `${r.von}_${r.bis}`}.csv`, 'text/csv;charset=utf-8');
  const lines = (ls: ReportLine[]) =>
    ls.map((l) => (
      <tr key={l.category.id}>
        <td className="mono muted">{l.category.nummer}</td>
        <td>{l.category.name}</td>
        <td className="num">{formatEUR(l.summe)}</td>
        {showPrev && <td className="num muted">{formatEUR(l.vorjahr)}</td>}
      </tr>
    ));
  const cols = showPrev ? 4 : 3;

  return (
    <div className="page report-page">
      <PageHeader
        title={`Gewinn- und Verlustrechnung ${zeitraum}`}
        subtitle={<>{verein} · Einnahmen-Überschuss-Rechnung nach Zahlungsfluss (Zuflussprinzip), alle Beträge brutto</>}
        actions={<>
          <label className="checkbox no-print"><input type="checkbox" checked={showPrev} onChange={(e) => setShowPrev(e.target.checked)} /> Vorjahr</label>
          <YearSelect value={year} onChange={(y) => { setYear(y); setFrei({ von: `${y}-01-01`, bis: `${y}-12-31` }); }} />
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Zeitraum">
            <option value="jahr">Ganzes Jahr</option>
            <option value="bisHeute">1.1. bis heute</option>
            <option value="q1">1. Quartal</option>
            <option value="q2">2. Quartal</option>
            <option value="q3">3. Quartal</option>
            <option value="q4">4. Quartal</option>
            <option value="h1">1. Halbjahr</option>
            <option value="h2">2. Halbjahr</option>
            <option value="monat">Monat …</option>
            <option value="frei">Frei wählen …</option>
          </select>
          {period === 'monat' && (
            <select value={monat} onChange={(e) => setMonat(Number(e.target.value))} aria-label="Monat">
              {MONATE.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          )}
          {period === 'frei' && (
            <span className="inline">
              <DateInput value={frei.von} onChange={(v) => v && setFrei({ ...frei, von: v })} />
              <span>bis</span>
              <DateInput value={frei.bis} onChange={(v) => v && setFrei({ ...frei, bis: v })} />
            </span>
          )}
          <button onClick={exportCsv}>CSV</button>
          <button className="primary" onClick={() => window.print()}>Drucken / PDF</button>
        </>}
      />

      {!r.ganzesJahr && (
        <div className="callout no-print">
          Unterjährige Auswertung: {formatDate(r.von)} bis {formatDate(r.bis)}{showPrev ? `, verglichen mit ${formatDate(shiftYear(r.von, -1))} bis ${formatDate(shiftYear(r.bis, -1))}` : ''}.
          Es zählen nur bereits importierte Kontobewegungen – Beiträge, die noch nicht eingegangen sind, fehlen naturgemäß.
        </div>
      )}
      {unabgeglichen.length > 0 && (
        <div className="callout bad no-print">
          <strong>Kontostand nicht abgeglichen:</strong> Für {unabgeglichen.map((k) => k.account.name).join(', ')} ist noch kein Kontostand laut Bank hinterlegt.
          Die Kontostände unten sind deshalb nur die Summe der Buchungen.{' '}
          {unabgeglichen.map((k) => <button key={k.account.id} className="link" onClick={() => setCheckpointFor(k.account)}>Jetzt für „{k.account.name}" abgleichen</button>)}
        </div>
      )}
      {r.konten.length > 0 && unabgeglichen.length === 0 && (
        <div className={`callout no-print ${abweichung.length ? 'bad' : fehlendAuszug.length ? '' : 'ok'}`}>
          <strong>Kontoabstimmung zum {formatDate(r.bis)}: </strong>
          {abweichung.length
            ? `Der berechnete Kontostand weicht bei ${abweichung.map((k) => k.account.name).join(', ')} vom Kontoauszug ab – vermutlich fehlen Umsätze oder wurden doppelt importiert.`
            : fehlendAuszug.length
              ? <>Kontostand laut Auszug noch nicht erfasst. <span className="inline">{fehlendAuszug.map((k) => (
                  <button key={k.account.id} className="link" onClick={() => setCheckpointFor(k.account)}>Für „{k.account.name}" erfassen</button>
                ))}</span></>
              : '✓ Berechneter Kontostand stimmt mit dem Kontoauszug überein.'}
        </div>
      )}
      {(r.unzugeordnet.anzahl > 0 || r.fehlendeBelege > 0 || r.differenz !== 0) && (
        <div className="callout warn no-print">
          {r.unzugeordnet.anzahl > 0 && <div>⚠︎ {r.unzugeordnet.anzahl} Buchungen ({formatEUR(r.unzugeordnet.summe)}) sind noch nicht (vollständig) zugeordnet. <a href="#/konto">Jetzt zuordnen</a></div>}
          {r.fehlendeBelege > 0 && <div>⚠︎ Bei {r.fehlendeBelege} belegpflichtigen Buchungen fehlt der Beleg. <a href="#/belege">Belege ansehen</a></div>}
          {r.differenz !== 0 && <div>⚠︎ Abstimmungsdifferenz {formatEUR(r.differenz)}</div>}
        </div>
      )}

      <div className="card report">
        <table className="table report-table">
          <thead>
            <tr><th style={{ width: '5em' }}>Konto</th><th>Bezeichnung</th><th className="num">{r.ganzesJahr ? year : 'Zeitraum'}</th>{showPrev && <th className="num muted">{r.ganzesJahr ? year - 1 : 'Vorjahr'}</th>}</tr>
          </thead>
          {r.bloecke.filter((b) => b.einnahmen.length || b.ausgaben.length).map((b) => (
            <tbody key={b.sphaere}>
              <tr className="section"><td colSpan={cols}>{b.name}</td></tr>
              {b.einnahmen.length > 0 && <tr className="sub"><td /><td colSpan={cols - 1}>Einnahmen</td></tr>}
              {lines(b.einnahmen)}
              {b.ausgaben.length > 0 && <tr className="sub"><td /><td colSpan={cols - 1}>Ausgaben</td></tr>}
              {lines(b.ausgaben)}
              <tr className="subtotal">
                <td /><td>Ergebnis {b.name}</td>
                <td className={`num ${b.ergebnis < 0 ? 'neg' : ''}`}>{formatEUR(b.ergebnis)}</td>
                {showPrev && <td className="num muted">{formatEUR(b.vorjahrEin - b.vorjahrAus)}</td>}
              </tr>
            </tbody>
          ))}
          <tbody>
            <tr className="total"><td /><td>Summe Einnahmen</td><td className="num">{formatEUR(r.summeEin)}</td>{showPrev && <td />}</tr>
            <tr className="total"><td /><td>Summe Ausgaben</td><td className="num">{formatEUR(r.summeAus)}</td>{showPrev && <td />}</tr>
            <tr className="grand">
              <td /><td>{r.ganzesJahr ? 'Jahresergebnis' : 'Ergebnis im Zeitraum'} {r.ergebnis >= 0 ? '(Überschuss)' : '(Fehlbetrag)'}</td>
              <td className={`num ${r.ergebnis < 0 ? 'neg' : 'pos'}`}>{formatEUR(r.ergebnis)}</td>
              {showPrev && <td className="num muted">{formatEUR(r.vorjahrErgebnis)}</td>}
            </tr>
          </tbody>
          {(r.neutral.length > 0 || r.unzugeordnet.anzahl > 0) && (
            <tbody>
              <tr className="section"><td colSpan={cols}>Nicht ergebniswirksame Kontobewegungen</td></tr>
              {r.neutral.map((l) => (
                <tr key={l.category.id}>
                  <td className="mono muted">{l.category.nummer}</td><td>{l.category.name}</td>
                  <td className="num">{formatEUR(l.summe)}</td>{showPrev && <td className="num muted">{formatEUR(l.vorjahr)}</td>}
                </tr>
              ))}
              {r.unzugeordnet.anzahl > 0 && (
                <tr className="warn-row"><td /><td>Nicht zugeordnet ({r.unzugeordnet.anzahl} Buchungen)</td><td className="num">{formatEUR(r.unzugeordnet.summe)}</td>{showPrev && <td />}</tr>
              )}
            </tbody>
          )}
        </table>
      </div>

      <div className="card report">
        <h3>Kontenentwicklung und Abstimmung</h3>
        <table className="table">
          <thead>
            <tr><th>Konto</th><th className="num">Anfangsbestand</th><th className="num">Kontostand {formatDate(r.bis)}</th><th className="num">Veränderung</th><th className="num">laut Kontoauszug</th></tr>
          </thead>
          <tbody>
            {r.konten.map((k) => {
              const diff = k.laut_auszug && k.ende != null ? k.ende - k.laut_auszug.saldo_cent : null;
              return (
                <tr key={k.account.id}>
                  <td>{k.account.name}</td>
                  <td className="num">{formatEUR(k.anfang)}<div className="muted small">{k.anfangDatum === r.von ? formatDate(r.von) : `Kontoeröffnung ${formatDate(k.anfangDatum)}`}</div></td>
                  <td className="num">{formatEUR(k.ende)}</td>
                  <td className={`num ${k.bewegung < 0 ? 'neg' : ''}`}>{formatEUR(k.bewegung)}</td>
                  <td className="num">
                    {k.laut_auszug ? (
                      <>{formatEUR(k.laut_auszug.saldo_cent)} {diff === 0 ? <Badge tone="ok">✓</Badge> : <Badge tone="bad">Diff. {formatEUR(diff)}</Badge>}</>
                    ) : <button className="link small no-print" onClick={() => setCheckpointFor(k.account)}>erfassen</button>}
                  </td>
                </tr>
              );
            })}
            {r.konten.length > 1 && (
              <tr className="total"><td>Summe</td><td className="num">{formatEUR(r.kontoAnfang)}</td><td className="num">{formatEUR(r.kontoEnde)}</td><td className="num">{formatEUR(r.kontoBewegung)}</td><td /></tr>
            )}
            {!r.konten.length && <tr><td colSpan={5} className="empty">Noch kein Konto angelegt.</td></tr>}
          </tbody>
        </table>
        <table className="table recon">
          <tbody>
            <tr><td>Kontostand zu Beginn</td><td className="num">{formatEUR(r.kontoAnfang)}</td></tr>
            <tr><td>+ Einnahmen</td><td className="num">{formatEUR(r.summeEin)}</td></tr>
            <tr><td>− Ausgaben</td><td className="num">{formatEUR(r.summeAus)}</td></tr>
            {r.summeNeutral !== 0 && <tr><td>± neutrale Bewegungen</td><td className="num">{formatEUR(r.summeNeutral)}</td></tr>}
            {r.unzugeordnet.summe !== 0 && <tr><td>± nicht zugeordnet</td><td className="num">{formatEUR(r.unzugeordnet.summe)}</td></tr>}
            <tr className="total"><td>= Kontostand {formatDate(r.bis)}</td><td className="num">{formatEUR(r.kontoAnfang + r.summeEin - r.summeAus + r.summeNeutral + r.unzugeordnet.summe)}</td></tr>
            <tr><td>Differenz zum berechneten Kontostand</td><td className="num">{r.differenz === 0 ? <Badge tone="ok">0,00 € ✓</Badge> : <Badge tone="bad">{formatEUR(r.differenz)}</Badge>}</td></tr>
          </tbody>
        </table>
        <p className="muted small">
          Die Veränderung des Kontostands im Zeitraum entspricht dem Jahresergebnis zuzüglich nicht ergebniswirksamer Bewegungen.
          Trage den Kontostand laut Jahreskontoauszug ein, um fehlende oder doppelte Importe zu erkennen.
        </p>
      </div>
      {checkpointFor && <CalibrateDialog account={checkpointFor} datum={r.bis} onClose={() => setCheckpointFor(null)} />}
      <div className="print-only signature">
        <div>Ort, Datum</div><div>Kassenwart/in</div><div>Kassenprüfer/in</div>
      </div>
    </div>
  );
}
