import { useState } from 'react';
import { EIGENBELEG_GRUENDE, eigenbelegSpeichern, type Eigenbeleg } from '../lib/eigenbeleg';
import { DateInput, Field, Modal, MoneyInput, TextArea, TextInput, toast } from './ui';

/** Eigenbeleg aus einer Buchung erzeugen: Angaben prüfen, Grund eintragen, PDF wird als Beleg gespeichert. */
export function EigenbelegDialog({ initial, onClose, onCreated }: { initial: Eigenbeleg; onClose: () => void; onCreated?: (docId: number) => void }) {
  const [e, setE] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Eigenbeleg>(k: K) => (v: Eigenbeleg[K]) => setE({ ...e, [k]: v });
  const ausgabe = e.betrag_cent < 0;
  const save = async () => {
    setBusy(true);
    try {
      const id = await eigenbelegSpeichern(e);
      toast('Eigenbeleg erstellt und der Buchung zugeordnet');
      onCreated?.(id);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'bad');
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Eigenbeleg erstellen"
      onClose={onClose}
      footer={<>
        <span className="muted small">Wird als PDF im Verein gespeichert – ausdrucken, unterschreiben, fertig.</span>
        <span className="spacer" />
        <button onClick={onClose}>Abbrechen</button>
        <button className="primary" disabled={busy || !e.grund.trim()} onClick={() => void save()}>{busy ? 'Wird erstellt …' : 'Eigenbeleg erstellen'}</button>
      </>}
    >
      <p className="muted small">Die Angaben sind aus der Buchung übernommen und können angepasst werden.</p>
      <div className="form-grid cols-2">
        <Field label="Datum der Zahlung"><DateInput value={e.datum} onChange={(v) => v && set('datum')(v)} /></Field>
        <Field label={ausgabe ? 'Betrag (Ausgabe)' : 'Betrag (Einnahme)'}>
          <MoneyInput value={Math.abs(e.betrag_cent)} onChange={(v) => set('betrag_cent')((ausgabe ? -1 : 1) * Math.abs(v ?? 0))} />
        </Field>
        <Field label={ausgabe ? 'Zahlungsempfänger' : 'Einzahler'} span={2}><TextInput value={e.partner} onChange={set('partner')} /></Field>
        <Field label="Verwendungszweck" span={2}><TextInput value={e.zweck} onChange={set('zweck')} /></Field>
        <Field label="Kategorie" span={2}><TextInput value={e.kategorie} onChange={(v) => set('kategorie')(v || null)} /></Field>
        <Field label="Grund für den Eigenbeleg (Bemerkung)" span={2}>
          <TextArea value={e.grund} onChange={set('grund')} rows={3} />
        </Field>
        <div className="span-2 chips">
          {EIGENBELEG_GRUENDE.map((g) => (
            <button key={g} type="button" className="chip" title={g} onClick={() => set('grund')(g)}>{g.split(' – ')[0].split(/[.(]/)[0]}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
