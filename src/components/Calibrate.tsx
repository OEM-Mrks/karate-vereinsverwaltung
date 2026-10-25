import { useState } from 'react';
import { scalar } from '../db/db';
import type { Account } from '../db/schema';
import { calibrateOpening, isCalibrated, saveCheckpoint } from '../lib/bank';
import { formatDate, formatEUR, todayISO } from '../lib/format';
import { attempt, DateInput, Field, MoneyInput, Modal } from './ui';

/**
 * Kontostand laut Bank eingeben. Standard bei noch nicht abgeglichenem Konto: Anfangssaldo daraus zurückrechnen,
 * sonst nur als Kontrollwert speichern (Abweichungen zeigen fehlende Importe).
 */
export function CalibrateForm(props: { account: Account; datum?: string; onDone?: () => void; compact?: boolean }) {
  const a = props.account;
  const [datum, setDatum] = useState<string | null>(props.datum ?? todayISO());
  const [saldo, setSaldo] = useState<number | null>(null);
  const [mode, setMode] = useState<'anfang' | 'kontrolle'>(isCalibrated(a) ? 'kontrolle' : 'anfang');
  const sum = datum
    ? scalar<number>('SELECT COALESCE(SUM(betrag_cent),0) FROM transactions WHERE account_id = ? AND buchungsdatum <= ?', [a.id, datum]) ?? 0
    : 0;
  const berechnet = a.anfangssaldo_cent + (datum ? scalar<number>(
    'SELECT COALESCE(SUM(betrag_cent),0) FROM transactions WHERE account_id = ? AND buchungsdatum >= ? AND buchungsdatum <= ?', [a.id, a.anfangsdatum, datum],
  ) ?? 0 : 0);
  const save = () => {
    if (!datum || saldo == null) return;
    const ok = attempt(() => {
      if (mode === 'anfang') calibrateOpening(a.id, datum, saldo, 'Kontostand laut Bank');
      else saveCheckpoint(a.id, datum, saldo, 'Kontostand laut Bank');
    }, mode === 'anfang' ? 'Kontostand abgeglichen – Anfangssaldo neu berechnet' : 'Kontrollwert gespeichert');
    if (ok) props.onDone?.();
  };
  return (
    <div className="calibrate">
      <div className="form-grid cols-2">
        <Field label="Stichtag (Ende des Tages)"><DateInput value={datum} onChange={setDatum} /></Field>
        <Field label="Kontostand laut Bank / Kontoauszug"><MoneyInput value={saldo} onChange={setSaldo} autoFocus={!props.compact} /></Field>
      </div>
      <div className="radio-list">
        <label className="checkbox">
          <input type="radio" checked={mode === 'anfang'} onChange={() => setMode('anfang')} />
          <span>Anfangssaldo daraus berechnen – danach stimmt der Kontostand an jedem Tag</span>
        </label>
        <label className="checkbox">
          <input type="radio" checked={mode === 'kontrolle'} onChange={() => setMode('kontrolle')} />
          <span>Nur als Kontrollwert speichern (z. B. Jahreskontoauszug zum 31.12.)</span>
        </label>
      </div>
      {saldo != null && datum && (
        <p className="muted small">
          {mode === 'anfang'
            ? <>Neuer Anfangssaldo: <strong>{formatEUR(saldo - sum)}</strong> (= {formatEUR(saldo)} − {formatEUR(sum)} Buchungen bis {formatDate(datum)}).</>
            : <>Berechnet am {formatDate(datum)}: {formatEUR(berechnet)} – {berechnet === saldo ? 'stimmt überein ✓' : `Abweichung ${formatEUR(berechnet - saldo)}`}</>}
        </p>
      )}
      <button className="primary" disabled={!datum || saldo == null} onClick={save}>Übernehmen</button>
    </div>
  );
}

export function CalibrateDialog(props: { account: Account; datum?: string; onClose: () => void }) {
  return (
    <Modal title={`Kontostand abgleichen – ${props.account.name}`} onClose={props.onClose}>
      <p className="muted small">
        Trage einen Kontostand aus dem Online-Banking oder vom Kontoauszug ein. Am einfachsten: den <strong>heutigen Kontostand</strong>,
        nachdem alle Umsätze bis heute importiert sind.
      </p>
      <CalibrateForm account={props.account} datum={props.datum} onDone={props.onClose} />
    </Modal>
  );
}
