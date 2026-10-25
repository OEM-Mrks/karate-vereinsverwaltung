import { useState } from 'react';
import { navigate, useQuery } from '../hooks';
import { formatDate, formatEUR, formatIBAN } from '../lib/format';
import { applyAndAssign, linkMember, linkPartner, openGroups, ruleForGroup, type PayerGroup } from '../lib/setup';
import { autoAssign } from '../lib/bank';
import { PickDialog, QuickMemberDialog, QuickPartnerDialog } from '../components/QuickCreate';
import { attempt, Empty, toast } from '../components/ui';

type Action = 'neuesMitglied' | 'mitglied' | 'neuerPartner' | 'partner' | 'kategorie';

/**
 * Ersteinrichtung: Offene Buchungen nach Zahlungspartner gruppiert. Pro Partner einmal entscheiden
 * (neues/bestehendes Mitglied, Lieferant, Kategorie) – alle Buchungen werden sofort zugeordnet und künftige automatisch.
 */
export function SetupByPayer() {
  const groups = useQuery(() => openGroups());
  const [active, setActive] = useState<{ g: PayerGroup; action: Action } | null>(null);
  const [filter, setFilter] = useState<'alle' | 'ein' | 'aus'>('alle');
  const done = (n: number, what: string) => {
    setActive(null);
    toast(`${what} – ${n} Buchung${n === 1 ? '' : 'en'} zugeordnet`);
  };
  const assigned = () => autoAssign(undefined).zugeordnet;

  const visible = groups.filter((g) => filter === 'alle' || (filter === 'ein' ? g.ein > 0 : g.aus > 0));
  const total = groups.reduce((s, g) => s + g.anzahl, 0);

  if (!groups.length) return <Empty>Alle Buchungen sind zugeordnet. 🎉</Empty>;
  return (
    <>
      <div className="callout">
        <strong>Ersteinrichtung aus dem Kontoauszug:</strong> {total} offene Buchungen von {groups.length} Zahlungspartnern.
        Entscheide pro Zahlungspartner einmal – alle seine Buchungen werden sofort zugeordnet, und künftige Importe erkennt die App automatisch
        (über die IBAN bzw. den Namen).
      </div>
      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="alle">Alle Zahlungspartner</option>
          <option value="ein">mit Eingängen (z. B. Mitglieder)</option>
          <option value="aus">mit Ausgängen (z. B. Lieferanten)</option>
        </select>
        <span className="muted small">{visible.length} Zahlungspartner</span>
      </div>
      <div className="table-wrap">
        <table className="table setup-table">
          <thead>
            <tr><th>Zahlungspartner</th><th className="num">Buchungen</th><th className="num">Beträge</th><th>Zuordnen als …</th></tr>
          </thead>
          <tbody>
            {visible.map((g) => (
              <tr key={g.key}>
                <td>
                  <strong>{g.name}</strong>
                  {g.iban && <div className="mono muted nowrap">{formatIBAN(g.iban)}</div>}
                  {g.beispiele.map((b, i) => <div key={i} className="muted small clamp">„{b}"</div>)}
                </td>
                <td className="num">
                  {g.anzahl}
                  <div className="muted small">{g.von === g.bis ? formatDate(g.von) : `${formatDate(g.von)} – ${formatDate(g.bis)}`}</div>
                </td>
                <td className="num">
                  {g.betraege.slice(0, 3).map((b) => (
                    <div key={b.betrag} className={b.betrag < 0 ? 'neg' : 'pos'}>{b.n > 1 ? `${b.n} × ` : ''}{formatEUR(b.betrag)}</div>
                  ))}
                  {g.betraege.length > 3 && <div className="muted small">…</div>}
                </td>
                <td>
                  <div className="setup-actions">
                    {g.ein > 0 && <button className="primary small-btn" onClick={() => setActive({ g, action: 'neuesMitglied' })}>Neues Mitglied</button>}
                    {g.ein > 0 && <button className="small-btn" onClick={() => setActive({ g, action: 'mitglied' })}>Bestehendes Mitglied</button>}
                    <button className={`small-btn ${g.ein === 0 ? 'primary' : ''}`} onClick={() => setActive({ g, action: 'neuerPartner' })}>Neuer Lieferant</button>
                    <button className="small-btn" onClick={() => setActive({ g, action: 'partner' })}>Bestehender Lieferant</button>
                    <button className="small-btn" onClick={() => setActive({ g, action: 'kategorie' })}>Nur Kategorie</button>
                    <button className="link small" onClick={() => navigate(`konto/${g.ids[0]}`)}>einzeln …</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active?.action === 'neuesMitglied' && (
        <QuickMemberDialog
          tx={active.g.first}
          onClose={() => setActive(null)}
          onCreated={(_, others) => done(others ? assigned() : autoAssign(active.g.ids).zugeordnet, 'Mitglied angelegt')}
        />
      )}
      {active?.action === 'neuerPartner' && (
        <QuickPartnerDialog
          tx={active.g.first}
          onClose={() => setActive(null)}
          onCreated={(_, others) => done(others ? assigned() : autoAssign(active.g.ids).zugeordnet, 'Partner angelegt')}
        />
      )}
      {active?.action === 'mitglied' && (
        <PickDialog
          kind="member"
          title={`Zahlungen von „${active.g.name}" einem Mitglied zuordnen`}
          hint="Hat das Mitglied noch keine IBAN, wird diese übernommen. Sonst (z. B. Eltern oder zweites Konto) entsteht eine Regel."
          onClose={() => setActive(null)}
          onPick={(memberId) => {
            let n = 0;
            if (attempt(() => { n = applyAndAssign(() => linkMember(memberId, active.g)); })) done(n, 'Mitglied verknüpft');
          }}
        />
      )}
      {active?.action === 'partner' && (
        <PickDialog
          kind="partner"
          title={`Zahlungen an/von „${active.g.name}" einem Lieferanten zuordnen`}
          onClose={() => setActive(null)}
          onPick={(partnerId, cat) => {
            let n = 0;
            if (attempt(() => { n = applyAndAssign(() => linkPartner(partnerId, active.g, cat)); })) done(n, 'Lieferant verknüpft');
          }}
        />
      )}
      {active?.action === 'kategorie' && (
        <PickDialog
          kind="category"
          title={`Kategorie für „${active.g.name}"`}
          hint="Es wird eine Regel angelegt – auch künftige Buchungen dieses Zahlungspartners landen in dieser Kategorie."
          onClose={() => setActive(null)}
          onPick={(cat) => {
            let n = 0;
            if (attempt(() => { n = applyAndAssign(() => ruleForGroup(active.g, cat)); })) done(n, 'Regel angelegt');
          }}
        />
      )}
    </>
  );
}
