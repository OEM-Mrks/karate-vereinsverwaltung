import { useState } from 'react';
import type { Transaction, Zahlweise } from '../db/schema';
import { ZAHLWEISEN } from '../lib/fees';
import { formatEUR, formatIBAN, yearOf } from '../lib/format';
import { categoryOptions, feeGroups, memberOptions, PARTNER_TYPEN, partnerOptions } from '../lib/lookups';
import { createMember, createPartner, guessFeeGroup, guessMemberName, memberNoFromText, nextMemberNo, suggestEntry } from '../lib/setup';
import { attempt, Checkbox, DateInput, Field, Modal, Select, TextInput } from './ui';

/** Neues Mitglied aus einer Kontobewegung – nur der Name ist Pflicht, der Rest kann später ergänzt werden. */
export function QuickMemberDialog(props: { tx: Transaction; onClose: () => void; onCreated: (id: number, applyToOthers: boolean) => void }) {
  const t = props.tx;
  const guess = guessFeeGroup(t.betrag_cent, yearOf(t.buchungsdatum));
  const named = guessMemberName(t);
  const nrAusZweck = memberNoFromText(t.verwendungszweck);
  const [v, setV] = useState(() => ({
    mitgliedsnr: nrAusZweck ?? nextMemberNo(),
    vorname: named.vorname,
    nachname: named.nachname,
    eintritt: suggestEntry(t),
    fee_group_id: (guess?.fee_group_id ?? feeGroups()[0]?.id ?? null) as number | null,
    zahlweise: (guess?.zahlweise ?? 'jaehrlich') as Zahlweise,
    iban: t.gegen_iban,
    kontoinhaber: t.gegen_name,
  }));
  const [others, setOthers] = useState(true);
  const groups = feeGroups();
  const save = () => {
    let id = 0;
    if (attempt(() => { id = createMember(v); }, `Mitglied ${v.vorname} ${v.nachname} angelegt`)) props.onCreated(id, others);
  };
  return (
    <Modal
      title="Neues Mitglied aus Zahlung"
      onClose={props.onClose}
      footer={<><button onClick={props.onClose}>Abbrechen</button><button className="primary" disabled={!v.nachname.trim() || !v.eintritt} onClick={save}>Mitglied anlegen</button></>}
    >
      <p className="muted small">
        Zahlung von <strong>{t.gegen_name || '–'}</strong> über {formatEUR(t.betrag_cent)}{t.verwendungszweck ? ` – „${t.verwendungszweck}"` : ''}.
        Zahlt ein Elternteil für ein Kind, trage hier den Namen des Kindes ein – der Kontoinhaber bleibt für die Zuordnung gespeichert.
      </p>
      <div className="form-grid cols-2">
        <Field label="Vorname" hint={named.ausZweck ? 'aus dem Verwendungszweck erkannt' : undefined}><TextInput value={v.vorname} onChange={(x) => setV({ ...v, vorname: x })} autoFocus /></Field>
        <Field label="Nachname *"><TextInput value={v.nachname} onChange={(x) => setV({ ...v, nachname: x })} /></Field>
        <Field label="Mitgliedsnummer" hint={nrAusZweck ? 'aus dem Verwendungszweck erkannt' : 'nächste freie Nummer'}>
          <TextInput value={v.mitgliedsnr} onChange={(x) => setV({ ...v, mitgliedsnr: x })} />
        </Field>
        <Field label="Eintritt *" hint="Vorschlag – bitte prüfen"><DateInput value={v.eintritt} onChange={(x) => setV({ ...v, eintritt: x ?? '' })} /></Field>
        <Field label="Beitragsgruppe" hint={guess ? 'anhand des Betrags erkannt' : undefined}>
          <Select value={v.fee_group_id} onChange={(x) => setV({ ...v, fee_group_id: x })} empty="– keine –" options={groups.map((g) => ({ value: g.id, label: g.name }))} />
        </Field>
        <Field label="Zahlweise">
          <Select value={v.zahlweise} onChange={(x) => setV({ ...v, zahlweise: (x ?? 'jaehrlich') as Zahlweise })} options={ZAHLWEISEN.map((z) => ({ value: z.id, label: z.name }))} />
        </Field>
        <Field label="Kontoinhaber"><TextInput value={v.kontoinhaber} onChange={(x) => setV({ ...v, kontoinhaber: x })} /></Field>
        <Field label="IBAN" span={2}><TextInput value={formatIBAN(v.iban)} onChange={(x) => setV({ ...v, iban: x })} /></Field>
      </div>
      <Checkbox checked={others} onChange={setOthers} label="Weitere offene Zahlungen dieses Kontos sofort diesem Mitglied zuordnen" />
      <p className="muted small">Anschrift, Geburtsdatum, Kontakt usw. kannst du später ergänzen – das Mitglied erscheint dann unter „Mitglieder → Unvollständig".</p>
    </Modal>
  );
}

/** Neuer Lieferant / Partner aus einer Kontobewegung inkl. Standardkategorie (wirkt wie eine Regel). */
export function QuickPartnerDialog(props: { tx: Transaction; categoryId?: number | null; onClose: () => void; onCreated: (id: number, applyToOthers: boolean) => void }) {
  const t = props.tx;
  const [v, setV] = useState({
    name: t.gegen_name || '',
    typ: t.betrag_cent >= 0 ? 'zuschussgeber' : 'lieferant',
    iban: t.gegen_iban,
    default_category_id: props.categoryId ?? null,
  });
  const [others, setOthers] = useState(true);
  const save = () => {
    let id = 0;
    if (attempt(() => { id = createPartner(v); }, `${v.name} angelegt`)) props.onCreated(id, others);
  };
  return (
    <Modal
      title="Neuer Lieferant / Partner aus Zahlung"
      onClose={props.onClose}
      footer={<><button onClick={props.onClose}>Abbrechen</button><button className="primary" disabled={!v.name.trim()} onClick={save}>Anlegen</button></>}
    >
      <div className="form-grid cols-2">
        <Field label="Name *" span={2}><TextInput value={v.name} onChange={(x) => setV({ ...v, name: x })} autoFocus /></Field>
        <Field label="Art"><Select value={v.typ} onChange={(x) => setV({ ...v, typ: x ?? 'lieferant' })} options={PARTNER_TYPEN} /></Field>
        <Field label="IBAN"><TextInput value={formatIBAN(v.iban)} onChange={(x) => setV({ ...v, iban: x })} /></Field>
        <Field label="Standardkategorie" span={2} hint="Künftige Zahlungen von/an diesen Partner werden automatisch so zugeordnet">
          <Select value={v.default_category_id} onChange={(x) => setV({ ...v, default_category_id: x })} empty="– wählen –" options={categoryOptions()} />
        </Field>
      </div>
      <Checkbox checked={others} onChange={setOthers} label="Weitere offene Zahlungen dieses Partners sofort zuordnen" />
    </Modal>
  );
}

/** Auswahl eines bestehenden Mitglieds bzw. Lieferanten oder nur einer Kategorie. */
export function PickDialog(props: {
  title: string;
  kind: 'member' | 'partner' | 'category';
  onClose: () => void;
  onPick: (id: number, categoryId: number | null) => void;
  hint?: string;
}) {
  const [id, setId] = useState<number | null>(null);
  const [cat, setCat] = useState<number | null>(null);
  const options = props.kind === 'member' ? memberOptions() : props.kind === 'partner' ? partnerOptions() : categoryOptions();
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={<><button onClick={props.onClose}>Abbrechen</button><button className="primary" disabled={!id} onClick={() => id && props.onPick(id, cat)}>Übernehmen</button></>}
    >
      {props.hint && <p className="muted small">{props.hint}</p>}
      <div className="form-grid cols-2">
        <Field label={props.kind === 'member' ? 'Mitglied' : props.kind === 'partner' ? 'Lieferant / Partner' : 'Kategorie'} span={2}>
          <Select value={id} onChange={setId} empty="– wählen –" options={options} />
        </Field>
        {props.kind === 'partner' && (
          <Field label="Kategorie (falls der Partner noch keine hat)" span={2}>
            <Select value={cat} onChange={setCat} empty="– Standardkategorie des Partners –" options={categoryOptions()} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
