import { useState } from 'react';
import { all, getSetting, run, scalar, tx } from '../db/db';
import type { Member, Zahlweise } from '../db/schema';
import { GRADES, gradeName } from '../db/seed';
import { navigate, useLocalState, useQuery } from '../hooks';
import { balanceBefore, isActive, loadFeeContext, yearSummary, ZAHLWEISEN } from '../lib/fees';
import { earliestExitDate, formatDate, formatEUR, isValidIBAN, normalizeIBAN, todayISO, ageAt } from '../lib/format';
import { feeGroups, memberName } from '../lib/lookups';
import { centToCsv, toCsv } from '../lib/print';
import { downloadBlob } from '../db/storage';
import {
  attempt, Badge, DateInput, Field, GradeBadge, Modal, MoneyInput, PageHeader, Select, TextArea, TextInput, YearSelect,
} from '../components/ui';

type Filter = 'aktiv' | 'gekuendigt' | 'ausgetreten' | 'alle';

export function MembersPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useLocalState<Filter>('members.filter', 'aktiv');
  const [grad, setGrad] = useState<string | null>(null);
  const [year, setYear] = useLocalState('year', new Date().getFullYear());
  const [editing, setEditing] = useState<Partial<Member> | null>(null);
  const today = todayISO();
  const frist = Number(getSetting('kuendigungsfrist_monate', '3')) || 3;

  const rows = useQuery(() => {
    const ctx = loadFeeContext();
    const groups = new Map(feeGroups().map((g) => [g.id, g.name]));
    return all<Member>('SELECT * FROM members ORDER BY nachname, vorname').map((m) => {
      const s = yearSummary(m, year, ctx);
      return { m, s, vortrag: balanceBefore(m, year, ctx), gruppe: m.fee_group_id ? groups.get(m.fee_group_id) ?? '' : '' };
    });
  }, [year]);

  const q = search.trim().toLowerCase();
  const visible = rows.filter(({ m }) => {
    if (filter === 'aktiv' && !isActive(m, today)) return false;
    if (filter === 'gekuendigt' && !(m.austritt && m.austritt >= today)) return false;
    if (filter === 'ausgetreten' && !(m.austritt && m.austritt < today)) return false;
    if (grad && m.grad !== grad) return false;
    if (!q) return true;
    return [m.vorname, m.nachname, m.mitgliedsnr, m.ort, m.email, m.strasse].some((v) => v?.toLowerCase().includes(q));
  });

  const sum = visible.reduce(
    (a, r) => ({ soll: a.soll + r.s.soll, bezahlt: a.bezahlt + r.s.bezahlt, offen: a.offen + r.s.offen + r.vortrag }),
    { soll: 0, bezahlt: 0, offen: 0 },
  );

  const exportCsv = () => {
    const header = ['Mitgliedsnr', 'Anrede', 'Titel', 'Vorname', 'Nachname', 'Geburtsdatum', 'Straße', 'Adresszusatz', 'PLZ', 'Ort', 'Land',
      'E-Mail', 'Telefon', 'Handy', 'Grad', 'Beitragsgruppe', 'Zahlweise', 'Eintritt', 'Austritt', 'Kündigung eingegangen',
      'Kontoinhaber', 'IBAN', 'BIC', 'Mandatsreferenz', 'Mandatsdatum', `Soll ${year}`, `Bezahlt ${year}`, `Offen ${year}`, 'Rückstand Vorjahre'];
    const data = visible.map(({ m, s, vortrag, gruppe }) => [
      m.mitgliedsnr, m.anrede, m.titel, m.vorname, m.nachname, formatDate(m.geburtsdatum), m.strasse, m.adresszusatz, m.plz, m.ort, m.land,
      m.email, m.telefon, m.mobil, gradeName(m.grad), gruppe, m.zahlweise, formatDate(m.eintritt), m.austritt ? formatDate(m.austritt) : '',
      m.kuendigung_eingang ? formatDate(m.kuendigung_eingang) : '', m.kontoinhaber, m.iban, m.bic, m.sepa_mandat_ref,
      m.sepa_mandat_datum ? formatDate(m.sepa_mandat_datum) : '', centToCsv(s.soll), centToCsv(s.bezahlt), centToCsv(s.offen), centToCsv(vortrag),
    ]);
    downloadBlob(toCsv([header, ...data]), `mitglieder-${today}.csv`, 'text/csv;charset=utf-8');
  };

  return (
    <div className="page">
      <PageHeader
        title="Mitglieder"
        subtitle={<>Kündigung heute eingehend → frühester Austritt zum <strong>{formatDate(earliestExitDate(today, frist))}</strong> ({frist} Monate zum Monatsende)</>}
        actions={<>
          <button onClick={exportCsv}>CSV exportieren</button>
          <button className="primary" onClick={() => setEditing({})}>+ Neues Mitglied</button>
        </>}
      />
      <div className="toolbar">
        <input className="search" placeholder="Suchen: Name, Nr., Ort, E-Mail …" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="aktiv">Aktive Mitglieder</option>
          <option value="gekuendigt">Gekündigt (Austritt in Zukunft)</option>
          <option value="ausgetreten">Ausgetreten</option>
          <option value="alle">Alle</option>
        </select>
        <Select value={grad} onChange={setGrad} empty="Alle Grade" options={GRADES.map((g) => ({ value: g.id, label: g.name }))} />
        <YearSelect value={year} onChange={setYear} />
        <span className="muted">{visible.length} Mitglieder</span>
      </div>
      <div className="table-wrap">
        <table className="table clickable-rows">
          <thead>
            <tr>
              <th>Nr.</th><th>Name</th><th>Grad</th><th>Beitrag</th><th>Mitglied seit</th>
              <th className="num">Soll {year}</th><th className="num">Bezahlt</th><th className="num">Offen</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ m, s, vortrag, gruppe }) => {
              const offen = s.offen + vortrag;
              return (
                <tr key={m.id} onClick={() => navigate(`mitglieder/${m.id}`)}>
                  <td className="muted">{m.mitgliedsnr}</td>
                  <td>
                    <strong className="nowrap">{memberName(m)}</strong>
                    <div className="muted small nowrap">
                      {[m.geburtsdatum ? `${ageAt(m.geburtsdatum)} J.` : null, m.ort].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td><GradeBadge grad={m.grad} /></td>
                  <td className="small">
                    {s.monatsbeitrag ? `${formatEUR(s.monatsbeitrag)}/Mon.` : 'beitragsfrei'}
                    <div className="muted">{m.beitrag_individuell_cent != null ? 'individuell' : gruppe}</div>
                  </td>
                  <td className="nowrap">
                    {formatDate(m.eintritt)}
                    {m.austritt && <div><Badge tone={m.austritt < today ? 'muted' : 'warn'}>Austritt {formatDate(m.austritt)}</Badge></div>}
                  </td>
                  <td className="num">{formatEUR(s.soll)}</td>
                  <td className="num">{formatEUR(s.bezahlt)}</td>
                  <td className={`num ${offen > 0 ? 'neg' : offen < 0 ? 'pos' : ''}`} title={vortrag ? `inkl. Vorjahre: ${formatEUR(vortrag)}` : undefined}>
                    {formatEUR(offen)}{vortrag !== 0 && ' *'}
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr><td colSpan={8} className="empty">Keine Mitglieder gefunden.</td></tr>
            )}
          </tbody>
          {visible.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={5}>Summe</td>
                <td className="num">{formatEUR(sum.soll)}</td>
                <td className="num">{formatEUR(sum.bezahlt)}</td>
                <td className="num">{formatEUR(sum.offen)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="muted small">* Offen inklusive Rückstand/Guthaben aus Vorjahren. Gutschriften und Überzahlungen erscheinen negativ.</p>
      {editing && <MemberForm initial={editing} onClose={() => setEditing(null)} onSaved={(id) => navigate(`mitglieder/${id}`)} />}
    </div>
  );
}

function nextMemberNo(): string {
  const max = scalar<number>("SELECT MAX(CAST(mitgliedsnr AS INTEGER)) FROM members WHERE mitgliedsnr GLOB '[0-9]*'") ?? 0;
  return String(max + 1 || 1001);
}

export function MemberForm(props: { initial: Partial<Member>; onClose: () => void; onSaved?: (id: number) => void }) {
  const isNew = !props.initial.id;
  const [m, setM] = useState<Partial<Member>>(() => ({
    land: 'Deutschland',
    grad: 'unranked',
    zahlweise: 'jaehrlich',
    eintritt: todayISO(),
    mitgliedsnr: isNew ? nextMemberNo() : undefined,
    fee_group_id: isNew ? feeGroups()[0]?.id ?? null : null,
    ...props.initial,
  }));
  const [individuell, setIndividuell] = useState(props.initial.beitrag_individuell_cent != null);
  const groups = feeGroups();
  const set = <K extends keyof Member>(k: K) => (v: Member[K] | null) => setM((p) => ({ ...p, [k]: v }));
  const ibanInvalid = !!m.iban && !isValidIBAN(m.iban);
  const errors: string[] = [];
  if (!m.vorname?.trim()) errors.push('Vorname fehlt');
  if (!m.nachname?.trim()) errors.push('Nachname fehlt');
  if (!m.eintritt) errors.push('Eintrittsdatum fehlt');
  if (m.austritt && m.eintritt && m.austritt < m.eintritt) errors.push('Austritt liegt vor dem Eintritt');

  const save = () => {
    if (errors.length) return;
    let id = props.initial.id ?? 0;
    const values = [
      m.mitgliedsnr || null, m.anrede || null, m.titel || null, m.vorname!.trim(), m.nachname!.trim(), m.geburtsdatum || null,
      m.strasse || null, m.adresszusatz || null, m.plz || null, m.ort || null, m.land || null,
      m.email?.trim() || null, m.telefon || null, m.mobil || null, m.grad ?? 'unranked', m.fee_group_id ?? null,
      individuell ? m.beitrag_individuell_cent ?? 0 : null, m.zahlweise ?? 'jaehrlich', m.eintritt!, m.austritt || null,
      m.kuendigung_eingang || null, m.kontoinhaber || null, normalizeIBAN(m.iban) || null, m.bic?.toUpperCase() || null,
      m.sepa_mandat_ref || null, m.sepa_mandat_datum || null, m.erziehungsberechtigte || null, m.notizen || null,
    ];
    const ok = attempt(() =>
      tx(() => {
        if (isNew) {
          id = run(
            `INSERT INTO members(mitgliedsnr, anrede, titel, vorname, nachname, geburtsdatum, strasse, adresszusatz, plz, ort, land,
              email, telefon, mobil, grad, fee_group_id, beitrag_individuell_cent, zahlweise, eintritt, austritt, kuendigung_eingang,
              kontoinhaber, iban, bic, sepa_mandat_ref, sepa_mandat_datum, erziehungsberechtigte, notizen)
             VALUES (${values.map(() => '?').join(',')})`,
            values,
          );
          if (m.grad && m.grad !== 'unranked') {
            run('INSERT INTO graduations(member_id, grad, datum, notiz) VALUES (?,?,?,?)', [id, m.grad, m.eintritt!, 'bei Eintritt']);
          }
        } else {
          const before = scalar<string>('SELECT grad FROM members WHERE id = ?', [id]);
          run(
            `UPDATE members SET mitgliedsnr=?, anrede=?, titel=?, vorname=?, nachname=?, geburtsdatum=?, strasse=?, adresszusatz=?, plz=?, ort=?,
              land=?, email=?, telefon=?, mobil=?, grad=?, fee_group_id=?, beitrag_individuell_cent=?, zahlweise=?, eintritt=?, austritt=?,
              kuendigung_eingang=?, kontoinhaber=?, iban=?, bic=?, sepa_mandat_ref=?, sepa_mandat_datum=?, erziehungsberechtigte=?, notizen=?,
              updated_at=datetime('now') WHERE id=?`,
            [...values, id],
          );
          if (before !== m.grad && m.grad) {
            run('INSERT INTO graduations(member_id, grad, datum) VALUES (?,?,?)', [id, m.grad, todayISO()]);
          }
        }
      }),
      isNew ? 'Mitglied angelegt' : 'Gespeichert',
    );
    if (ok) {
      props.onClose();
      props.onSaved?.(id);
    }
  };

  const minor = (ageAt(m.geburtsdatum) ?? 99) < 18;
  return (
    <Modal
      size="wide"
      title={isNew ? 'Neues Mitglied' : `${m.vorname} ${m.nachname} bearbeiten`}
      onClose={props.onClose}
      footer={<>
        {errors.length > 0 && <span className="field-error">{errors.join(' · ')}</span>}
        <button onClick={props.onClose}>Abbrechen</button>
        <button className="primary" disabled={errors.length > 0} onClick={save}>Speichern</button>
      </>}
    >
      <div className="form-grid">
        <h3 className="span-4">Person</h3>
        <Field label="Mitgliedsnummer"><TextInput value={m.mitgliedsnr} onChange={set('mitgliedsnr')} /></Field>
        <Field label="Anrede">
          <Select value={m.anrede ?? null} onChange={set('anrede')} empty="–" options={['Frau', 'Herr', 'Divers'].map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="Titel"><TextInput value={m.titel} onChange={set('titel')} /></Field>
        <Field label="Geburtsdatum" hint={m.geburtsdatum ? `${ageAt(m.geburtsdatum)} Jahre` : undefined}>
          <DateInput value={m.geburtsdatum} onChange={set('geburtsdatum')} />
        </Field>
        <Field label="Vorname *" span={2}><TextInput value={m.vorname} onChange={set('vorname')} autoFocus={isNew} /></Field>
        <Field label="Nachname *" span={2}><TextInput value={m.nachname} onChange={set('nachname')} /></Field>
        {minor && (
          <Field label="Erziehungsberechtigte" span={4} hint="Bei Minderjährigen: Name(n) der Erziehungsberechtigten">
            <TextInput value={m.erziehungsberechtigte} onChange={set('erziehungsberechtigte')} />
          </Field>
        )}

        <h3 className="span-4">Anschrift</h3>
        <Field label="Straße und Hausnummer" span={2}><TextInput value={m.strasse} onChange={set('strasse')} /></Field>
        <Field label="Adresszusatz" span={2}><TextInput value={m.adresszusatz} onChange={set('adresszusatz')} /></Field>
        <Field label="PLZ"><TextInput value={m.plz} onChange={set('plz')} /></Field>
        <Field label="Ort" span={2}><TextInput value={m.ort} onChange={set('ort')} /></Field>
        <Field label="Land"><TextInput value={m.land} onChange={set('land')} /></Field>

        <h3 className="span-4">Kontakt</h3>
        <Field label="E-Mail" span={2}><TextInput type="email" value={m.email} onChange={set('email')} /></Field>
        <Field label="Telefon"><TextInput type="tel" value={m.telefon} onChange={set('telefon')} /></Field>
        <Field label="Handy"><TextInput type="tel" value={m.mobil} onChange={set('mobil')} /></Field>

        <h3 className="span-4">Karate & Mitgliedschaft</h3>
        <Field label="Graduierung" hint={!isNew ? 'Änderung wird in der Prüfungshistorie vermerkt' : undefined}>
          <Select value={m.grad ?? 'unranked'} onChange={(v) => set('grad')(v ?? 'unranked')} options={GRADES.map((g) => ({ value: g.id, label: g.name }))} />
        </Field>
        <Field label="Eintritt *"><DateInput value={m.eintritt} onChange={(v) => set('eintritt')(v ?? '')} /></Field>
        <Field label="Kündigung eingegangen am"><DateInput value={m.kuendigung_eingang} onChange={set('kuendigung_eingang')} /></Field>
        <Field label="Austritt" hint={m.kuendigung_eingang && !m.austritt ? `frühestens ${formatDate(earliestExitDate(m.kuendigung_eingang, Number(getSetting('kuendigungsfrist_monate', '3')) || 3))}` : undefined}>
          <DateInput value={m.austritt} onChange={set('austritt')} />
        </Field>
        <Field label="Beitragsgruppe" span={2}>
          <Select value={m.fee_group_id ?? null} onChange={set('fee_group_id')} empty="– keine –" options={groups.map((g) => ({ value: g.id, label: g.name }))} />
        </Field>
        <Field label="Zahlweise">
          <Select value={m.zahlweise ?? 'jaehrlich'} onChange={(v) => set('zahlweise')((v ?? 'jaehrlich') as Zahlweise)} options={ZAHLWEISEN.map((z) => ({ value: z.id, label: z.name }))} />
        </Field>
        <Field label="Individueller Monatsbeitrag" hint="überschreibt die Beitragsgruppe">
          <div className="inline">
            <input type="checkbox" checked={individuell} onChange={(e) => setIndividuell(e.target.checked)} aria-label="Individuellen Beitrag verwenden" />
            {individuell && <MoneyInput value={m.beitrag_individuell_cent} onChange={set('beitrag_individuell_cent')} />}
          </div>
        </Field>

        <h3 className="span-4">Bankverbindung & SEPA-Mandat</h3>
        <Field label="Kontoinhaber" span={2} hint="Wird zur automatischen Zuordnung von Zahlungen genutzt">
          <TextInput value={m.kontoinhaber} onChange={set('kontoinhaber')} />
        </Field>
        <Field label="IBAN" span={2} error={ibanInvalid ? 'IBAN-Prüfziffer stimmt nicht' : undefined}>
          <TextInput value={m.iban} onChange={set('iban')} placeholder="DE00 0000 0000 0000 0000 00" />
        </Field>
        <Field label="BIC"><TextInput value={m.bic} onChange={set('bic')} /></Field>
        <Field label="Mandatsreferenz"><TextInput value={m.sepa_mandat_ref} onChange={set('sepa_mandat_ref')} /></Field>
        <Field label="Mandat erteilt am"><DateInput value={m.sepa_mandat_datum} onChange={set('sepa_mandat_datum')} /></Field>
        <div />
        <Field label="Notizen" span={4}><TextArea value={m.notizen} onChange={set('notizen')} /></Field>
      </div>
    </Modal>
  );
}
