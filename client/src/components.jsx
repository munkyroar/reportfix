import { useEffect, useRef, useState, useCallback } from 'react';

export function usePoll(fn, ms = 3000, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const load = useCallback(async () => {
    try { setData(await fnRef.current()); setError(null); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload: load };
}

const STATUS_LABEL = {
  open: 'Open', acknowledged: 'Acknowledged', in_progress: 'In progress', resolved: 'Resolved - awaiting students',
  reopened: 'Reopened', closed: 'Closed - fix confirmed', rejected: 'Rejected',
};
export const statusLabel = (s) => STATUS_LABEL[s] || s;

export function StatusChip({ status }) {
  return <span className={`chip chip-${status}`}>{statusLabel(status)}</span>;
}
export function SeverityChip({ severity }) {
  return <span className={`chip sev-${severity}`}>{severity}</span>;
}

export function Loading({ text = 'Loading...' }) {
  return <p className="muted" role="status">{text}</p>;
}
export function ErrorBox({ text }) {
  return text ? <p className="error" role="alert">{text}</p> : null;
}
export function Empty({ text, action, onAction }) {
  return (
    <div className="empty">
      <p>{text}</p>
      {action && <button className="btn" onClick={onAction}>{action}</button>}
    </div>
  );
}

export function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return <div className={`toast ${toast.kind || ''}`} role="status">{toast.text}</div>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <nav className="tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'tab active' : 'tab'} onClick={() => onChange(k)}>{label}</button>
      ))}
    </nav>
  );
}

export function fmtTime(ms) {
  const d = new Date(ms);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function PriorityWhy({ b }) {
  if (!b) return null;
  return (
    <details className="why">
      <summary>Why this priority?</summary>
      <ul>
        <li>Severity: {b.severity} (base {b.base}){b.severity === 'Critical' ? ' - safety hazard, always top' : ''}</li>
        <li>Affected students: {b.members} (credible: {b.credible_members}), trust-weighted sum {b.sum_weights}, each person capped at {b.per_person_cap}</li>
        <li>Crowd boost: {b.formula}</li>
        <li>Cap: {b.cap_rule}{b.capped ? ` - capped at ${b.cap}` : ''}</li>
        <li><strong>Priority: {b.total}</strong></li>
      </ul>
    </details>
  );
}

export function Timeline({ items }) {
  if (!items?.length) return null;
  return (
    <details className="why">
      <summary>Status timeline ({items.length})</summary>
      <ol className="timeline">
        {items.map((t, i) => (
          <li key={i}>
            <span className="muted">{fmtTime(t.at)} - {t.by}</span>
            <div>{t.from && t.from !== t.to ? `${statusLabel(t.from)} -> ${statusLabel(t.to)}` : statusLabel(t.to)}{t.note ? `: ${t.note}` : ''}</div>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function TrustHistory({ events }) {
  if (!events?.length) return <p className="muted">No trust changes yet.</p>;
  return (
    <table className="table">
      <thead><tr><th>When</th><th>Change</th><th>Why</th><th>Score after</th></tr></thead>
      <tbody>
        {events.map((e, i) => (
          <tr key={i}>
            <td>{fmtTime(e.created_at)}</td>
            <td className={e.delta > 0 ? 'pos' : e.delta < 0 ? 'neg' : ''}>{e.delta > 0 ? `+${e.delta}` : e.delta}</td>
            <td>{e.reason}</td>
            <td>{e.score_after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function groupBy(list, groups) {
  return groups.map(([key, label, pred]) => [key, label, list.filter(pred)]).filter(([, , l]) => l.length);
}
