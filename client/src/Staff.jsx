import { useState } from 'react';
import { get, post, patch } from './api.js';
import { usePoll, StatusChip, SeverityChip, Loading, ErrorBox, Empty, PriorityWhy, Timeline, TrustHistory, groupBy, fmtTime } from './components.jsx';

const DEPTS = ['EE', 'CSE', 'IS', 'Library', 'Cafeteria', 'Labs', 'Admin'];

function chunks(list) {
  return groupBy(list, [
    ['new', 'New and reopened', (i) => ['open', 'reopened'].includes(i.status)],
    ['work', 'Acknowledged / in progress', (i) => ['acknowledged', 'in_progress'].includes(i.status)],
    ['resolved', 'Resolved - waiting for affected students', (i) => i.status === 'resolved'],
    ['done', 'Finished', (i) => ['closed', 'rejected'].includes(i.status)],
  ]);
}

export function StaffQueue({ user, notify }) {
  const { data, error, loading, reload } = usePoll(() => get('/api/staff/queue'));
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox text={error} />;
  if (!data.length) return <Empty text={`No issues in the ${user.department} queue. Nothing to fix right now.`} action="Refresh" onAction={reload} />;
  return (
    <section>
      <ErrorBox text={error} />
      {chunks(data).map(([k, label, list]) => (
        <div className="group" key={k}>
          <h3>{label} ({list.length})</h3>
          {list.map((i) => <ManageCard key={i.id} i={i} notify={notify} onChange={reload} />)}
        </div>
      ))}
    </section>
  );
}

const NEXT = {
  open: [['acknowledged', 'Acknowledge'], ['in_progress', 'Start work'], ['resolved', 'Mark resolved']],
  reopened: [['acknowledged', 'Acknowledge'], ['in_progress', 'Start work'], ['resolved', 'Mark resolved']],
  acknowledged: [['in_progress', 'Start work'], ['resolved', 'Mark resolved']],
  in_progress: [['resolved', 'Mark resolved']],
};

export function ManageCard({ i, notify, onChange }) {
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(null); // 'reject' | 'reroute'
  const [note, setNote] = useState('');
  const [dept, setDept] = useState('');
  const actions = NEXT[i.status] || [];

  async function run(fn, msg) {
    setError(null);
    try { await fn(); notify(msg); setMode(null); setNote(''); onChange(); } catch (e) { setError(e.message); }
  }
  const setStatus = (status, n) => run(() => patch(`/api/issues/${i.id}/status`, { status, note: n || undefined }), `Status: ${status.replace('_', ' ')}`);

  return (
    <div className="card">
      <div className="card-head"><strong>#{i.id} {i.title}</strong><StatusChip status={i.status} /></div>
      <p><span className="label-inline">AI reason:</span> {i.reason}</p>
      {i.text && <p className="quote">{i.text}</p>}
      <p className="muted">
        <SeverityChip severity={i.severity} /> priority {i.priority}{i.hazard !== 'none' ? ` - hazard: ${i.hazard}` : ''} - {i.crowd?.affected ?? i.affected_count} affected (trust-weighted {i.crowd?.trust_weighted}) - dept {i.department} - reported {fmtTime(i.created_at)}
      </p>
      {i.votes && (i.votes.confirm + i.votes.dispute > 0) && (
        <p className="muted">Votes this round: {i.votes.confirm} confirm (weight {i.votes.confirm_weight}), {i.votes.dispute} dispute (weight {i.votes.dispute_weight}){i.votes.discounted ? `, ${i.votes.discounted} discounted as brigading` : ''}</p>
      )}
      {actions.length > 0 && (
        <div className="row wrap">
          {actions.map(([s, label], k) => <button key={s} className={k === actions.length - 1 ? 'btn primary' : 'btn'} onClick={() => setStatus(s)}>{label}</button>)}
          <button className="btn" onClick={() => setMode(mode === 'reroute' ? null : 'reroute')}>Re-route</button>
          <button className="btn danger" onClick={() => setMode(mode === 'reject' ? null : 'reject')}>Reject as spam</button>
        </div>
      )}
      {mode === 'reject' && (
        <div className="row wrap">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why is this spam or fake? (reporter loses 10 trust)" aria-label="Reject reason" />
          <button className="btn danger" disabled={note.trim().length < 3} onClick={() => setStatus('rejected', note)}>Confirm reject</button>
        </div>
      )}
      {mode === 'reroute' && (
        <div className="row wrap">
          <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="New department">
            <option value="">Send to...</option>
            {DEPTS.filter((d) => d !== i.department).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Reason (logged)" aria-label="Re-route reason" />
          <button className="btn primary" disabled={!dept || note.trim().length < 5} onClick={() => run(() => post(`/api/issues/${i.id}/reroute`, { department: dept, reason: note }), `Re-routed to ${dept}`)}>Re-route</button>
        </div>
      )}
      <ErrorBox text={error} />
      <PriorityWhy b={i.priority_breakdown} />
      <Timeline items={i.timeline} />
    </div>
  );
}

export function Admin({ notify, tab }) {
  return (
    <>
      {tab === 'all' && <AllIssues notify={notify} />}
      {tab === 'conf' && <Confidential notify={notify} />}
      {tab === 'users' && <Users />}
      {tab === 'flags' && <Flags />}
      {tab === 'summary' && <Summary />}
      {tab === 'export' && <ExportPanel notify={notify} />}
    </>
  );
}

function AllIssues({ notify }) {
  const { data, error, loading, reload } = usePoll(() => get('/api/admin/issues'));
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox text={error} />;
  if (!data.length) return <Empty text="No public issues yet." action="Refresh" onAction={reload} />;
  return (
    <section>
      {chunks(data).map(([k, label, list]) => (
        <div className="group" key={k}><h3>{label} ({list.length})</h3>{list.map((i) => <ManageCard key={i.id} i={i} notify={notify} onChange={reload} />)}</div>
      ))}
    </section>
  );
}

function Confidential({ notify }) {
  const { data, error, loading, reload } = usePoll(() => get('/api/admin/confidential'));
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox text={error} />;
  if (!data.length) return <Empty text="No confidential reports." action="Refresh" onAction={reload} />;
  return (
    <section>
      <p className="muted">Harassment and ragging reports. Never shown on the board, trending, summaries or department queues. Reporter is always hidden.</p>
      {data.map((i) => <ConfCard key={i.id} i={i} notify={notify} onChange={reload} />)}
    </section>
  );
}

function ConfCard({ i, notify, onChange }) {
  const [error, setError] = useState(null);
  const actions = NEXT[i.status] || [];
  async function setStatus(status) {
    try { await patch(`/api/issues/${i.id}/status`, { status }); notify(`Status: ${status.replace('_', ' ')}`); onChange(); } catch (e) { setError(e.message); }
  }
  return (
    <div className="card">
      <div className="card-head"><strong>#{i.id} Confidential - {i.reporter}</strong><StatusChip status={i.status} /></div>
      <p className="quote">{i.text}</p>
      <p className="muted"><SeverityChip severity={i.severity} /> priority {i.priority}{i.hazard !== 'none' ? ` - hazard: ${i.hazard} (someone may be hurt)` : ''} - place: {i.location}</p>
      {actions.length > 0 && <div className="row wrap">{actions.map(([s, label]) => <button key={s} className="btn" onClick={() => setStatus(s)}>{label}</button>)}</div>}
      <ErrorBox text={error} />
      <Timeline items={i.timeline} />
    </div>
  );
}

function Users() {
  const { data, error, loading } = usePoll(() => get('/api/admin/users'), 5000);
  const [open, setOpen] = useState(null);
  const [issued, setIssued] = useState(null);
  const [err, setErr] = useState(null);
  async function resetCode(u) {
    if (!window.confirm(`Issue a one-time password reset code for ${u.username}? Give it to them in person. It expires in 15 minutes.`)) return;
    setErr(null);
    try { setIssued(await post(`/api/admin/users/${u.id}/reset-code`)); } catch (e) { setErr(e.message); }
  }
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox text={error} />;
  return (
    <section>
      {issued && (
        <div className="panel issued">
          <strong>Reset code for {issued.username}</strong>
          <div className="secret">{issued.code}</div>
          <p className="muted small">Shown once. Valid {issued.expires_in_minutes} minutes, single use. They enter it under "Forgot password?" on the sign-in page.</p>
          <button className="btn small" onClick={() => setIssued(null)}>Done</button>
        </div>
      )}
      <ErrorBox text={err} />
      <table className="table">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>2FA</th><th>Trust</th><th>Weight</th><th></th></tr></thead>
        <tbody>
          {data.map((u) => (
            <tr key={u.id}>
              <td>{u.name}{u.new_account ? ' (new)' : ''}</td>
              <td>{u.username}</td>
              <td>{u.role}{u.department ? ` - ${u.department}` : ''}</td>
              <td>{u.mfa_enabled ? 'On' : 'Off'}</td>
              <td>{u.trust_score}</td>
              <td>{u.vote_weight}</td>
              <td className="actions">
                <button className="btn small" onClick={() => setOpen(open === u.id ? null : u.id)}>{open === u.id ? 'Hide' : 'Why?'}</button>
                {u.role !== 'admin' && <button className="btn small" onClick={() => resetCode(u)}>Reset code</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <div className="panel"><h4>Trust history: {data.find((u) => u.id === open)?.name}</h4><TrustHistory events={data.find((u) => u.id === open)?.trust_events} /></div>}
    </section>
  );
}

function Flags() {
  const { data, error, loading, reload } = usePoll(() => get('/api/admin/flags'), 5000);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox text={error} />;
  if (!data.length) return <Empty text="No injection, brigading or unlocated-hazard flags." action="Refresh" onAction={reload} />;
  return (
    <table className="table">
      <thead><tr><th>When</th><th>Kind</th><th>Detail</th><th>User</th></tr></thead>
      <tbody>{data.map((f) => <tr key={f.id}><td>{fmtTime(f.created_at)}</td><td>{f.kind}</td><td>{f.detail}</td><td>{f.user_name || '-'}</td></tr>)}</tbody>
    </table>
  );
}

function ExportPanel({ notify }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function download() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/admin/export.xlsx', { credentials: 'same-origin' });
      if (!res.ok) {
        let msg = 'Export failed.';
        try { msg = (await res.json()).error || msg; } catch { /* not json */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const name = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'reportfix.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`Downloaded ${name}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const sheets = [
    ['Reported problems', 'Every public issue: problem, location, building, department, severity, hazard, priority, status, students affected, dates, AI reason.'],
    ['Reports by student', 'Each report with the student name and username, location, what they wrote, where it was routed, and whether AI or the backup classifier triaged it.'],
    ['Students', 'Trust score, vote weight, reports, issues they are affected by, votes, 2FA status, join date.'],
    ['Locations', 'Per campus place: total and open issues, critical hazards, students affected, most common problem.'],
    ['Confidential (anonymous)', 'Harassment cases with severity and status only. Reporters are never named anywhere in the file.'],
  ];
  return (
    <section className="panel">
      <h2 className="panel-title">Excel workbook (.xlsx)</h2>
      <p className="muted small">Generated live from the database. Opens in Excel, Google Sheets and LibreOffice. Each download is recorded under Abuse flags.</p>
      <table className="table" style={{ margin: '12px 0 16px' }}>
        <thead><tr><th>Sheet</th><th>Contents</th></tr></thead>
        <tbody>{sheets.map(([n, c]) => <tr key={n}><td><strong>{n}</strong></td><td>{c}</td></tr>)}</tbody>
      </table>
      <button className="btn primary" onClick={download} disabled={busy}>{busy ? 'Building workbook...' : 'Download Excel report'}</button>
      <ErrorBox text={error} />
    </section>
  );
}

function Summary() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function load() {
    setBusy(true); setError(null);
    try { setS(await get('/api/admin/summary')); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="panel">
      <p className="muted">One AI call over issue statistics only. Confidential reports are excluded in the SQL query.</p>
      <button className="btn primary" onClick={load} disabled={busy}>{busy ? 'Summarising...' : 'Generate summary'}</button>
      <ErrorBox text={error} />
      {s && <p className="result">{s.summary} <span className="muted">({s.source === 'ai' ? 'AI summary' : 'computed summary, AI unavailable'})</span></p>}
    </section>
  );
}
