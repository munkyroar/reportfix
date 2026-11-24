// Community layer: me-too, staff status changes, resolution voting, reopen/close, trust, brigading.
import { UserError, recomputePriority } from './pipeline.js';
import { addTrust, logStatus, addFlag, now } from './store.js';
import { personWeight, evaluateVotes, TRUST, ROUTE_TARGETS, NEW_ACCOUNT_MS } from './rules.js';

const OPENISH = ['open', 'acknowledged', 'in_progress', 'reopened', 'resolved'];

export function canManage(user, issue) {
  if (user.role === 'admin') return true;
  if (user.role === 'staff') return issue.confidential === 0 && issue.department === user.department;
  return false;
}

function getIssue(db, id) {
  const issue = db.prepare('SELECT * FROM issues WHERE id=?').get(id);
  if (!issue) throw new UserError('Not found', 404);
  return issue;
}

export function meToo(db, user, issueId) {
  if (user.role !== 'student') throw new UserError('Only students can add "me too".', 403);
  const issue = getIssue(db, issueId);
  if (issue.confidential) throw new UserError('Not found', 404);
  if (!OPENISH.includes(issue.status)) throw new UserError('This issue is no longer open.', 409);
  const r = db.prepare('INSERT OR IGNORE INTO issue_members (issue_id, user_id, report_id, joined_at) VALUES (?,?,NULL,?)').run(issueId, user.id, now());
  if (!r.changes) return { already: true, priority: issue.priority_score };
  db.prepare('UPDATE users SET action_count = action_count + 1 WHERE id=?').run(user.id);
  logStatus(db, issueId, issue.status, issue.status, null, 'Another student said "me too".');
  const pr = recomputePriority(db, issueId);
  return { already: false, priority: pr.total };
}

const TRANSITIONS = {
  open: ['acknowledged', 'in_progress', 'resolved', 'rejected'],
  acknowledged: ['in_progress', 'resolved', 'rejected'],
  in_progress: ['resolved', 'rejected'],
  reopened: ['acknowledged', 'in_progress', 'resolved', 'rejected'],
  resolved: [],
  closed: [],
  rejected: [],
};

export function changeStatus(db, user, issueId, to, note) {
  const issue = getIssue(db, issueId);
  if (!canManage(user, issue)) throw new UserError('Forbidden', 403);
  if (!(TRANSITIONS[issue.status] || []).includes(to)) throw new UserError(`Cannot move from ${issue.status} to ${to}.`, 409);
  if (to === 'rejected' && (!note || note.trim().length < 3)) throw new UserError('Give a reason when rejecting a report.');
  db.prepare('UPDATE issues SET status=?, updated_at=?, resolved_at=? WHERE id=?').run(to, now(), to === 'resolved' ? now() : null, issueId);
  logStatus(db, issueId, issue.status, to, user.id, note || defaultNote(to));
  if (to === 'rejected') {
    const reporters = db.prepare('SELECT DISTINCT user_id FROM issue_members WHERE issue_id=? AND report_id IS NOT NULL').all(issueId);
    for (const r of reporters) addTrust(db, r.user_id, TRUST.SPAM, `Report on issue #${issueId} was rejected as spam/fake by staff: "${note.trim().slice(0, 80)}".`, issueId);
  }
  return db.prepare('SELECT * FROM issues WHERE id=?').get(issueId);
}

function defaultNote(to) {
  return { acknowledged: 'Department has seen this.', in_progress: 'Work has started.', resolved: 'Marked resolved. Affected students: please confirm or dispute.' }[to] || null;
}

export function reroute(db, user, issueId, department, reason) {
  const issue = getIssue(db, issueId);
  if (!canManage(user, issue)) throw new UserError('Forbidden', 403);
  if (issue.confidential) throw new UserError('Confidential reports cannot be re-routed to a department.', 409);
  if (!ROUTE_TARGETS.includes(department)) throw new UserError('Unknown department.');
  if (department === issue.department) throw new UserError('Already in that department.', 409);
  if (['closed', 'rejected'].includes(issue.status)) throw new UserError('This issue is finished.', 409);
  db.prepare('UPDATE issues SET department=?, updated_at=? WHERE id=?').run(department, now(), issueId);
  logStatus(db, issueId, issue.status, issue.status, user.id, `Re-routed from ${issue.department} to ${department}: ${reason.trim()}`);
  return db.prepare('SELECT * FROM issues WHERE id=?').get(issueId);
}

export const BRIGADE_MIN = 3;
export const BRIGADE_WINDOW_MS = 5 * 60 * 1000;
export const BRIGADE_WEIGHT = 0.1;

export function vote(db, user, issueId, verdict) {
  const issue = getIssue(db, issueId);
  if (issue.confidential) throw new UserError('Not found', 404);
  if (user.role !== 'student') throw new UserError('Only affected students can vote.', 403);
  const member = db.prepare('SELECT 1 FROM issue_members WHERE issue_id=? AND user_id=?').get(issueId, user.id);
  if (!member) throw new UserError('Only students affected by this issue can vote.', 403);
  if (issue.status !== 'resolved') throw new UserError('Voting opens when the issue is marked resolved.', 409);

  const round = issue.reopen_count;
  const weight = personWeight(user);
  try {
    db.prepare('INSERT INTO votes (issue_id, user_id, round, verdict, weight_at_vote, created_at) VALUES (?,?,?,?,?,?)')
      .run(issueId, user.id, round, verdict, weight, now());
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) throw new UserError('You already voted on this fix.', 409);
    throw e;
  }
  db.prepare('UPDATE users SET action_count = action_count + 1 WHERE id=?').run(user.id);
  logStatus(db, issueId, 'resolved', 'resolved', null, `An affected student voted to ${verdict} the fix (weight ${weight}).`);

  detectBrigading(db, issueId, round);
  return settle(db, issueId, round);
}

// >= 3 accounts younger than 10 minutes voting the same way within 5 minutes -> weight 0.1 + admin flag
export function detectBrigading(db, issueId, round) {
  const rows = db.prepare(`SELECT v.id, v.verdict, v.created_at, u.created_at AS ucreated FROM votes v JOIN users u ON u.id=v.user_id
    WHERE v.issue_id=? AND v.round=?`).all(issueId, round);
  for (const verdict of ['confirm', 'dispute']) {
    const young = rows.filter((r) => r.verdict === verdict && r.created_at - r.ucreated < NEW_ACCOUNT_MS).sort((a, b) => a.created_at - b.created_at);
    for (let i = 0; i < young.length; i++) {
      const windowVotes = young.filter((r) => r.created_at >= young[i].created_at && r.created_at - young[i].created_at <= BRIGADE_WINDOW_MS);
      if (windowVotes.length >= BRIGADE_MIN) {
        const upd = db.prepare('UPDATE votes SET weight_at_vote=?, discounted=1 WHERE id=? AND discounted=0');
        let changed = 0;
        for (const v of windowVotes) changed += upd.run(BRIGADE_WEIGHT, v.id).changes;
        if (changed) {
          addFlag(db, { kind: 'brigading', issue_id: issueId, detail: `${windowVotes.length} accounts younger than 10 minutes voted "${verdict}" within 5 minutes on issue #${issueId}. Their votes now count ${BRIGADE_WEIGHT} each.` });
          logStatus(db, issueId, 'resolved', 'resolved', null, `Brigading detected: ${windowVotes.length} brand-new accounts voted together; their votes were discounted.`);
        }
        break;
      }
    }
  }
}

function settle(db, issueId, round) {
  const votes = db.prepare('SELECT * FROM votes WHERE issue_id=? AND round=?').all(issueId, round);
  const members = db.prepare('SELECT COUNT(*) c FROM issue_members WHERE issue_id=?').get(issueId).c;
  const ev = evaluateVotes(votes, members);
  if (ev.outcome === 'reopen') {
    db.prepare(`UPDATE issues SET status='reopened', reopen_count=reopen_count+1, resolved_at=NULL, updated_at=? WHERE id=?`).run(now(), issueId);
    logStatus(db, issueId, 'resolved', 'reopened', null, `Reopened by affected students: dispute weight ${ev.dispute_weight} from ${ev.disputers} people vs confirm weight ${ev.confirm_weight}. Back on the department queue.`);
    applyVoteTrust(db, issueId, votes, 'dispute', 'reopened');
  } else if (ev.outcome === 'close') {
    db.prepare(`UPDATE issues SET status='closed', updated_at=? WHERE id=?`).run(now(), issueId);
    logStatus(db, issueId, 'resolved', 'closed', null, `Closed: fix confirmed by affected students (confirm weight ${ev.confirm_weight}, dispute weight ${ev.dispute_weight}).`);
    applyVoteTrust(db, issueId, votes, 'confirm', 'closed');
    const reporters = db.prepare('SELECT DISTINCT user_id FROM issue_members WHERE issue_id=? AND report_id IS NOT NULL').all(issueId);
    for (const r of reporters) addTrust(db, r.user_id, TRUST.CONFIRMED_FIX, `Your report led to a confirmed fix (issue #${issueId}).`, issueId);
  }
  recomputePriority(db, issueId);
  return { outcome: ev.outcome, tally: ev, status: db.prepare('SELECT status FROM issues WHERE id=?').get(issueId).status };
}

function applyVoteTrust(db, issueId, votes, winning, outcome) {
  for (const v of votes) {
    if (v.verdict === winning) addTrust(db, v.user_id, TRUST.VOTE_MATCH, `Your "${v.verdict}" vote on issue #${issueId} matched the outcome (${outcome}).`, issueId);
    else addTrust(db, v.user_id, TRUST.VOTE_MISMATCH, `Your "${v.verdict}" vote on issue #${issueId} went against the outcome (${outcome}).`, issueId);
  }
}
