import { getSetting } from '../db/db';
import { downloadBlob } from '../db/storage';
import { useLocalState, useQuery } from '../hooks';
import { formatDate, formatEUR } from '../lib/format';
import { buildReport, reportToCSV, type ReportLine } from '../lib/report';
import { Badge, PageHeader, YearSelect } from '../components/ui';

export function ReportPage() {
  const [year, setYear] = useLocalState('year', new Date().getFullYear());
  const [showPrev, setShowPrev] = useLocalState('report.prev', true);
  const r = useQuery(() => buildReport(year), [year]);
  const verein = useQuery(() => getSetting('verein_name'));

  const exportCsv = () => downloadBlob('﻿' + reportToCSV(r, verein), `guv-${year}.csv`, 'text/csv;charset=utf-8');
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
        title={`Gewinn- und Verlustrechnung ${year}`}
        subtitle={<>{verein} · Einnahmen-Überschuss-Rechnung nach Zahlungsfluss (Zuflussprinzip), alle Beträge brutto</>}
        actions={<>
          <label className="checkbox no-print"><input type="checkbox" checked={showPrev} onChange={(e) => setShowPrev(e.target.checked)} /> Vorjahr</label>
          <YearSelect value={year} onChange={setYear} />
          <button onClick={exportCsv}>CSV</button>
          <button className="primary" onClick={() => window.print()}>Drucken / PDF</button>
        </>}
      />

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
            <tr><th style={{ width: '5em' }}>Konto</th><th>Bezeichnung</th><th className="num">{year}</th>{showPrev && <th className="num muted">{year - 1}</th>}</tr>
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
              <td /><td>Jahresergebnis {r.ergebnis >= 0 ? '(Überschuss)' : '(Fehlbetrag)'}</td>
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
            <tr><th>Konto</th><th className="num">Anfangsbestand</th><th className="num">Kontostand 31.12.{year}</th><th className="num">Veränderung</th><th className="num">laut Kontoauszug</th></tr>
          </thead>
          <tbody>
            {r.konten.map((k) => {
              const diff = k.laut_auszug && k.ende != null ? k.ende - k.laut_auszug.saldo_cent : null;
              return (
                <tr key={k.account.id}>
                  <td>{k.account.name}</td>
                  <td className="num">{formatEUR(k.anfang)}<div className="muted small">{k.anfangDatum.endsWith('-01-01') ? `01.01.${year}` : `Kontoeröffnung ${formatDate(k.anfangDatum)}`}</div></td>
                  <td className="num">{formatEUR(k.ende)}</td>
                  <td className={`num ${k.bewegung < 0 ? 'neg' : ''}`}>{formatEUR(k.bewegung)}</td>
                  <td className="num">
                    {k.laut_auszug ? (
                      <>{formatEUR(k.laut_auszug.saldo_cent)} {diff === 0 ? <Badge tone="ok">✓</Badge> : <Badge tone="bad">Diff. {formatEUR(diff)}</Badge>}</>
                    ) : <span className="muted small no-print"><a href="#/konto">erfassen</a></span>}
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
            <tr className="total"><td>= Kontostand 31.12.{year}</td><td className="num">{formatEUR(r.kontoAnfang + r.summeEin - r.summeAus + r.summeNeutral + r.unzugeordnet.summe)}</td></tr>
            <tr><td>Differenz zum berechneten Kontostand</td><td className="num">{r.differenz === 0 ? <Badge tone="ok">0,00 € ✓</Badge> : <Badge tone="bad">{formatEUR(r.differenz)}</Badge>}</td></tr>
          </tbody>
        </table>
        <p className="muted small">
          Die Veränderung des Kontostands zwischen 1.1. und 31.12. entspricht dem Jahresergebnis zuzüglich nicht ergebniswirksamer Bewegungen.
          Trage den Kontostand laut Jahreskontoauszug ein, um fehlende oder doppelte Importe zu erkennen.
        </p>
      </div>
      <div className="print-only signature">
        <div>Ort, Datum</div><div>Kassenwart/in</div><div>Kassenprüfer/in</div>
      </div>
    </div>
  );
}
