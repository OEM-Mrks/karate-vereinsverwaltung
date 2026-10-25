import { useState, type ReactNode } from 'react';
import { all, get, getSetting, run, tx } from '../db/db';
import type { Graduation, Member, MemberCharge } from '../db/schema';
import { GRADES, gradeIndex, gradeName } from '../db/seed';
import { navigate, useQuery } from '../hooks';
import { balanceBefore, firstFeeYear, isActive, loadFeeContext, yearSummary, ZAHLWEISEN } from '../lib/fees';
import { ageAt, earliestExitDate, formatDate, formatEUR, formatIBAN, todayISO, yearOf } from '../lib/format';
import { categoryOptions, feeGroups } from '../lib/lookups';
import { escapeHtml, printHtml } from '../lib/print';
import {
  attempt, Badge, DateInput, Empty, Field, GradeBadge, Modal, MoneyInput, PageHeader, Select, Tabs, TextInput,
} from '../components/ui';
import { MemberForm } from './Members';
import { getVereinsdaten, signatory } from '../lib/verein';
import { missingFields } from '../lib/completeness';

type Tab = 'stammdaten' | 'beitraege' | 'pruefungen';

export function MemberDetail({ id }: { id: number }) {
  const [tab, setTab] = useState<Tab>('beitraege');
  const [edit, setEdit] = useState(false);
  const [kuendigung, setKuendigung] = useState(false);
  const m = useQuery(() => get<Member>('SELECT * FROM members WHERE id = ?', [id]), [id]);
  if (!m) return <div className="page"><Empty>Mitglied nicht gefunden. <a href="#/mitglieder">Zur Liste</a></Empty></div>;
  const today = todayISO();
  const active = isActive(m, today);

  const remove = () => {
    const n = get<{ n: number }>('SELECT COUNT(*) AS n FROM allocations WHERE member_id = ?', [id])?.n ?? 0;
    const msg = `${m.vorname} ${m.nachname} wirklich löschen?` +
      (n ? `\n\n${n} Zahlungszuordnung(en) bleiben in der Buchhaltung erhalten, verlieren aber den Bezug zum Mitglied.` : '') +
      '\n\nTipp: Statt zu löschen besser ein Austrittsdatum eintragen.';
    if (!confirm(msg)) return;
    if (attempt(() => run('DELETE FROM members WHERE id = ?', [id]), 'Mitglied gelöscht')) navigate('mitglieder');
  };

  return (
    <div className="page">
      <a className="back" href="#/mitglieder">← Mitglieder</a>
      <PageHeader
        title={`${m.titel ? m.titel + ' ' : ''}${m.vorname} ${m.nachname}`}
        subtitle={<span className="inline">
          {m.mitgliedsnr && <span>Nr. {m.mitgliedsnr}</span>}
          <GradeBadge grad={m.grad} />
          {active ? <Badge tone="ok">aktiv</Badge> : m.eintritt > today ? <Badge tone="info">Eintritt {formatDate(m.eintritt)}</Badge> : <Badge>ausgetreten</Badge>}
          {m.austritt && m.austritt >= today && <Badge tone="warn">gekündigt zum {formatDate(m.austritt)}</Badge>}
        </span>}
        actions={<>
          {!m.austritt && <button onClick={() => setKuendigung(true)}>Kündigung erfassen</button>}
          {m.austritt && <button onClick={() => printConfirmation(m)}>Kündigungsbestätigung drucken</button>}
          <button onClick={remove} className="danger-outline">Löschen</button>
          <button className="primary" onClick={() => setEdit(true)}>Bearbeiten</button>
        </>}
      />
      {missingFields(m).length > 0 && (
        <div className="callout warn">
          Fehlende Angaben: {missingFields(m).join(', ')}. <button className="link" onClick={() => setEdit(true)}>Jetzt ergänzen</button>
        </div>
      )}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'beitraege', label: 'Beitragskonto' },
          { id: 'stammdaten', label: 'Stammdaten' },
          { id: 'pruefungen', label: 'Prüfungen' },
        ]}
      />
      {tab === 'stammdaten' && <MasterData m={m} />}
      {tab === 'beitraege' && <FeeAccount m={m} />}
      {tab === 'pruefungen' && <Graduations m={m} />}
      {edit && <MemberForm initial={m} onClose={() => setEdit(false)} />}
      {kuendigung && <CancellationDialog m={m} onClose={() => setKuendigung(false)} />}
    </div>
  );
}

function MasterData({ m }: { m: Member }) {
  const group = feeGroups().find((g) => g.id === m.fee_group_id);
  const rows: [string, ReactNode][] = [
    ['Anschrift', <>{m.anrede} {m.titel} {m.vorname} {m.nachname}<br />{m.strasse}{m.adresszusatz && <><br />{m.adresszusatz}</>}<br />{m.plz} {m.ort}{m.land && m.land !== 'Deutschland' && <><br />{m.land}</>}</>],
    ['Geburtsdatum', m.geburtsdatum ? `${formatDate(m.geburtsdatum)} (${ageAt(m.geburtsdatum)} Jahre)` : '–'],
    ['Erziehungsberechtigte', m.erziehungsberechtigte || '–'],
    ['E-Mail', m.email ? <a href={`mailto:${m.email}`}>{m.email}</a> : '–'],
    ['Telefon', m.telefon ? <a href={`tel:${m.telefon}`}>{m.telefon}</a> : '–'],
    ['Handy', m.mobil ? <a href={`tel:${m.mobil}`}>{m.mobil}</a> : '–'],
    ['Graduierung', <GradeBadge grad={m.grad} />],
    ['Eintritt', formatDate(m.eintritt)],
    ['Kündigung eingegangen', formatDate(m.kuendigung_eingang)],
    ['Austritt', formatDate(m.austritt)],
    ['Beitragsgruppe', m.beitrag_individuell_cent != null ? `individuell: ${formatEUR(m.beitrag_individuell_cent)} / Monat` : group?.name ?? '–'],
    ['Zahlweise', ZAHLWEISEN.find((z) => z.id === m.zahlweise)?.name ?? m.zahlweise],
    ['Kontoinhaber', m.kontoinhaber || '–'],
    ['IBAN', m.iban ? <span className="mono">{formatIBAN(m.iban)}</span> : '–'],
    ['BIC', m.bic || '–'],
    ['SEPA-Mandat', m.sepa_mandat_ref ? `${m.sepa_mandat_ref} vom ${formatDate(m.sepa_mandat_datum)}` : '–'],
    ['Notizen', m.notizen ? <span className="pre">{m.notizen}</span> : '–'],
  ];
  return (
    <div className="card">
      <dl className="dl">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function FeeAccount({ m }: { m: Member }) {
  const [addCharge, setAddCharge] = useState(false);
  const data = useQuery(() => {
    const ctx = loadFeeContext();
    const thisYear = yearOf(todayISO());
    const from = firstFeeYear(m, ctx);
    // Bei gekündigten Mitgliedern auch das Austrittsjahr zeigen, wenn es in der Zukunft liegt
    const to = Math.max(thisYear, from, m.austritt ? yearOf(m.austritt) : 0);
    const years: ReturnType<typeof yearSummary>[] = [];
    for (let y = to; y >= from; y--) years.push(yearSummary(m, y, ctx));
    const payments = all<{ id: number; tid: number; buchungsdatum: string; betrag_cent: number; beitragsjahr: number | null; verwendungszweck: string | null; gegen_name: string | null; kat: string }>(
      `SELECT a.id, t.id AS tid, t.buchungsdatum, a.betrag_cent, a.beitragsjahr, t.verwendungszweck, t.gegen_name, c.nummer || ' ' || c.name AS kat
       FROM allocations a JOIN transactions t ON t.id = a.transaction_id LEFT JOIN categories c ON c.id = a.category_id
       WHERE a.member_id = ? ORDER BY t.buchungsdatum DESC`,
      [m.id],
    );
    const charges = ctx.charges.get(m.id) ?? [];
    const total = balanceBefore(m, to + 1, ctx);
    return { years, payments, charges, total, startYear: ctx.startYear };
  }, [m]);

  return (
    <>
      <div className="stats">
        <div className={`stat ${data.total > 0 ? 'stat-bad' : 'stat-ok'}`}>
          <div className="stat-label">Kontostand Mitglied (alle Jahre)</div>
          <div className="stat-value">{data.total > 0 ? `${formatEUR(data.total)} offen` : data.total < 0 ? `${formatEUR(-data.total)} Guthaben` : 'ausgeglichen'}</div>
        </div>
        {data.years[0] && (
          <div className="stat">
            <div className="stat-label">{data.years[0].jahr}: davon bis heute fällig</div>
            <div className="stat-value">{formatEUR(data.years[0].offenFaellig)}</div>
            <div className="stat-sub">Zahlweise {ZAHLWEISEN.find((z) => z.id === m.zahlweise)?.name}</div>
          </div>
        )}
      </div>
      <div className="card">
        <h3>Beiträge je Jahr</h3>
        {data.startYear > yearOf(m.eintritt) && (
          <p className="muted small">Beitragskonten werden ab {data.startYear} geführt (Einstellung unter „Daten &amp; Sicherung"). Ältere Rückstände kannst du als Forderung „Übertrag Rückstand" erfassen.</p>
        )}
        <table className="table">
          <thead>
            <tr><th>Jahr</th><th className="num">Monate</th><th className="num">Monatsbeitrag</th><th className="num">Beiträge</th><th className="num">Sonstiges</th><th className="num">Soll</th><th className="num">Bezahlt</th><th className="num">Offen</th></tr>
          </thead>
          <tbody>
            {data.years.map((y) => (
              <tr key={y.jahr}>
                <td>{y.jahr}</td>
                <td className="num">{y.monate}</td>
                <td className="num">
                  {formatEUR(y.monatsbeitrag)}
                  {y.individuell ? <span className="muted small"> indiv.</span> : y.rateJahr && y.rateJahr !== y.jahr ? <span className="muted small" title={`Kein Satz für ${y.jahr} hinterlegt – Satz aus ${y.rateJahr} verwendet`}> ({y.rateJahr})</span> : null}
                </td>
                <td className="num">{formatEUR(y.beitragSoll)}</td>
                <td className="num">{y.sonderSoll ? formatEUR(y.sonderSoll) : '–'}</td>
                <td className="num"><strong>{formatEUR(y.soll)}</strong></td>
                <td className="num">{formatEUR(y.bezahlt)}</td>
                <td className={`num ${y.offen > 0 ? 'neg' : y.offen < 0 ? 'pos' : ''}`}>{formatEUR(y.offen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>Zahlungen</h3>
          {data.payments.length ? (
            <table className="table">
              <thead><tr><th>Datum</th><th>Verwendungszweck</th><th>Für</th><th className="num">Betrag</th></tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td><a href={`#/konto/${p.tid}`}>{formatDate(p.buchungsdatum)}</a></td>
                    <td className="small">{p.gegen_name && <strong>{p.gegen_name}: </strong>}{p.verwendungszweck}<div className="muted">{p.kat}</div></td>
                    <td>{p.beitragsjahr ?? yearOf(p.buchungsdatum)}</td>
                    <td className={`num ${p.betrag_cent < 0 ? 'neg' : ''}`}>{formatEUR(p.betrag_cent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Noch keine Zahlungen zugeordnet. Zahlungen werden beim Kontoimport automatisch über IBAN, Name oder Mitgliedsnummer erkannt.</Empty>}
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Sonstige Forderungen & Gutschriften</h3>
            <button onClick={() => setAddCharge(true)}>+ Hinzufügen</button>
          </div>
          {data.charges.length ? (
            <table className="table">
              <thead><tr><th>Datum</th><th>Beschreibung</th><th className="num">Betrag</th><th /></tr></thead>
              <tbody>
                {[...data.charges].reverse().map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.datum)}</td>
                    <td>{c.beschreibung}<span className="muted small"> ({c.jahr})</span></td>
                    <td className="num">{formatEUR(c.betrag_cent)}</td>
                    <td><button className="link danger" onClick={() => confirm('Eintrag löschen?') && attempt(() => run('DELETE FROM member_charges WHERE id = ?', [c.id]))}>löschen</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>z. B. Aufnahmegebühr, Prüfungsgebühr, Pass – oder Gutschriften (negativer Betrag).</Empty>}
        </div>
      </div>
      {addCharge && <ChargeDialog m={m} onClose={() => setAddCharge(false)} />}
    </>
  );
}

function ChargeDialog({ m, onClose }: { m: Member; onClose: () => void }) {
  const [c, setC] = useState<Partial<MemberCharge>>({ datum: todayISO(), beschreibung: 'Aufnahmegebühr' });
  const opts = categoryOptions((x) => x.mitgliedskonto === 1);
  const valid = c.datum && c.beschreibung?.trim() && c.betrag_cent != null;
  const save = () =>
    attempt(() => {
      run('INSERT INTO member_charges(member_id, jahr, datum, betrag_cent, beschreibung, category_id) VALUES (?,?,?,?,?,?)', [
        m.id, yearOf(c.datum!), c.datum!, c.betrag_cent!, c.beschreibung!.trim(), c.category_id ?? null,
      ]);
      onClose();
    }, 'Forderung eingetragen');
  return (
    <Modal title="Forderung / Gutschrift" onClose={onClose} footer={<><button onClick={onClose}>Abbrechen</button><button className="primary" disabled={!valid} onClick={save}>Speichern</button></>}>
      <div className="form-grid cols-2">
        <Field label="Beschreibung" span={2}>
          <TextInput value={c.beschreibung} onChange={(v) => setC({ ...c, beschreibung: v })} list="charge-suggestions" />
          <datalist id="charge-suggestions">
            {['Aufnahmegebühr', 'Übertrag Rückstand', 'Prüfungsgebühr', 'Budo-Pass', 'Jahressichtmarke', 'Lehrgangsgebühr', 'Gutschrift'].map((s) => <option key={s} value={s} />)}
          </datalist>
        </Field>
        <Field label="Datum (fällig ab)"><DateInput value={c.datum} onChange={(v) => setC({ ...c, datum: v ?? undefined })} /></Field>
        <Field label="Betrag" hint="Gutschrift = negativer Betrag"><MoneyInput value={c.betrag_cent} onChange={(v) => setC({ ...c, betrag_cent: v ?? undefined })} /></Field>
        <Field label="Kategorie (optional)" span={2}>
          <Select value={c.category_id ?? null} onChange={(v) => setC({ ...c, category_id: v })} empty="–" options={opts} />
        </Field>
      </div>
    </Modal>
  );
}

function Graduations({ m }: { m: Member }) {
  const list = useQuery(() => all<Graduation>('SELECT * FROM graduations WHERE member_id = ? ORDER BY datum DESC, id DESC', [m.id]), [m.id]);
  const nextGrade = GRADES[Math.min(gradeIndex(m.grad) + 1, GRADES.length - 1)]?.id ?? 'kyu9';
  const [g, setG] = useState<Partial<Graduation>>({ grad: nextGrade, datum: todayISO() });
  const add = () =>
    attempt(() =>
      tx(() => {
        run('INSERT INTO graduations(member_id, grad, datum, pruefer, notiz) VALUES (?,?,?,?,?)', [m.id, g.grad!, g.datum!, g.pruefer || null, g.notiz || null]);
        // Aktuellen Grad auf die jüngste Prüfung setzen
        const latest = get<{ grad: string }>('SELECT grad FROM graduations WHERE member_id = ? ORDER BY datum DESC, id DESC LIMIT 1', [m.id]);
        if (latest) run("UPDATE members SET grad = ?, updated_at = datetime('now') WHERE id = ?", [latest.grad, m.id]);
      }),
      'Prüfung eingetragen',
    );
  return (
    <div className="grid-2">
      <div className="card">
        <h3>Prüfungshistorie</h3>
        {list.length ? (
          <table className="table">
            <thead><tr><th>Datum</th><th>Grad</th><th>Prüfer</th><th>Notiz</th><th /></tr></thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td>{formatDate(x.datum)}</td>
                  <td><GradeBadge grad={x.grad} /></td>
                  <td>{x.pruefer}</td>
                  <td className="small">{x.notiz}</td>
                  <td><button className="link danger" onClick={() => confirm('Eintrag löschen?') && attempt(() => run('DELETE FROM graduations WHERE id = ?', [x.id]))}>löschen</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Noch keine Prüfungen eingetragen.</Empty>}
      </div>
      <div className="card">
        <h3>Bestandene Prüfung eintragen</h3>
        <div className="form-grid cols-2">
          <Field label="Neuer Grad"><Select value={g.grad ?? null} onChange={(v) => setG({ ...g, grad: v ?? undefined })} options={GRADES.map((x) => ({ value: x.id, label: x.name }))} /></Field>
          <Field label="Prüfungsdatum"><DateInput value={g.datum} onChange={(v) => setG({ ...g, datum: v ?? undefined })} /></Field>
          <Field label="Prüfer"><TextInput value={g.pruefer} onChange={(v) => setG({ ...g, pruefer: v })} /></Field>
          <Field label="Notiz"><TextInput value={g.notiz} onChange={(v) => setG({ ...g, notiz: v })} /></Field>
        </div>
        <p className="muted small">Der aktuelle Grad des Mitglieds wird auf die jüngste Prüfung gesetzt. Prüfungsgebühren kannst du im Beitragskonto als Forderung eintragen.</p>
        <button className="primary" disabled={!g.grad || !g.datum} onClick={add}>Eintragen</button>
      </div>
    </div>
  );
}

function CancellationDialog({ m, onClose }: { m: Member; onClose: () => void }) {
  const frist = Number(getSetting('kuendigungsfrist_monate', '3')) || 3;
  const [eingang, setEingang] = useState<string>(todayISO());
  const earliest = earliestExitDate(eingang, frist);
  const [austritt, setAustritt] = useState<string | null>(null);
  const effective = austritt ?? earliest;
  const save = () =>
    attempt(() => {
      run("UPDATE members SET kuendigung_eingang = ?, austritt = ?, updated_at = datetime('now') WHERE id = ?", [eingang, effective, m.id]);
      onClose();
    }, `Kündigung erfasst – Austritt zum ${formatDate(effective)}`);
  return (
    <Modal
      title={`Kündigung: ${m.vorname} ${m.nachname}`}
      onClose={onClose}
      footer={<><button onClick={onClose}>Abbrechen</button><button className="primary" onClick={save}>Kündigung speichern</button></>}
    >
      <div className="form-grid cols-2">
        <Field label="Kündigung eingegangen am"><DateInput value={eingang} onChange={(v) => { setEingang(v ?? todayISO()); setAustritt(null); }} /></Field>
        <Field label="Austritt zum" hint={austritt && austritt < earliest ? 'Achtung: vor dem frühestmöglichen Termin (Sonderkündigung?)' : undefined}>
          <DateInput value={effective} onChange={setAustritt} />
        </Field>
      </div>
      <div className="callout">
        Frühestmöglicher Austritt: <strong>{formatDate(earliest)}</strong>
        <div className="muted small">Eingang {formatDate(eingang)} + {frist} Monate, zum Monatsende. Die Frist kannst du unter „Daten & Einstellungen" anpassen.</div>
      </div>
    </Modal>
  );
}

function printConfirmation(m: Member) {
  const vd = getVereinsdaten();
  const verein = vd.verein_name || 'Karateverein';
  const adresse = [vd.verein_strasse, `${vd.verein_plz} ${vd.verein_ort}`.trim()].filter(Boolean).join('\n');
  const unterzeichner = signatory();
  const body = `
    <div class="absender">${escapeHtml(verein)}${adresse ? ' · ' + escapeHtml(adresse.replace(/\n/g, ' · ')) : ''}</div>
    <div class="anschrift">${escapeHtml([m.anrede, m.titel, m.vorname, m.nachname].filter(Boolean).join(' '))}<br>
      ${escapeHtml(m.strasse)}<br>${m.adresszusatz ? escapeHtml(m.adresszusatz) + '<br>' : ''}${escapeHtml(m.plz)} ${escapeHtml(m.ort)}</div>
    <div class="datum">${escapeHtml(formatDate(todayISO()))}</div>
    <h1>Bestätigung Ihrer Kündigung</h1>
    <p>${m.anrede === 'Frau' ? 'Sehr geehrte Frau' : m.anrede === 'Herr' ? 'Sehr geehrter Herr' : 'Guten Tag'} ${escapeHtml(m.anrede ? m.nachname : `${m.vorname} ${m.nachname}`)},</p>
    <p>hiermit bestätigen wir den Eingang Ihrer Kündigung${m.kuendigung_eingang ? ` vom ${escapeHtml(formatDate(m.kuendigung_eingang))}` : ''}.
       Ihre Mitgliedschaft${m.mitgliedsnr ? ` (Mitgliedsnummer ${escapeHtml(m.mitgliedsnr)})` : ''} endet zum
       <strong>${escapeHtml(formatDate(m.austritt))}</strong>.</p>
    <p>Bis zu diesem Zeitpunkt sind die Mitgliedsbeiträge noch zu entrichten. ${m.sepa_mandat_ref ? 'Das SEPA-Lastschriftmandat erlischt mit Ende der Mitgliedschaft.' : ''}</p>
    <p>Wir bedanken uns für Ihre Mitgliedschaft${gradeIndex(m.grad) > 0 ? ` und Ihren Weg bis zum ${escapeHtml(gradeName(m.grad))}` : ''} und wünschen Ihnen alles Gute.</p>
    <p class="sign">Mit sportlichen Grüßen<br><br><br>${escapeHtml(unterzeichner).replace(/\n/g, '<br>')}<br>${escapeHtml(verein)}</p>`;
  printHtml(`Kündigungsbestätigung ${m.vorname} ${m.nachname}`, body);
}
