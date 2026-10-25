import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatAmountInput, parseAmount } from '../lib/format';
import { GRADES } from '../db/seed';

const modalStack: number[] = [];
let modalSeq = 0;

export function Modal(props: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'normal' | 'wide' | 'full';
}) {
  const [id] = useState(() => ++modalSeq);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  useEffect(() => {
    // Escape schließt nur den obersten Dialog
    modalStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) {
        e.stopImmediatePropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(id), 1);
    };
  }, [id]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal modal-${props.size ?? 'normal'}`} role="dialog" aria-modal="true">
        <header className="modal-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Schließen">✕</button>
        </header>
        <div className="modal-body">{props.children}</div>
        {props.footer && <footer className="modal-foot">{props.footer}</footer>}
      </div>
    </div>
  );
}

export function Field(props: { label: string; children: ReactNode; hint?: ReactNode; span?: 1 | 2 | 3 | 4; error?: string }) {
  return (
    <label className={`field span-${props.span ?? 1}`}>
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.error ? <span className="field-error">{props.error}</span> : props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

export function TextInput(props: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  list?: string;
}) {
  return (
    <input
      type={props.type ?? 'text'}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      list={props.list}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

export function TextArea(props: { value: string | null | undefined; onChange: (v: string) => void; rows?: number }) {
  return <textarea rows={props.rows ?? 3} value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value)} />;
}

export function DateInput(props: { value: string | null | undefined; onChange: (v: string | null) => void }) {
  return <input type="date" value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value || null)} />;
}

/** Betragseingabe in Euro, liefert Cent. */
export function MoneyInput(props: { value: number | null | undefined; onChange: (cent: number | null) => void; placeholder?: string; autoFocus?: boolean }) {
  const [text, setText] = useState(formatAmountInput(props.value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(formatAmountInput(props.value));
  }, [props.value, focused]);
  return (
    <div className="money-input">
      <input
        inputMode="decimal"
        value={text}
        placeholder={props.placeholder ?? '0,00'}
        autoFocus={props.autoFocus}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setText(e.target.value);
          props.onChange(parseAmount(e.target.value, ','));
        }}
        onBlur={() => {
          setFocused(false);
          setText(formatAmountInput(parseAmount(text, ',')));
        }}
      />
      <span>€</span>
    </div>
  );
}

export function Select<T extends string | number>(props: {
  value: T | null | undefined;
  onChange: (v: T | null) => void;
  options: { value: T; label: string; group?: string }[];
  empty?: string;
  numeric?: boolean;
}) {
  const groups = [...new Set(props.options.map((o) => o.group ?? ''))];
  const renderOpts = (opts: typeof props.options) =>
    opts.map((o) => (
      <option key={String(o.value)} value={String(o.value)}>
        {o.label}
      </option>
    ));
  return (
    <select
      value={props.value == null ? '' : String(props.value)}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '') props.onChange(null);
        else props.onChange((props.numeric || typeof props.options[0]?.value === 'number' ? Number(v) : v) as T);
      }}
    >
      {props.empty !== undefined && <option value="">{props.empty}</option>}
      {groups.length > 1
        ? groups.map((g) => (
            <optgroup key={g} label={g}>
              {renderOpts(props.options.filter((o) => (o.group ?? '') === g))}
            </optgroup>
          ))
        : renderOpts(props.options)}
    </select>
  );
}

export function Checkbox(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function GradeBadge({ grad }: { grad: string }) {
  const g = GRADES.find((x) => x.id === grad) ?? GRADES[0];
  return (
    <span className="grade">
      <span className="belt" style={{ background: g.farbe, borderColor: g.rand ?? g.farbe }} />
      {g.name}
    </span>
  );
}

export function Badge(props: { tone?: 'ok' | 'warn' | 'bad' | 'info' | 'muted'; children: ReactNode; title?: string }) {
  return <span className={`badge badge-${props.tone ?? 'muted'}`} title={props.title}>{props.children}</span>;
}

export function Empty(props: { children: ReactNode }) {
  return <div className="empty">{props.children}</div>;
}

export function PageHeader(props: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <p className="muted">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="actions">{props.actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>(props: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {props.tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={props.value === t.id} className={props.value === t.id ? 'active' : ''} onClick={() => props.onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function YearSelect(props: { value: number; onChange: (y: number) => void; from?: number; to?: number }) {
  const now = new Date().getFullYear();
  const years: number[] = [];
  for (let y = (props.to ?? now + 1); y >= (props.from ?? now - 8); y--) years.push(y);
  if (!years.includes(props.value)) years.push(props.value);
  return (
    <select className="year-select" value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} aria-label="Geschäftsjahr">
      {years.sort((a, b) => b - a).map((y) => (
        <option key={y} value={y}>Geschäftsjahr {y}</option>
      ))}
    </select>
  );
}

export function Stat(props: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'bad'; sub?: ReactNode; onClick?: () => void }) {
  return (
    <div className={`stat ${props.tone ? 'stat-' + props.tone : ''} ${props.onClick ? 'clickable' : ''}`} onClick={props.onClick}>
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      {props.sub && <div className="stat-sub">{props.sub}</div>}
    </div>
  );
}

// ---------- Meldungen ----------

type Toast = { id: number; text: string; tone: 'ok' | 'bad' | 'info' };
let toasts: Toast[] = [];
let toastListener: ((t: Toast[]) => void) | null = null;
let toastId = 0;

export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const t = { id: ++toastId, text, tone };
  toasts = [...toasts, t];
  toastListener?.(toasts);
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListener?.(toasts);
  }, tone === 'bad' ? 7000 : 3500);
}

export function Toaster() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    toastListener = setList;
    return () => {
      toastListener = null;
    };
  }, []);
  return (
    <div className="toaster" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>
      ))}
    </div>
  );
}

/** Führt eine Aktion aus und zeigt Fehler als Meldung an. */
export function attempt(fn: () => void, okText?: string): boolean {
  try {
    fn();
    if (okText) toast(okText);
    return true;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'bad');
    return false;
  }
}
