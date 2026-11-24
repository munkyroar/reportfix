import { useState } from 'react';
import { post } from './api.js';
import { ErrorBox, fmtTime } from './components.jsx';

export default function Account({ me, notify, reload }) {
  return (
    <>
      <ChangePassword me={me} notify={notify} />
      <TwoFactor me={me} notify={notify} reload={reload} />
    </>
  );
}

function ChangePassword({ me, notify }) {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (f.next !== f.confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      await post('/api/account/password', { current_password: f.current, new_password: f.next });
      setF({ current: '', next: '', confirm: '' });
      notify('Password changed. Other devices were signed out.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <section className="panel">
      <h2 className="panel-title">Password</h2>
      <p className="muted small">{me.password_changed_at ? `Last changed ${fmtTime(me.password_changed_at)}.` : 'Never changed since the account was issued.'} Changing it signs out every other device.</p>
      <form onSubmit={submit} className="form-grid">
        <label className="field">Current password<input type="password" autoComplete="current-password" value={f.current} onChange={set('current')} required maxLength={128} /></label>
        <label className="field">New password<input type="password" autoComplete="new-password" value={f.next} onChange={set('next')} required minLength={10} maxLength={128} /></label>
        <label className="field">Repeat new password<input type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} required minLength={10} maxLength={128} /></label>
        <ErrorBox text={error} />
        <div><button className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</button></div>
      </form>
    </section>
  );
}

function TwoFactor({ me, notify, reload }) {
  const [stage, setStage] = useState('idle'); // idle | password | scan | disable
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };

  const start = () => run(async () => { setSetup(await post('/api/account/mfa/setup', { password: pw })); setPw(''); setStage('scan'); });
  const enable = () => run(async () => {
    await post('/api/account/mfa/enable', { code });
    setCode(''); setSetup(null); setStage('idle');
    notify('Two-factor sign-in is on.');
    reload();
  });
  const disable = () => run(async () => {
    await post('/api/account/mfa/disable', { password: pw, code });
    setPw(''); setCode(''); setStage('idle');
    notify('Two-factor sign-in is off.');
    reload();
  });

  return (
    <section className="panel">
      <div className="card-head">
        <h2 className="panel-title">Two-factor sign-in</h2>
        <span className={me.mfa_enabled ? 'chip chip-closed' : 'chip'}>{me.mfa_enabled ? 'On' : 'Off'}</span>
      </div>
      <p className="muted small">After your password, sign-in asks for a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy). Each code works once.</p>

      {!me.mfa_enabled && stage === 'idle' && <button className="btn primary" onClick={() => setStage('password')}>Turn on two-factor sign-in</button>}

      {stage === 'password' && (
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); start(); }}>
          <label className="field">Confirm your password<input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required maxLength={128} /></label>
          <div className="row wrap"><button className="btn primary" disabled={busy}>Continue</button><button type="button" className="btn" onClick={() => setStage('idle')}>Cancel</button></div>
        </form>
      )}

      {stage === 'scan' && setup && (
        <div className="form-grid">
          <ol className="steps">
            <li>In your authenticator app choose "Add account" then "Enter a setup key".</li>
            <li>Account: <strong>ReportFix ({me.username})</strong>. Key type: time based.</li>
            <li>Key:<div className="secret" aria-label="Setup key">{setup.secret.match(/.{1,4}/g).join(' ')}</div></li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
          <p className="muted small">On a phone, you can also open <a href={setup.otpauth}>this setup link</a>.</p>
          <form className="row wrap" onSubmit={(e) => { e.preventDefault(); enable(); }}>
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} aria-label="6-digit code" className="code-input" required />
            <button className="btn primary" disabled={busy}>Turn on</button>
            <button type="button" className="btn" onClick={() => { setStage('idle'); setSetup(null); }}>Cancel</button>
          </form>
        </div>
      )}

      {me.mfa_enabled && stage === 'idle' && <button className="btn danger" onClick={() => setStage('disable')}>Turn off two-factor sign-in</button>}
      {stage === 'disable' && (
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); disable(); }}>
          <label className="field">Password<input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required maxLength={128} /></label>
          <label className="field">Current 6-digit code<input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required className="code-input" /></label>
          <div className="row wrap"><button className="btn danger" disabled={busy}>Turn off</button><button type="button" className="btn" onClick={() => setStage('idle')}>Cancel</button></div>
        </form>
      )}
      <ErrorBox text={error} />
    </section>
  );
}
