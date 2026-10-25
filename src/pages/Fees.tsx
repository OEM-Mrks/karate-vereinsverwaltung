import { useState } from 'react';
import { all, run, scalar, tx } from '../db/db';
import type { FeeGroup, FeeRate, Member } from '../db/schema';
import { navigate, useLocalState, useQuery } from '../hooks';
import { balanceBefore, isActive, loadFeeContext, rateFor, yearSummary } from '../lib/fees';
import { formatEUR, todayISO } from '../lib/format';
import { feeGroups, memberName } from '../lib/lookups';
import { centToCsv, toCsv } from '../lib/print';
import { offeneBeitraegePdf } from '../lib/pdfDocs';
import { PdfPreview } from '../components/PdfPreview';
import { downloadBlob } from '../db/storage';
import { attempt, Field, Modal, MoneyInput, PageHeader, Stat, Tabs, TextInput, YearSelect } from '../components/ui';

type Tab = 'saetze' | 'offen';

export function FeesPage() {
  const [tab, setTab] = useLocalState<Tab>('fees.tab', 'saetze');
  return (
    <div className="page">
      <PageHeader title="Beiträge" subtitle="Beitragssätze je Gruppe und Jahr – der Jahresbeitrag ergibt sich automatisch aus dem Monatsbeitrag × 12." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'saetze', label: 'Beitragssätze' }, { id: 'offen', label: 'Beitragsübersicht & offene Posten' }]} />
      {tab === 'saetze' ? <Rates /> : <OpenItems />}
    </div>
  );
}

function Rates() {
  const [groupEdit, setGroupEdit] = useState<Partial<FeeGroup> | null>(null);
  const data = useQuery(() => {
    const groups = feeGroups();
    const rates = all<FeeRate>('SELECT * FROM fee_rates');
    const thisYear = new Date().getFullYear();
    const minYear = Math.min(thisYear, ...rates.map((r) => r.jahr));
    const maxYear = Math.max(thisYear, ...rates.map((r) => r.jahr));
    const years: number[] = [];
    for (let y = maxYear; y >= Math.max(minYear, maxYear - 6); y--) years.push(y);
    const counts = new Map(
      all<{ fee_group_id: number; n: number }>('SELECT fee_group_id, COUNT(*) AS n FROM members WHERE austritt IS NULL OR austritt >= ? GROUP BY fee_group_id', [todayISO()])
        .map((r) => [r.fee_group_id, r.n]),
    );
    return { groups, rates, years, counts, maxYear };
  });

  const addYear = () => {
    const y = data.maxYear + 1;
    attempt(() =>
      tx(() => {
        for (const g of data.groups) {
          const r = rateFor(data.rates, g.id, y);
          run('INSERT OR IGNORE INTO fee_rates(fee_group_id, jahr, monatsbeitrag_cent) VALUES (?,?,?)', [g.id, y, r.cent]);
        }
      }),
      `Beitragsjahr ${y} angelegt (Sätze aus ${data.maxYear} übernommen)`,
    );
  };

  return (
    <>
      <div className="toolbar">
        <button onClick={() => setGroupEdit({})}>+ Beitragsgruppe</button>
        <button className="primary" onClick={addYear}>+ Beitragsjahr {data.maxYear + 1} anlegen</button>
        <span className="muted small">Ist für ein Jahr kein Satz hinterlegt, gilt automatisch der Satz des Vorjahres.</span>
      </div>
      <div className="table-wrap">
        <table className="table rates">
          <thead>
            <tr>
              <th>Beitragsgruppe</th>
              <th className="num">Mitglieder</th>
              {data.years.map((y) => <th key={y} className="num">{y}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g) => (
              <tr key={g.id}>
                <td>
                  <button className="link" onClick={() => setGroupEdit(g)}><strong>{g.name}</strong></button>
                  {g.beschreibung && <div className="muted small">{g.beschreibung}</div>}
                </td>
                <td className="num">{data.counts.get(g.id) ?? 0}</td>
                {data.years.map((y) => {
                  const own = data.rates.find((r) => r.fee_group_id === g.id && r.jahr === y);
                  const eff = rateFor(data.rates, g.id, y);
                  return (
                    <td key={y} className="num">
                      <RateCell key={String(own?.monatsbeitrag_cent)} groupId={g.id} year={y} cent={own?.monatsbeitrag_cent ?? null} inherited={own ? null : eff.cent} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {groupEdit && <GroupDialog g={groupEdit} onClose={() => setGroupEdit(null)} />}
    </>
  );
}

function RateCell(props: { groupId: number; year: number; cent: number | null; inherited: number | null }) {
  const [value, setValue] = useState<number | null>(props.cent);
  const shown = value ?? props.cent;
  const commit = () => {
    if (value === props.cent) return;
    attempt(() => {
      if (value == null) run('DELETE FROM fee_rates WHERE fee_group_id = ? AND jahr = ?', [props.groupId, props.year]);
      else
        run(
          `INSERT INTO fee_rates(fee_group_id, jahr, monatsbeitrag_cent) VALUES (?,?,?)
           ON CONFLICT(fee_group_id, jahr) DO UPDATE SET monatsbeitrag_cent = excluded.monatsbeitrag_cent`,
          [props.groupId, props.year, value],
        );
    });
  };
  return (
    <div className="rate-cell" onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}>
      <MoneyInput value={shown} onChange={setValue} placeholder={props.inherited != null ? (props.inherited / 100).toFixed(2).replace('.', ',') : ''} />
      <div className="muted small">
        {shown != null ? `${formatEUR(shown * 12)} / Jahr` : props.inherited != null ? `übernommen: ${formatEUR(props.inherited * 12)} / Jahr` : ''}
      </div>
    </div>
  );
}

function GroupDialog({ g, onClose }: { g: Partial<FeeGroup>; onClose: () => void }) {
  const [v, setV] = useState(g);
  const [rate, setRate] = useState<number | null>(null);
  const isNew = !g.id;
  const save = () =>
    attempt(() => {
      tx(() => {
        if (isNew) {
          const id = run('INSERT INTO fee_groups(name, beschreibung, sort) VALUES (?,?,?)', [v.name!.trim(), v.beschreibung || null, 99]);
          if (rate != null) run('INSERT INTO fee_rates(fee_group_id, jahr, monatsbeitrag_cent) VALUES (?,?,?)', [id, new Date().getFullYear(), rate]);
        } else run('UPDATE fee_groups SET name = ?, beschreibung = ? WHERE id = ?', [v.name!.trim(), v.beschreibung || null, g.id!]);
      });
      onClose();
    }, 'Gespeichert');
  const remove = () => {
    const n = scalar<number>('SELECT COUNT(*) FROM members WHERE fee_group_id = ?', [g.id!]) ?? 0;
    if (!confirm(`Beitragsgruppe „${g.name}" löschen?${n ? `\n${n} Mitglieder verlieren ihre Beitragsgruppe!` : ''}`)) return;
    attempt(() => run('DELETE FROM fee_groups WHERE id = ?', [g.id!]), 'Gelöscht') && onClose();
  };
  return (
    <Modal
      title={isNew ? 'Neue Beitragsgruppe' : 'Beitragsgruppe bearbeiten'}
      onClose={onClose}
      footer={<>
        {!isNew && <button className="danger-outline" onClick={remove}>Löschen</button>}
        <button onClick={onClose}>Abbrechen</button>
        <button className="primary" disabled={!v.name?.trim()} onClick={save}>Speichern</button>
      </>}
    >
      <div className="form-grid cols-2">
        <Field label="Name" span={2}><TextInput value={v.name} onChange={(x) => setV({ ...v, name: x })} autoFocus /></Field>
        <Field label="Beschreibung" span={2}><TextInput value={v.beschreibung} onChange={(x) => setV({ ...v, beschreibung: x })} /></Field>
        {isNew && (
          <>
            <Field label={`Monatsbeitrag ${new Date().getFullYear()}`}><MoneyInput value={rate} onChange={setRate} /></Field>
            <Field label="Jahresbeitrag" hint="wird automatisch berechnet">
              <MoneyInput value={rate != null ? rate * 12 : null} onChange={(y) => setRate(y != null ? Math.round(y / 12) : null)} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

function OpenItems() {
  const [year, setYear] = useLocalState('year', new Date().getFullYear());
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [pdf, setPdf] = useState(false);
  const data = useQuery(() => {
    const ctx = loadFeeContext();
    const members = all<Member>('SELECT * FROM members ORDER BY nachname, vorname');
    const rows = members
      .map((m) => ({ m, s: yearSummary(m, year, ctx), vortrag: balanceBefore(m, year, ctx) }))
      .filter((r) => r.s.soll !== 0 || r.s.bezahlt !== 0 || r.vortrag !== 0 || isActive(r.m, `${year}-12-31`));
    const tot = rows.reduce(
      (a, r) => ({
        soll: a.soll + r.s.soll, bezahlt: a.bezahlt + r.s.bezahlt, offen: a.offen + Math.max(0, r.s.offen + r.vortrag),
        faellig: a.faellig + Math.max(0, r.s.offenFaellig + r.vortrag),
      }),
      { soll: 0, bezahlt: 0, offen: 0, faellig: 0 },
    );
    return { rows, tot };
  }, [year]);

  const visible = data.rows.filter((r) => !onlyOpen || r.s.offen + r.vortrag > 0);
  const exportCsv = () =>
    downloadBlob(
      toCsv([
        ['Nr', 'Name', 'Vorname', 'E-Mail', 'Telefon', 'Handy', 'Monate', 'Monatsbeitrag', 'Soll', 'Bezahlt', 'Vorjahre', 'Offen gesamt', 'davon fällig'],
        ...visible.map(({ m, s, vortrag }) => [
          m.mitgliedsnr, m.nachname, m.vorname, m.email, m.telefon, m.mobil, s.monate, centToCsv(s.monatsbeitrag), centToCsv(s.soll),
          centToCsv(s.bezahlt), centToCsv(vortrag), centToCsv(s.offen + vortrag), centToCsv(Math.max(0, s.offenFaellig + vortrag)),
        ]),
      ]),
      `beitraege-${year}.csv`,
      'text/csv;charset=utf-8',
    );

  return (
    <>
      <div className="stats">
        <Stat label={`Beitragssoll ${year}`} value={formatEUR(data.tot.soll)} />
        <Stat label="Eingegangen" value={formatEUR(data.tot.bezahlt)} tone="ok" />
        <Stat label="Offen (Jahr gesamt)" value={formatEUR(data.tot.offen)} tone={data.tot.offen > 0 ? 'warn' : 'ok'} />
        <Stat label="Davon bereits fällig" value={formatEUR(data.tot.faellig)} tone={data.tot.faellig > 0 ? 'bad' : 'ok'} sub="nach Zahlweise der Mitglieder" />
      </div>
      <div className="toolbar">
        <YearSelect value={year} onChange={setYear} />
        <label className="checkbox"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> nur offene Posten</label>
        <span className="spacer" />
        <button onClick={() => setPdf(true)}>📄 Liste als PDF</button>
        <button onClick={exportCsv}>CSV exportieren</button>
      </div>
      <div className="table-wrap">
        <table className="table clickable-rows">
          <thead>
            <tr><th>Nr.</th><th>Name</th><th>Kontakt</th><th className="num">Monate</th><th className="num">Soll</th><th className="num">Bezahlt</th><th className="num">Vorjahre</th><th className="num">Offen</th><th className="num">davon fällig</th></tr>
          </thead>
          <tbody>
            {visible.map(({ m, s, vortrag }) => (
              <tr key={m.id} onClick={() => navigate(`mitglieder/${m.id}`)}>
                <td className="muted">{m.mitgliedsnr}</td>
                <td><strong>{memberName(m)}</strong></td>
                <td className="small">{m.email || m.mobil || m.telefon}</td>
                <td className="num">{s.monate}</td>
                <td className="num">{formatEUR(s.soll)}</td>
                <td className="num">{formatEUR(s.bezahlt)}</td>
                <td className="num">{vortrag ? formatEUR(vortrag) : '–'}</td>
                <td className={`num ${s.offen + vortrag > 0 ? 'neg' : s.offen + vortrag < 0 ? 'pos' : ''}`}><strong>{formatEUR(s.offen + vortrag)}</strong></td>
                <td className="num">{formatEUR(Math.max(0, s.offenFaellig + vortrag))}</td>
              </tr>
            ))}
            {!visible.length && <tr><td colSpan={9} className="empty">Keine offenen Beiträge 🎉</td></tr>}
          </tbody>
        </table>
      </div>
      {pdf && (
        <PdfPreview
          title={`Offene Beiträge ${year}`}
          filename={`Offene_Beitraege_${year}.pdf`}
          build={() => offeneBeitraegePdf(year, visible)}
          onClose={() => setPdf(false)}
        />
      )}
    </>
  );
}
