import { useRef, useState } from 'react';
import type { Officer } from '../db/schema';
import { useQuery } from '../hooks';
import { formatDate } from '../lib/format';
import { memberOptions } from '../lib/lookups';
import { deleteOfficer, FUNKTIONEN, getVereinsdaten, officers, saveOfficer, saveVereinsdaten, type OfficerView, type Vereinsdaten } from '../lib/verein';
import { getLogo, removeLogo, saveLogo } from '../lib/logo';
import { attempt, Badge, Checkbox, DateInput, Empty, Field, Modal, PageHeader, Select, TextArea, TextInput, toast } from '../components/ui';

export function VereinPage() {
  const [edit, setEdit] = useState<Partial<Officer> | null>(null);
  const list = useQuery(() => officers());
  const vorstand = list.filter((o) => o.vertretungsberechtigt);
  return (
    <div className="page">
      <PageHeader title="Verein & Vorstand" subtitle="Stammdaten des Vereins und alle Ämter – wird für Briefe, Kassenprüfbericht und GuV verwendet." />
      <LogoCard />
      <VereinsdatenCard />
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Vorstand und Ämter</h3>
            <div className="muted small">
              {vorstand.length
                ? <>Vertretungsberechtigter Vorstand (§ 26 BGB): {vorstand.map((o) => o.anzeigename).join(', ')}</>
                : 'Markiere die Personen, die laut Satzung den Verein vertreten (§ 26 BGB).'}
            </div>
          </div>
          <button className="primary" onClick={() => setEdit({ funktion: 'Vorsitzende/r', vertretungsberechtigt: 1 })}>+ Amt hinzufügen</button>
        </div>
        {list.length ? (
          <table className="table clickable-rows">
            <thead><tr><th>Funktion</th><th>Name</th><th>Kontakt</th><th>Gewählt am</th><th>Amtszeit bis</th><th /></tr></thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} onClick={() => setEdit(o)}>
                  <td><strong>{o.funktion}</strong>{o.vertretungsberechtigt ? <div><Badge tone="info">Vorstand § 26</Badge></div> : null}</td>
                  <td>{o.anzeigename}{o.member_id ? <span className="muted small"> · Mitglied</span> : null}</td>
                  <td className="small">{o.kontakt || '–'}</td>
                  <td>{formatDate(o.gewaehlt_am)}</td>
                  <td>{o.amtszeit_bis ? (o.abgelaufen ? <Badge tone="warn">abgelaufen {formatDate(o.amtszeit_bis)}</Badge> : formatDate(o.amtszeit_bis)) : '–'}</td>
                  <td className="small muted">{o.notiz}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>
            Noch keine Ämter eingetragen. Typisch: Vorsitzende/r, 2. Vorsitzende/r, Kassenwart/in, Schriftführer/in, Beisitzer/innen und zwei Kassenprüfer/innen.
          </Empty>
        )}
      </div>
      {edit && <OfficerDialog o={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function LogoCard() {
  const logo = useQuery(() => getLogo());
  const input = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    try {
      await saveLogo(f);
      toast('Logo gespeichert');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    }
  };
  return (
    <div className="card logo-card">
      <div className="logo-preview">{logo ? <img src={logo} alt="Vereinslogo" /> : <span className="muted small">kein Logo</span>}</div>
      <div>
        <h3>Vereinslogo</h3>
        <p className="muted small">Erscheint in der Seitenleiste und im Kopf aller PDF-Dokumente (GuV, Prüfbericht, Briefe). PNG, JPG oder SVG – wird automatisch verkleinert.</p>
        <div className="actions">
          <button onClick={() => input.current?.click()}>{logo ? 'Logo ersetzen' : 'Logo hochladen'}</button>
          {logo && <button className="danger-outline" onClick={() => confirm('Logo entfernen?') && attempt(() => removeLogo(), 'Logo entfernt')}>Entfernen</button>}
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      </div>
    </div>
  );
}

function VereinsdatenCard() {
  const initial = useQuery(() => getVereinsdaten());
  const [v, setV] = useState<Vereinsdaten>(initial);
  const [dirty, setDirty] = useState(false);
  const set = (k: keyof Vereinsdaten) => (x: string) => { setV({ ...v, [k]: x }); setDirty(true); };
  const save = () => attempt(() => { saveVereinsdaten(v); setDirty(false); }, 'Vereinsdaten gespeichert');
  return (
    <div className="card">
      <div className="card-head">
        <h3>Vereinsdaten</h3>
        <button className={dirty ? 'primary' : ''} disabled={!dirty || !v.verein_name.trim()} onClick={save}>Speichern</button>
      </div>
      <div className="form-grid">
        <Field label="Name des Vereins" span={2}><TextInput value={v.verein_name} onChange={set('verein_name')} /></Field>
        <Field label="Gegründet"><TextInput value={v.verein_gruendung} onChange={set('verein_gruendung')} placeholder="z. B. 1985" /></Field>
        <div />
        <h3 className="span-4">Geschäftsanschrift & Kontakt</h3>
        <Field label="Straße und Hausnummer" span={2}><TextInput value={v.verein_strasse} onChange={set('verein_strasse')} /></Field>
        <Field label="PLZ"><TextInput value={v.verein_plz} onChange={set('verein_plz')} /></Field>
        <Field label="Ort"><TextInput value={v.verein_ort} onChange={set('verein_ort')} /></Field>
        <Field label="E-Mail"><TextInput type="email" value={v.verein_email} onChange={set('verein_email')} /></Field>
        <Field label="Telefon"><TextInput type="tel" value={v.verein_telefon} onChange={set('verein_telefon')} /></Field>
        <Field label="Website" span={2}><TextInput value={v.verein_website} onChange={set('verein_website')} /></Field>
        <h3 className="span-4">Register & Steuer</h3>
        <Field label="Registergericht"><TextInput value={v.verein_registergericht} onChange={set('verein_registergericht')} placeholder="Amtsgericht …" /></Field>
        <Field label="Vereinsregister-Nr."><TextInput value={v.verein_registernummer} onChange={set('verein_registernummer')} placeholder="VR …" /></Field>
        <Field label="Finanzamt"><TextInput value={v.verein_finanzamt} onChange={set('verein_finanzamt')} /></Field>
        <Field label="Steuernummer"><TextInput value={v.verein_steuernummer} onChange={set('verein_steuernummer')} /></Field>
        <Field label="Freistellungsbescheid vom" hint="Gemeinnützigkeit – wichtig für Spendenquittungen">
          <DateInput value={v.verein_freistellung_datum || null} onChange={(x) => set('verein_freistellung_datum')(x ?? '')} />
        </Field>
        <Field label="Dachverband"><TextInput value={v.verein_verband} onChange={set('verein_verband')} placeholder="z. B. DKV / Landesverband" /></Field>
        <Field label="Mitgliedsnr. im Verband"><TextInput value={v.verein_verband_nr} onChange={set('verein_verband_nr')} /></Field>
      </div>
      {dirty && <p className="muted small mt">Ungespeicherte Änderungen.</p>}
    </div>
  );
}

function OfficerDialog({ o, onClose }: { o: Partial<OfficerView>; onClose: () => void }) {
  const [v, setV] = useState<Partial<Officer>>(o);
  const [mitMitglied, setMitMitglied] = useState(o.member_id != null || !o.id);
  const set = <K extends keyof Officer>(k: K) => (x: Officer[K] | null) => setV({ ...v, [k]: x });
  const valid = !!v.funktion?.trim() && (mitMitglied ? !!v.member_id : !!v.name?.trim());
  const save = () => attempt(() => { saveOfficer({ ...v, member_id: mitMitglied ? v.member_id : null }); onClose(); }, 'Gespeichert');
  const remove = () => confirm(`${o.funktion} „${o.anzeigename}" entfernen?`) && attempt(() => deleteOfficer(o.id!), 'Entfernt') && onClose();
  return (
    <Modal
      title={o.id ? `${o.funktion} bearbeiten` : 'Amt hinzufügen'}
      onClose={onClose}
      footer={<>{o.id && <button className="danger-outline" onClick={remove}>Entfernen</button>}<button onClick={onClose}>Abbrechen</button><button className="primary" disabled={!valid} onClick={save}>Speichern</button></>}
    >
      <div className="form-grid cols-2">
        <Field label="Funktion" span={2}>
          <TextInput value={v.funktion} onChange={(x) => setV({ ...v, funktion: x, vertretungsberechtigt: /^(2\. )?Vorsitzende|Kassenwart/.test(x) ? 1 : v.vertretungsberechtigt })} list="funktionen" />
          <datalist id="funktionen">{FUNKTIONEN.map((f) => <option key={f} value={f} />)}</datalist>
        </Field>
        <div className="span-2 radio-list">
          <label className="checkbox"><input type="radio" checked={mitMitglied} onChange={() => setMitMitglied(true)} /> <span>Vereinsmitglied</span></label>
          <label className="checkbox"><input type="radio" checked={!mitMitglied} onChange={() => setMitMitglied(false)} /> <span>Andere Person (kein Mitglied)</span></label>
        </div>
        {mitMitglied ? (
          <Field label="Mitglied" span={2}><Select value={v.member_id ?? null} onChange={set('member_id')} empty="– wählen –" options={memberOptions()} /></Field>
        ) : (
          <Field label="Name" span={2}><TextInput value={v.name} onChange={set('name')} /></Field>
        )}
        <Field label="E-Mail (Amt)" hint={mitMitglied ? 'leer = E-Mail des Mitglieds' : undefined}><TextInput type="email" value={v.email} onChange={set('email')} /></Field>
        <Field label="Telefon (Amt)" hint={mitMitglied ? 'leer = Telefon des Mitglieds' : undefined}><TextInput type="tel" value={v.telefon} onChange={set('telefon')} /></Field>
        <Field label="Gewählt am"><DateInput value={v.gewaehlt_am} onChange={set('gewaehlt_am')} /></Field>
        <Field label="Amtszeit bis"><DateInput value={v.amtszeit_bis} onChange={set('amtszeit_bis')} /></Field>
        <div className="span-2">
          <Checkbox checked={!!v.vertretungsberechtigt} onChange={(x) => set('vertretungsberechtigt')(x ? 1 : 0)} label="Gehört zum vertretungsberechtigten Vorstand (§ 26 BGB)" />
        </div>
        <Field label="Notiz" span={2}><TextArea value={v.notiz} onChange={set('notiz')} rows={2} /></Field>
      </div>
    </Modal>
  );
}
