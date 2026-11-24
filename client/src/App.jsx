import { useEffect, useState, useCallback } from 'react';
import { get, post, setUnauthorizedHandler } from './api.js';
import { Toast, ErrorBox, Loading } from './components.jsx';
import Student, { Board } from './Student.jsx';
import Account from './Account.jsx';
import { StaffQueue, Admin } from './Staff.jsx';

// Navigation is derived from the server-issued permission list (RBAC), not from a client-side guess.
const NAV = [
  ['report', 'Report a problem', 'report:create'],
  ['mine', 'My issues', 'issue:read_own'],
  ['queue', 'Department queue', 'queue:read_dept'],
  ['all', 'All issues', 'admin:issues'],
  ['conf', 'Confidential', 'admin:confidential'],
  ['users', 'Users and trust', 'admin:users'],
  ['flags', 'Abuse flags', 'admin:flags'],
  ['summary', 'Summary', 'admin:summary'],
  ['export', 'Export to Excel', 'admin:export'],
  ['board', 'Campus board', 'board:read'],
  ['trust', 'My trust score', 'issue:vote'],
  ['account', 'Account security', 'account:manage'],
];

export default function App() {
  const [config, setConfig] = useState(null);
  const [me, setMe] = useState(undefined); // undefined = checking session
  const [page, setPage] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);

  const notify = useCallback((text, kind = 'ok') => setToast({ text, kind }), []);
  const clearToast = useCallback(() => setToast(null), []);

  const loadMe = useCallback(async () => {
    try {
      const m = await get('/api/me');
      setMe(m);
      setPage((p) => p || NAV.find(([, , perm]) => m.permissions.includes(perm))?.[0]);
    } catch { setMe(null); }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setMe(null); setPage(null); });
    get('/api/config').then(setConfig).catch((e) => setError(e.message));
    loadMe();
  }, [loadMe]);

  async function logout() {
    try { await post('/api/auth/logout'); } catch { /* ignore */ }
    setMe(null); setPage(null);
  }
  async function reset() {
    if (!window.confirm('Reset all data? Every report, vote and student account will be deleted, demo accounts are reseeded, and you will be signed out.')) return;
    try { await post('/api/demo/reset'); setMe(null); setPage(null); } catch (e) { setError(e.message); }
  }

  if (me === undefined) return <div className="center"><Loading /></div>;
  if (!me) return <Login onDone={loadMe} error={error} />;

  const nav = NAV.filter(([, , perm]) => me.permissions.includes(perm));
  const roleLabel = me.role === 'staff' ? `${me.department} staff` : me.role === 'admin' ? 'Administrator' : 'Student';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-mark" aria-hidden="true">RF</span>
          <span>ReportFix</span>
        </div>
        <nav className="nav" aria-label="Main">
          {nav.map(([k, label]) => (
            <button key={k} className={page === k ? 'nav-item active' : 'nav-item'} aria-current={page === k ? 'page' : undefined} onClick={() => setPage(k)}>{label}</button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-card">
            <div className="avatar" aria-hidden="true">{initials(me.name)}</div>
            <div>
              <div className="user-name">{me.name}</div>
              <div className="user-role">{roleLabel}{me.role === 'student' ? ` · trust ${me.trust_score}` : ''}</div>
            </div>
          </div>
          {config?.demo && me.permissions.includes('demo:reset') && <button className="btn ghost danger block" onClick={reset}>Reset demo data</button>}
          <button className="btn ghost block" onClick={logout}>Sign out</button>
          <div className="ai-pill">AI: {config?.ai || '...'}</div>
        </div>
      </aside>
      <main className="main">
        <header className="page-head">
          <h1>{nav.find(([k]) => k === page)?.[1] || 'ReportFix'}</h1>
          <p className="muted">{SUBTITLE[page] || ''}</p>
        </header>
        <ErrorBox text={error} />
        {page === 'account' && <Account me={me} notify={notify} reload={loadMe} />}
        {me.role === 'student' && page !== 'account' && <Student key={page} tab={page} setTab={setPage} notify={notify} />}
        {me.role === 'staff' && page === 'queue' && <StaffQueue user={me} notify={notify} />}
        {me.role === 'admin' && !['board', 'account'].includes(page) && <Admin key={page} tab={page} notify={notify} />}
        {me.role !== 'student' && page === 'board' && <Board notify={notify} readOnly />}
      </main>
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}

const SUBTITLE = {
  report: 'Write it the way you would say it: English, Roman Urdu or both. Say what is wrong and where.',
  mine: 'Everything you reported or joined, with live status. Updates every 3 seconds.',
  board: 'Public issues across campus. Add "me too" if it affects you.',
  trust: 'Your score decides how much your votes count. Every change is listed with its reason.',
  queue: 'Only your department. Highest priority first.',
  all: 'Every public issue across departments.',
  conf: 'Harassment and ragging reports. Reporter identity is never shown.',
  users: 'Trust scores and the reasons behind them.',
  flags: 'Injection attempts, brigading and hazards reported without a place.',
  summary: 'An AI overview of open public issues. Confidential reports are excluded.',
  account: 'Your password and two-factor sign-in.',
  export: 'Download every reported problem, student report and location as an Excel workbook.',
};

function initials(name) {
  return String(name).replace(/\(.*\)/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function Login({ onDone, error: outerError }) {
  const [mode, setMode] = useState('login'); // login | register | mfa | reset
  const [form, setForm] = useState({ name: '', username: '', password: '', website: '', code: '', resetCode: '' });
  const [challenge, setChallenge] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const go = (m) => { setMode(m); setError(null); setInfo(null); };

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === 'login') {
        const r = await post('/api/auth/login', { username: form.username, password: form.password, website: form.website || undefined });
        if (r.mfa_required) { setChallenge(r.challenge); setForm((f) => ({ ...f, password: '' })); go('mfa'); return; }
      } else if (mode === 'register') {
        await post('/api/auth/register', { name: form.name, username: form.username, password: form.password, website: form.website || undefined });
      } else if (mode === 'mfa') {
        await post('/api/auth/mfa/verify', { challenge, code: form.code });
      } else if (mode === 'reset') {
        await post('/api/auth/reset', { username: form.username, code: form.resetCode, new_password: form.password });
        setForm((f) => ({ ...f, password: '', resetCode: '' }));
        go('login');
        setInfo('Password reset. Sign in with your new password.');
        return;
      }
      setForm({ name: '', username: '', password: '', website: '', code: '', resetCode: '' });
      await onDone();
    } catch (err) {
      setError(err.message);
      if (mode === 'mfa' && /expired/i.test(err.message)) go('login');
    } finally { setBusy(false); }
  }

  if (mode === 'mfa' || mode === 'reset') {
    return (
      <div className="auth">
        <section className="auth-intro">
          <div className="logo big"><span className="logo-mark" aria-hidden="true">RF</span><span>ReportFix</span></div>
          <h2>{mode === 'mfa' ? 'One more step.' : 'Reset your password.'}</h2>
          <p>{mode === 'mfa' ? 'Open your authenticator app and enter the 6-digit code for ReportFix.' : 'Ask the admin office for a one-time reset code. It works once and expires after 15 minutes.'}</p>
        </section>
        <section className="auth-card">
          <form onSubmit={submit}>
            {mode === 'mfa' ? (
              <label className="field">6-digit code
                <input className="code-input" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} value={form.code} onChange={set('code')} required />
              </label>
            ) : (
              <>
                <label className="field">Username<input value={form.username} onChange={set('username')} required maxLength={32} autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
                <label className="field">Reset code<input value={form.resetCode} onChange={set('resetCode')} required maxLength={40} placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" spellCheck={false} /></label>
                <label className="field">New password<input type="password" value={form.password} onChange={set('password')} required minLength={10} maxLength={128} autoComplete="new-password" /></label>
              </>
            )}
            <ErrorBox text={error} />
            <button className="btn primary block" disabled={busy}>{busy ? 'Please wait...' : mode === 'mfa' ? 'Verify and sign in' : 'Set new password'}</button>
            <button type="button" className="btn link block" onClick={() => { setChallenge(null); go('login'); }}>Back to sign in</button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="auth">
      <section className="auth-intro">
        <div className="logo big"><span className="logo-mark" aria-hidden="true">RF</span><span>ReportFix</span></div>
        <h2>Projector dead in Lab 3? Report it once.</h2>
        <p>The right department gets it. The students it affects confirm the fix.</p>
      </section>
      <section className="auth-card">
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'seg-btn active' : 'seg-btn'} onClick={() => go('login')}>Sign in</button>
          <button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'seg-btn active' : 'seg-btn'} onClick={() => go('register')}>Create student account</button>
        </div>
        <form onSubmit={submit} autoComplete="on">
          {mode === 'register' && (
            <label className="field">Full name
              <input value={form.name} onChange={set('name')} maxLength={60} required autoComplete="name" />
            </label>
          )}
          <label className="field">Username
            <input value={form.username} onChange={set('username')} maxLength={32} required autoComplete="username" autoCapitalize="none" spellCheck={false} />
          </label>
          <label className="field">Password
            <input type="password" value={form.password} onChange={set('password')} maxLength={128} minLength={mode === 'register' ? 10 : undefined} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>
          {mode === 'register' && <p className="hint">At least 10 characters. Staff and admin accounts are issued by the university, not created here.</p>}
          {/* honeypot: hidden from people, bots fill it */}
          <div className="hp" aria-hidden="true">
            <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
          </div>
          {info && <p className="ok">{info}</p>}
          <ErrorBox text={error || outerError} />
          <button className="btn primary block" disabled={busy} type="submit">{busy ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
          {mode === 'login' && <button type="button" className="btn link block" onClick={() => go('reset')}>Forgot password?</button>}
        </form>
      </section>
    </div>
  );
}
