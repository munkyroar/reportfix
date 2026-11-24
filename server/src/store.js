// Small audit-log helpers shared by pipeline + routes.
export const now = () => Date.now();

export function addTrust(db, userId, delta, reason, refId = null) {
  const u = db.prepare('SELECT trust_score FROM users WHERE id=?').get(userId);
  if (!u) return;
  const after = Math.max(0, Math.min(100, Math.round((u.trust_score + delta) * 10) / 10));
  db.prepare('UPDATE users SET trust_score=? WHERE id=?').run(after, userId);
  db.prepare('INSERT INTO trust_events (user_id, delta, reason, ref_id, score_after, created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, delta, reason, refId, after, now());
}

export function logStatus(db, issueId, from, to, byUser, note) {
  db.prepare('INSERT INTO status_log (issue_id, from_status, to_status, by_user, note, created_at) VALUES (?,?,?,?,?,?)')
    .run(issueId, from, to, byUser, note || null, now());
}

export function addFlag(db, { kind, issue_id = null, report_id = null, user_id = null, detail }) {
  db.prepare('INSERT INTO admin_flags (kind, issue_id, report_id, user_id, detail, created_at) VALUES (?,?,?,?,?,?)')
    .run(kind, issue_id, report_id, user_id, detail, now());
}
