import { useState, useEffect } from 'react';
import { get, post } from './api.js';
import { usePoll, StatusChip, SeverityChip, Loading, ErrorBox, Empty, PriorityWhy, Timeline, TrustHistory, groupBy, Photos, CLAIMS, prepareImage } from './components.jsx';

export default function Student({ notify, tab, setTab }) {
  return (
    <>
      {tab === 'report' && <ReportForm notify={notify} goMine={() => setTab('mine')} />}
      {tab === 'mine' && <MyIssues notify={notify} goReport={() => setTab('report')} />}
      {tab === 'board' && <Board notify={notify} goReport={() => setTab('report')} />}
      {tab === 'trust' && <MyTrust />}
    </>
  );
}

async function uploadPhoto(reportId, blob) {
  const res = await fetch(`/api/reports/${reportId}/photos`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob });
  if (!res.ok) {
    let msg = 'Photo upload failed.';
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return res.json();
}

function ReportForm({ notify, goMine }) {
  const [text, setText] = useState('');
  const [claim, setClaim] = useState('');
  const [files, setFiles] = useState([]); // [{file, url}]
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  function pick(e) {
    const chosen = Array.from(e.target.files || []).filter((f) => /^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type) || /\.(jpe?g|png)$/i.test(f.name));
    const next = [...files, ...chosen.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 3);
    setFiles(next);
    e.target.value = '';
  }
  function remove(i) {
    URL.revokeObjectURL(files[i].url);
    setFiles(files.filter((_, k) => k !== i));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null); setStage('Reading your report...');
    try {
      const r = await post('/api/report', { text, claimed_severity: claim || undefined });
      let uploaded = 0;
      const photoErrors = [];
      for (const [k, f] of files.entries()) {
        setStage(`Uploading photo ${k + 1} of ${files.length}...`);
        try { await uploadPhoto(r.report_id, await prepareImage(f.file)); uploaded++; } catch (err) { photoErrors.push(err.message); }
      }
      setResult({ ...r, photos_uploaded: uploaded, photo_errors: photoErrors });
      files.forEach((f) => URL.revokeObjectURL(f.url));
      setText(''); setClaim(''); setFiles([]);
      notify(r.confidential ? 'Sent privately to the admin.' : r.items.length ? 'Report saved and routed.' : 'Report saved. Tell us where it is.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false); setStage('');
    }
  }

  return (
    <section className="panel">
      <form onSubmit={submit}>
        <label htmlFor="report" className="label">What is wrong, and where?</label>
        <p className="muted small">Example: "Lab 3 ka projector kharab hai". Typos are fine. Harassment reports go privately to the admin.</p>
        <textarea id="report" rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe the problem..." />
        <span className="muted small">{text.length}/4000</span>

        <fieldset className="claim">
          <legend className="label">How serious is it? <span className="muted small">(optional)</span></legend>
          <div className="claim-row">
            {CLAIMS.map(([k, l]) => (
              <label key={k} className={claim === k ? 'claim-opt active' : 'claim-opt'}>
                <input type="radio" name="claim" value={k} checked={claim === k} onChange={() => setClaim(k)} />{l}
              </label>
            ))}
          </div>
          <p className="muted small">This does not change the priority. The admin checks how serious it really was; accurate ratings raise your trust score, exaggerated ones lower it.</p>
        </fieldset>

        <div className="label">Photos <span className="muted small">(optional, up to 3, JPEG or PNG)</span></div>
        <div className="photo-row">
          {files.map((f, i) => (
            <div key={f.url} className="photo-thumb">
              <img src={f.url} alt={`Selected photo ${i + 1}`} />
              <button type="button" className="photo-remove" onClick={() => remove(i)} aria-label={`Remove photo ${i + 1}`}>Remove</button>
            </div>
          ))}
          {files.length < 3 && (
            <label className="photo-add">
              <input type="file" accept="image/jpeg,image/png" multiple onChange={pick} />
              Add photo
            </label>
          )}
        </div>
        <p className="muted small">Location data (GPS) is removed from photos. Only the admin and the department fixing it can see them.</p>

        <div className="row">
          <span />
          <button className="btn primary" disabled={busy || !text.trim()} type="submit">{busy ? stage : 'Send report'}</button>
        </div>
      </form>
      <ErrorBox text={error} />
      {result && <ReportResult r={result} goMine={goMine} />}
    </section>
  );
}

function ReportResult({ r, goMine }) {
  return (
    <div className="result">
      {r.fallback_used && <p className="warn">Saved. AI was unavailable, so it was routed with the backup classifier.</p>}
      {r.confidential && <p className="ok">Sent privately to the admin. Your name is hidden and it never appears on the public board.</p>}
      {!r.confidential && r.items.map((i) => (
        <div key={i.issue_id} className="ok">
          {i.duplicate_of_own_report ? 'You already reported this; your count stays 1. ' : i.grouped ? 'Others reported this too; you were added to the same issue. ' : 'New issue created. '}
          Routed to <strong>{i.department}</strong> - {i.location} - <SeverityChip severity={i.severity} /> priority {i.priority}
        </div>
      ))}
      {r.needs_clarification?.length > 0 && (
        <p className="warn">We could not place {r.needs_clarification.length === 1 ? 'this problem' : 'some problems'}: {r.needs_clarification[0].why} Pick the place in My issues.</p>
      )}
      {r.photos_uploaded > 0 && <p className="ok">{r.photos_uploaded} photo{r.photos_uploaded > 1 ? 's' : ''} attached.</p>}
      {r.photo_errors?.length > 0 && <p className="warn">Report saved, but {r.photo_errors.length} photo{r.photo_errors.length > 1 ? 's' : ''} could not be attached: {r.photo_errors[0]}</p>}
      {r.decisions?.length > 0 && <ul className="muted small">{r.decisions.map((d, k) => <li key={k}>{d}</li>)}</ul>}
      <button className="btn" onClick={goMine}>Track it in My issues</button>
    </div>
  );
}

function MyIssues({ notify, goReport }) {
  const { data, error, loading, reload } = usePoll(() => get('/api/my/issues'));
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox text={error} />;
  const { issues, pending } = data;
  if (!issues.length && !pending.length) return <Empty text="You have not reported anything yet." action="Report a problem" onAction={goReport} />;
  const groups = groupBy(issues, [
    ['vote', 'Please confirm the fix', (i) => i.status === 'resolved' && !i.confidential && !i.my_vote],
    ['active', 'Being worked on', (i) => ['open', 'acknowledged', 'in_progress', 'reopened'].includes(i.status) || (i.status === 'resolved' && (i.my_vote || i.confidential))],
    ['done', 'Finished', (i) => ['closed', 'rejected'].includes(i.status)],
  ]);
  return (
    <section>
      <ErrorBox text={error} />
      {pending.length > 0 && (
        <div className="group">
          <h3>Needs your input ({pending.length})</h3>
          {pending.map((p) => <Clarify key={p.report_id} p={p} notify={notify} onDone={reload} />)}
        </div>
      )}
      {groups.map(([k, label, list]) => (
        <div className="group" key={k}>
          <h3>{label} ({list.length})</h3>
          {list.map((i) => <MyIssueCard key={i.id} i={i} notify={notify} onChange={reload} />)}
        </div>
      ))}
    </section>
  );
}

let locCache = null;
function Clarify({ p, notify, onDone }) {
  const [locs, setLocs] = useState(locCache);
  const [loc, setLoc] = useState('');
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!locs) get('/api/locations').then((l) => { locCache = l; setLocs(l); }).catch((e) => setError(e.message));
  }, [locs]);
  async function send() {
    try {
      await post(`/api/reports/${p.report_id}/clarify`, { location_id: Number(loc) });
      notify('Thanks. Routed to the right department.');
      onDone();
    } catch (e) { setError(e.message); }
  }
  return (
    <div className="card">
      <p className="quote">{p.text}</p>
      <p className="warn">{p.items[0]?.why} It is not routed until you pick a real place.</p>
      <div className="row">
        <select value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Pick the place">
          <option value="">Where is this?</option>
          {(locs || []).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.building})</option>)}
        </select>
        <button className="btn primary" disabled={!loc} onClick={send}>Send location</button>
      </div>
      <ErrorBox text={error} />
    </div>
  );
}

function MyIssueCard({ i, notify, onChange }) {
  const [error, setError] = useState(null);
  async function vote(verdict) {
    try {
      const r = await post(`/api/issues/${i.id}/vote`, { verdict });
      notify(r.status === 'reopened' ? 'Issue reopened: back on the department queue.' : r.status === 'closed' ? 'Fix confirmed. Issue closed.' : 'Vote recorded.');
      onChange();
    } catch (e) { setError(e.message); }
  }
  if (i.confidential) {
    return (
      <div className="card">
        <div className="card-head"><strong>{i.title}</strong><StatusChip status={i.status} /></div>
        <p className="muted">Only the admin can see this. Your name is hidden from everyone.</p>
        <Photos ids={i.my_photos} label="Your photos" />
        <Timeline items={i.timeline} />
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-head"><strong>{i.title}</strong><StatusChip status={i.status} /></div>
      <p>{i.reason}</p>
      <p className="muted">{i.department} - <SeverityChip severity={i.severity} /> priority {i.priority} - {i.affected_count} affected{i.reopen_count ? ` - reopened ${i.reopen_count}x` : ''}{i.verified_severity ? ' - severity verified by admin' : ''}</p>
      <Photos ids={i.my_photos} label="Your photos" />
      {i.status === 'resolved' && !i.my_vote && (
        <div className="row">
          <span>Is it actually fixed?</span>
          <button className="btn primary" onClick={() => vote('confirm')}>Yes, it is fixed</button>
          <button className="btn" onClick={() => vote('dispute')}>No, still broken</button>
        </div>
      )}
      {i.my_vote && <p className="muted">You voted: {i.my_vote}.</p>}
      <ErrorBox text={error} />
      <PriorityWhy b={i.priority_breakdown} />
      <Timeline items={i.timeline} />
    </div>
  );
}

export function Board({ notify, goReport, readOnly = false }) {
  const { data, error, loading, reload } = usePoll(async () => ({ board: await get('/api/board'), trending: await get('/api/trending') }));
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox text={error} />;
  const { board, trending } = data;
  if (!board.length) return readOnly ? <Empty text="No public issues yet." /> : <Empty text="No issues reported yet." action="Report the first one" onAction={goReport} />;
  const groups = groupBy(board, [
    ['open', 'Open', (i) => ['open', 'acknowledged', 'reopened'].includes(i.status)],
    ['work', 'In progress', (i) => i.status === 'in_progress'],
    ['resolved', 'Resolved - awaiting affected students', (i) => i.status === 'resolved'],
    ['closed', 'Closed', (i) => i.status === 'closed'],
  ]);
  return (
    <section>
      <ErrorBox text={error} />
      {trending.length > 0 && (
        <div className="group">
          <h3>Trending in the last hour</h3>
          {trending.map((i) => <p key={i.id} className="trend"><strong>{i.title}</strong> - {i.recent_reports} new reports</p>)}
        </div>
      )}
      {groups.map(([k, label, list]) => (
        <div className="group" key={k}>
          <h3>{label} ({list.length})</h3>
          {list.map((i) => <BoardCard key={i.id} i={i} notify={notify} onChange={reload} readOnly={readOnly} />)}
        </div>
      ))}
    </section>
  );
}

function BoardCard({ i, notify, onChange, readOnly }) {
  const [error, setError] = useState(null);
  async function meToo() {
    try {
      const r = await post(`/api/issues/${i.id}/metoo`);
      notify(r.already ? 'You are already counted.' : 'Added. You can confirm or dispute the fix later.');
      onChange();
    } catch (e) { setError(e.message); }
  }
  const canJoin = !readOnly && !i.i_am_affected && !['closed', 'rejected'].includes(i.status);
  return (
    <div className="card">
      <div className="card-head"><strong>{i.title}</strong><StatusChip status={i.status} /></div>
      <p>{i.reason}</p>
      <p className="muted">{i.department} - <SeverityChip severity={i.severity} /> priority {i.priority} - {i.affected_count} affected</p>
      <div className="row">
        {canJoin ? <button className="btn" onClick={meToo}>Me too</button> : <span className="muted">{i.i_am_affected ? 'You are affected by this.' : ''}</span>}
      </div>
      <ErrorBox text={error} />
      <PriorityWhy b={i.priority_breakdown} />
    </div>
  );
}

function MyTrust() {
  const { data, error, loading } = usePoll(() => get('/api/me'), 5000);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox text={error} />;
  return (
    <section className="panel">
      <h3>Trust score: {data.trust_score}</h3>
      <p className="muted">Your vote and "me too" count {data.vote_weight}x {data.new_account ? '(new account: half weight for your first actions and first 10 minutes)' : ''}. Weight = trust / 50, between 0.2 and 2.0.</p>
      <h4>Why is my score {data.trust_score}?</h4>
      <TrustHistory events={data.trust_events} />
    </section>
  );
}
