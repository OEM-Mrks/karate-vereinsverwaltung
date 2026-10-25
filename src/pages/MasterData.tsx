import { useState } from 'react';
import { all, run, scalar } from '../db/db';
import type { Category, Partner, Rule } from '../db/schema';
import { SPHAEREN } from '../db/schema';
import { useQuery } from '../hooks';
import { autoAssign } from '../lib/bank';
import { formatEUR, formatIBAN, isValidIBAN, normalizeIBAN } from '../lib/format';
import { categoryOptions, memberOptions, PARTNER_TYPEN, partnerOptions } from '../lib/lookups';
import { attempt, Badge, Checkbox, Empty, Field, Modal, MoneyInput, PageHeader, Select, TextArea, TextInput, toast } from '../components/ui';

// ---------- Lieferanten / Partner ----------

export function PartnersPage() {
  const [edit, setEdit] = useState<Partial<Partner> | null>(null);
  const [search, setSearch] = useState('');
  const list = useQuery(() =>
    all<Partner & { kat: string | null; umsatz: number; anzahl: number }>(
      `SELECT p.*, c.nummer || ' ' || c.name AS kat, COALESCE(SUM(a.betrag_cent), 0) AS umsatz, COUNT(a.id) AS anzahl
       FROM partners p LEFT JOIN categories c ON c.id = p.default_category_id LEFT JOIN allocations a ON a.partner_id = p.id
       GROUP BY p.id ORDER BY p.name`,
    ),
  );
  const q = search.toLowerCase();
  const visible = list.filter((p) => !q || [p.name, p.iban, p.kat, p.kundennummer].some((v) => v?.toLowerCase().includes(q)));
  return (
    <div className="page">
      <PageHeader
        title="Lieferanten & Partner"
        subtitle="Einkaufsquellen, Vermieter, Verbände, Zuschussgeber – mit Standardkategorie für die automatische Zuordnung."
        actions={<button className="primary" onClick={() => setEdit({ typ: 'lieferant' })}>+ Neuer Partner</button>}
      />
      <div className="toolbar"><input className="search" placeholder="Suchen …" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {visible.length ? (
        <div className="table-wrap">
          <table className="table clickable-rows">
            <thead><tr><th>Name</th><th>Art</th><th>IBAN</th><th>Standardkategorie</th><th className="num">Buchungen</th><th className="num">Summe</th></tr></thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id} onClick={() => setEdit(p)}>
                  <td><strong>{p.name}</strong>{p.kundennummer && <div className="muted small">Kd.-Nr. {p.kundennummer}</div>}</td>
                  <td className="small">{PARTNER_TYPEN.find((t) => t.value === p.typ)?.label ?? p.typ}</td>
                  <td className="mono small">{formatIBAN(p.iban)}</td>
                  <td className="small">{p.kat ?? <span className="muted">–</span>}</td>
                  <td className="num">{p.anzahl}</td>
                  <td className={`num ${p.umsatz < 0 ? 'neg' : ''}`}>{formatEUR(p.umsatz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Noch keine Partner. Lege z. B. die Sporthalle (Vermieter), den Budo-Shop und den Landesverband an.</Empty>}
      {edit && <PartnerDialog p={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PartnerDialog({ p, onClose }: { p: Partial<Partner>; onClose: () => void }) {
  const [v, setV] = useState(p);
  const isNew = !p.id;
  const set = <K extends keyof Partner>(k: K) => (x: Partner[K] | null) => setV({ ...v, [k]: x });
  const save = () => {
    let id = p.id ?? 0;
    const vals = [v.name!.trim(), v.typ ?? 'lieferant', normalizeIBAN(v.iban) || null, v.email || null, v.telefon || null, v.anschrift || null, v.kundennummer || null, v.default_category_id ?? null, v.notizen || null];
    const ok = attempt(() => {
      if (isNew) id = run('INSERT INTO partners(name, typ, iban, email, telefon, anschrift, kundennummer, default_category_id, notizen) VALUES (?,?,?,?,?,?,?,?,?)', vals);
      else run('UPDATE partners SET name=?, typ=?, iban=?, email=?, telefon=?, anschrift=?, kundennummer=?, default_category_id=?, notizen=? WHERE id=?', [...vals, id]);
    }, 'Gespeichert');
    if (!ok) return;
    if (v.iban || v.name) {
      const r = autoAssign();
      if (r.zugeordnet) toast(`${r.zugeordnet} offene Buchungen jetzt automatisch zugeordnet`, 'info');
    }
    onClose();
  };
  const remove = () => confirm(`„${p.name}" löschen? Zuordnungen bleiben erhalten, verlieren aber den Partner.`) && attempt(() => run('DELETE FROM partners WHERE id = ?', [p.id!]), 'Gelöscht') && onClose();
  return (
    <Modal title={isNew ? 'Neuer Lieferant / Partner' : v.name} onClose={onClose}
      footer={<>{!isNew && <button className="danger-outline" onClick={remove}>Löschen</button>}<button onClick={onClose}>Abbrechen</button><button className="primary" disabled={!v.name?.trim()} onClick={save}>Speichern</button></>}>
      <div className="form-grid cols-2">
        <Field label="Name" span={2}><TextInput value={v.name} onChange={set('name')} autoFocus={isNew} /></Field>
        <Field label="Art"><Select value={v.typ ?? 'lieferant'} onChange={(x) => set('typ')(x ?? 'lieferant')} options={PARTNER_TYPEN} /></Field>
        <Field label="Eigene Kundennummer"><TextInput value={v.kundennummer} onChange={set('kundennummer')} /></Field>
        <Field label="IBAN" span={2} hint="Zahlungen von/an diese IBAN werden automatisch zugeordnet" error={v.iban && !isValidIBAN(v.iban) ? 'IBAN-Prüfziffer stimmt nicht' : undefined}>
          <TextInput value={v.iban} onChange={set('iban')} />
        </Field>
        <Field label="Standardkategorie" span={2}><Select value={v.default_category_id ?? null} onChange={set('default_category_id')} empty="– keine –" options={categoryOptions()} /></Field>
        <Field label="E-Mail"><TextInput value={v.email} onChange={set('email')} /></Field>
        <Field label="Telefon"><TextInput value={v.telefon} onChange={set('telefon')} /></Field>
        <Field label="Anschrift" span={2}><TextArea value={v.anschrift} onChange={set('anschrift')} rows={2} /></Field>
        <Field label="Notizen" span={2}><TextArea value={v.notizen} onChange={set('notizen')} rows={2} /></Field>
      </div>
    </Modal>
  );
}

// ---------- Kategorien ----------

export function CategoriesPage() {
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const list = useQuery(() =>
    all<Category & { anzahl: number }>(
      'SELECT c.*, (SELECT COUNT(*) FROM allocations a WHERE a.category_id = c.id) AS anzahl FROM categories c ORDER BY c.typ DESC, c.nummer',
    ),
  );
  const groups: { typ: Category['typ']; title: string }[] = [
    { typ: 'einnahme', title: 'Einnahmen' },
    { typ: 'ausgabe', title: 'Ausgaben' },
    { typ: 'neutral', title: 'Neutral (nicht ergebniswirksam)' },
  ];
  return (
    <div className="page">
      <PageHeader
        title="Kategorien"
        subtitle="Angelehnt an den DATEV-Kontenrahmen SKR04 und gegliedert nach den steuerlichen Bereichen eines gemeinnützigen Vereins. Alle Beträge brutto – keine Umsatzsteuer."
        actions={<button className="primary" onClick={() => setEdit({ typ: 'ausgabe', sphaere: 'ideell', aktiv: 1, beleg_pflicht: 1, mitgliedskonto: 0 })}>+ Neue Kategorie</button>}
      />
      {groups.map((g) => (
        <div className="card" key={g.typ}>
          <h3>{g.title}</h3>
          <table className="table clickable-rows">
            <thead><tr><th>Konto</th><th>Bezeichnung</th><th>Bereich</th><th>Eigenschaften</th><th className="num">Buchungen</th></tr></thead>
            <tbody>
              {list.filter((c) => c.typ === g.typ).map((c) => (
                <tr key={c.id} onClick={() => setEdit(c)} className={c.aktiv ? '' : 'inactive'}>
                  <td className="mono">{c.nummer}</td>
                  <td>{c.name}</td>
                  <td className="small">{SPHAEREN.find((s) => s.id === c.sphaere)?.name}</td>
                  <td className="inline">
                    {c.mitgliedskonto ? <Badge tone="info">Mitgliedskonto</Badge> : null}
                    {c.beleg_pflicht ? <Badge>Beleg nötig</Badge> : null}
                    {!c.aktiv && <Badge>inaktiv</Badge>}
                  </td>
                  <td className="num">{c.anzahl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {edit && <CategoryDialog c={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CategoryDialog({ c, onClose }: { c: Partial<Category>; onClose: () => void }) {
  const [v, setV] = useState(c);
  const isNew = !c.id;
  const save = () =>
    attempt(() => {
      const sph = v.typ === 'neutral' ? 'neutral' : v.sphaere === 'neutral' ? 'ideell' : v.sphaere ?? 'ideell';
      const vals = [v.nummer!.trim(), v.name!.trim(), v.typ!, sph, v.mitgliedskonto ? 1 : 0, v.beleg_pflicht ? 1 : 0, v.aktiv ? 1 : 0];
      if (isNew) run('INSERT INTO categories(nummer, name, typ, sphaere, mitgliedskonto, beleg_pflicht, aktiv) VALUES (?,?,?,?,?,?,?)', vals);
      else run('UPDATE categories SET nummer=?, name=?, typ=?, sphaere=?, mitgliedskonto=?, beleg_pflicht=?, aktiv=? WHERE id=?', [...vals, c.id!]);
      onClose();
    }, 'Gespeichert');
  const remove = () => {
    const n = scalar<number>('SELECT COUNT(*) FROM allocations WHERE category_id = ?', [c.id!]) ?? 0;
    if (n) return toast(`Kategorie wird in ${n} Buchungen verwendet – bitte stattdessen deaktivieren.`, 'bad');
    if (confirm(`Kategorie „${c.name}" löschen?`)) attempt(() => run('DELETE FROM categories WHERE id = ?', [c.id!]), 'Gelöscht') && onClose();
  };
  return (
    <Modal title={isNew ? 'Neue Kategorie' : `${c.nummer} ${c.name}`} onClose={onClose}
      footer={<>{!isNew && <button className="danger-outline" onClick={remove}>Löschen</button>}<button onClick={onClose}>Abbrechen</button><button className="primary" disabled={!v.nummer?.trim() || !v.name?.trim()} onClick={save}>Speichern</button></>}>
      <div className="form-grid cols-2">
        <Field label="Kontonummer (SKR04)"><TextInput value={v.nummer} onChange={(x) => setV({ ...v, nummer: x })} /></Field>
        <Field label="Art">
          <Select value={v.typ ?? 'ausgabe'} onChange={(x) => setV({ ...v, typ: x ?? 'ausgabe' })} options={[{ value: 'einnahme', label: 'Einnahme' }, { value: 'ausgabe', label: 'Ausgabe' }, { value: 'neutral', label: 'Neutral (z. B. Umbuchung)' }]} />
        </Field>
        <Field label="Bezeichnung" span={2}><TextInput value={v.name} onChange={(x) => setV({ ...v, name: x })} /></Field>
        {v.typ !== 'neutral' && (
          <Field label="Steuerlicher Bereich" span={2} hint="Für die Gliederung der GuV (wichtig für die Steuererklärung gemeinnütziger Vereine)">
            <Select value={v.sphaere ?? 'ideell'} onChange={(x) => setV({ ...v, sphaere: x ?? 'ideell' })} options={SPHAEREN.filter((s) => s.id !== 'neutral').map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
        )}
        <div className="span-2">
          <Checkbox checked={!!v.mitgliedskonto} onChange={(x) => setV({ ...v, mitgliedskonto: x ? 1 : 0 })} label="Zahlungen zählen auf das Beitragskonto des Mitglieds" />
          <Checkbox checked={!!v.beleg_pflicht} onChange={(x) => setV({ ...v, beleg_pflicht: x ? 1 : 0 })} label="Beleg erforderlich (Hinweis bei fehlendem PDF)" />
          <Checkbox checked={!!v.aktiv} onChange={(x) => setV({ ...v, aktiv: x ? 1 : 0 })} label="Aktiv (in Auswahllisten anzeigen)" />
        </div>
      </div>
    </Modal>
  );
}

// ---------- Regeln ----------

export function RulesPage() {
  const [edit, setEdit] = useState<Partial<Rule> | null>(null);
  const list = useQuery(() =>
    all<Rule & { kat: string | null; partner: string | null; mitglied: string | null }>(
      `SELECT r.*, c.nummer || ' ' || c.name AS kat, p.name AS partner, m.nachname || ', ' || m.vorname AS mitglied
       FROM rules r LEFT JOIN categories c ON c.id = r.category_id LEFT JOIN partners p ON p.id = r.partner_id LEFT JOIN members m ON m.id = r.member_id
       ORDER BY r.prioritaet, r.id`,
    ),
  );
  const run_ = () => {
    const r = autoAssign();
    toast(r.zugeordnet ? `${r.zugeordnet} von ${r.geprueft} offenen Buchungen zugeordnet` : 'Keine weiteren Treffer', r.zugeordnet ? 'ok' : 'info');
  };
  return (
    <div className="page">
      <PageHeader
        title="Zuordnungsregeln"
        subtitle="Reihenfolge der automatischen Zuordnung: Regeln mit Priorität unter 500 → IBAN eines Mitglieds → IBAN eines Partners → Mitgliedsnummer im Verwendungszweck → Name des Mitglieds → Name des Partners → übrige Regeln."
        actions={<><button onClick={run_}>⚡ Jetzt anwenden</button><button className="primary" onClick={() => setEdit({ prioritaet: 100, richtung: 'beide', aktiv: 1 })}>+ Neue Regel</button></>}
      />
      {list.length ? (
        <div className="table-wrap">
          <table className="table clickable-rows">
            <thead><tr><th className="num">Prio</th><th>Name</th><th>Bedingung</th><th>→ Zuordnung</th><th className="num">Treffer</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} onClick={() => setEdit(r)} className={r.aktiv ? '' : 'inactive'}>
                  <td className="num">{r.prioritaet}</td>
                  <td><strong>{r.name}</strong>{!r.aktiv && <Badge>inaktiv</Badge>}</td>
                  <td className="small">
                    {r.iban && <div>IBAN = <span className="mono">{formatIBAN(r.iban)}</span></div>}
                    {r.text_enthaelt && <div>Text enthält „{r.text_enthaelt.split('|').join('" oder „')}"</div>}
                    {r.richtung !== 'beide' && <div>{r.richtung === 'ein' ? 'nur Eingänge' : 'nur Ausgänge'}</div>}
                    {(r.betrag_min_cent != null || r.betrag_max_cent != null) && <div>Betrag {r.betrag_min_cent != null ? `ab ${formatEUR(r.betrag_min_cent)}` : ''} {r.betrag_max_cent != null ? `bis ${formatEUR(r.betrag_max_cent)}` : ''}</div>}
                  </td>
                  <td className="small">{r.kat ?? '–'}{(r.partner || r.mitglied) && <div className="muted">{r.partner ?? r.mitglied}</div>}</td>
                  <td className="num">{r.treffer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Noch keine Regeln. Regeln entstehen auch automatisch, wenn du eine Buchung manuell zuordnest („Merken").</Empty>}
      {edit && <RuleDialog r={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RuleDialog({ r, onClose }: { r: Partial<Rule>; onClose: () => void }) {
  const [v, setV] = useState(r);
  const isNew = !r.id;
  const set = <K extends keyof Rule>(k: K) => (x: Rule[K] | null) => setV({ ...v, [k]: x });
  const valid = v.name?.trim() && (v.iban?.trim() || v.text_enthaelt?.trim()) && v.category_id;
  const save = () =>
    attempt(() => {
      const vals = [v.name!.trim(), v.prioritaet ?? 100, v.aktiv ? 1 : 0, normalizeIBAN(v.iban) || null, v.text_enthaelt?.trim() || null, v.richtung ?? 'beide',
        v.betrag_min_cent ?? null, v.betrag_max_cent ?? null, v.category_id ?? null, v.partner_id ?? null, v.member_id ?? null];
      if (isNew) run('INSERT INTO rules(name, prioritaet, aktiv, iban, text_enthaelt, richtung, betrag_min_cent, betrag_max_cent, category_id, partner_id, member_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)', vals);
      else run('UPDATE rules SET name=?, prioritaet=?, aktiv=?, iban=?, text_enthaelt=?, richtung=?, betrag_min_cent=?, betrag_max_cent=?, category_id=?, partner_id=?, member_id=? WHERE id=?', [...vals, r.id!]);
      onClose();
    }, 'Regel gespeichert');
  const remove = () => confirm(`Regel „${r.name}" löschen?`) && attempt(() => run('DELETE FROM rules WHERE id = ?', [r.id!]), 'Gelöscht') && onClose();
  return (
    <Modal title={isNew ? 'Neue Regel' : `Regel: ${r.name}`} onClose={onClose} size="wide"
      footer={<>{!isNew && <button className="danger-outline" onClick={remove}>Löschen</button>}<button onClick={onClose}>Abbrechen</button><button className="primary" disabled={!valid} onClick={save}>Speichern</button></>}>
      <div className="form-grid">
        <Field label="Name" span={3}><TextInput value={v.name} onChange={set('name')} autoFocus={isNew} /></Field>
        <Field label="Priorität" hint="kleiner = zuerst; < 500 vor Mitgliederabgleich"><input type="number" value={v.prioritaet ?? 100} onChange={(e) => set('prioritaet')(Number(e.target.value))} /></Field>
        <h3 className="span-4">Wenn …</h3>
        <Field label="IBAN Zahlungspartner ist" span={2}><TextInput value={v.iban} onChange={set('iban')} /></Field>
        <Field label="Name/Verwendungszweck/Buchungstext enthält" span={2} hint="Mehrere Alternativen mit | trennen, z. B. entgelt|gebühr">
          <TextInput value={v.text_enthaelt} onChange={set('text_enthaelt')} />
        </Field>
        <Field label="Richtung">
          <Select value={v.richtung ?? 'beide'} onChange={(x) => set('richtung')(x ?? 'beide')} options={[{ value: 'beide', label: 'Ein- und Ausgänge' }, { value: 'ein', label: 'nur Eingänge' }, { value: 'aus', label: 'nur Ausgänge' }]} />
        </Field>
        <Field label="Betrag ab"><MoneyInput value={v.betrag_min_cent} onChange={set('betrag_min_cent')} /></Field>
        <Field label="Betrag bis"><MoneyInput value={v.betrag_max_cent} onChange={set('betrag_max_cent')} /></Field>
        <div className="span-1"><Checkbox checked={!!v.aktiv} onChange={(x) => set('aktiv')(x ? 1 : 0)} label="aktiv" /></div>
        <h3 className="span-4">… dann zuordnen zu</h3>
        <Field label="Kategorie *" span={2}><Select value={v.category_id ?? null} onChange={set('category_id')} empty="– wählen –" options={categoryOptions()} /></Field>
        <Field label="Partner"><Select value={v.partner_id ?? null} onChange={set('partner_id')} empty="–" options={partnerOptions()} /></Field>
        <Field label="Mitglied"><Select value={v.member_id ?? null} onChange={set('member_id')} empty="–" options={memberOptions()} /></Field>
      </div>
    </Modal>
  );
}

