// Builds the admin Excel export. Confidential reports are NEVER linked to a student anywhere in the file:
// they are excluded from the student sheets (filtered in SQL) and listed only anonymously on their own sheet.
import { buildXlsx } from './xlsx.js';
import { personWeight } from './rules.js';
import { labelType } from './pipeline.js';

const d = (ms) => (ms ? new Date(ms) : null);
const STATUS = { open: 'Open', acknowledged: 'Acknowledged', in_progress: 'In progress', resolved: 'Resolved (awaiting students)', reopened: 'Reopened', closed: 'Closed (fix confirmed)', rejected: 'Rejected' };
const REPORT_STATUS = { submitted: 'Routed', needs_clarification: 'Waiting for location', partially_routed: 'Partly routed', processing: 'Processing' };

export function buildExport(db) {
  const problems = db.prepare(`
    SELECT i.*, l.name AS location, l.building,
      (SELECT COUNT(*) FROM issue_members m WHERE m.issue_id=i.id) AS affected
    FROM issues i LEFT JOIN locations l ON l.id=i.location_id
    WHERE i.confidential=0 ORDER BY i.priority_score DESC, i.id`).all();

  const reports = db.prepare(`
    SELECT r.id, r.created_at, r.status, r.clean_text, r.problem_type, r.fallback_used, r.injection_flag,
      u.name AS student, u.username, l.name AS location, l.building,
      (SELECT GROUP_CONCAT(m.issue_id, ', ') FROM issue_members m WHERE m.report_id=r.id) AS issue_ids,
      (SELECT GROUP_CONCAT(DISTINCT i.department) FROM issue_members m JOIN issues i ON i.id=m.issue_id WHERE m.report_id=r.id) AS departments
    FROM reports r JOIN users u ON u.id=r.user_id LEFT JOIN locations l ON l.id=r.location_id
    WHERE r.confidential=0 ORDER BY r.id`).all();

  const students = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM reports r WHERE r.user_id=u.id AND r.confidential=0) AS reports,
      (SELECT COUNT(*) FROM issue_members m JOIN issues i ON i.id=m.issue_id WHERE m.user_id=u.id AND i.confidential=0) AS issues_joined,
      (SELECT COUNT(*) FROM votes v WHERE v.user_id=u.id) AS votes
    FROM users u WHERE u.role='student' ORDER BY u.name`).all();

  const locations = db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM issues i WHERE i.location_id=l.id AND i.confidential=0) AS total,
      (SELECT COUNT(*) FROM issues i WHERE i.location_id=l.id AND i.confidential=0 AND i.status IN ('open','acknowledged','in_progress','reopened','resolved')) AS open,
      (SELECT COUNT(*) FROM issues i WHERE i.location_id=l.id AND i.confidential=0 AND i.severity='Critical' AND i.status NOT IN ('closed','rejected')) AS critical,
      (SELECT COUNT(DISTINCT m.user_id) FROM issues i JOIN issue_members m ON m.issue_id=i.id WHERE i.location_id=l.id AND i.confidential=0) AS affected,
      (SELECT i.problem_type FROM issues i WHERE i.location_id=l.id AND i.confidential=0 GROUP BY i.problem_type ORDER BY COUNT(*) DESC LIMIT 1) AS top_type
    FROM locations l ORDER BY total DESC, l.name`).all();

  const confidential = db.prepare(`
    SELECT i.id, i.severity, i.hazard, i.status, i.reason, i.created_at, i.updated_at, l.name AS location
    FROM issues i LEFT JOIN locations l ON l.id=i.location_id WHERE i.confidential=1 ORDER BY i.priority_score DESC, i.id`).all();

  const sheets = [
    {
      name: 'Reported problems',
      columns: [
        { header: 'Issue ID', width: 9 }, { header: 'Problem', width: 28 }, { header: 'Type', width: 14 },
        { header: 'Location', width: 18 }, { header: 'Building', width: 16 }, { header: 'Department', width: 12 },
        { header: 'Severity', width: 10 }, { header: 'Hazard', width: 11 }, { header: 'Priority', width: 9 },
        { header: 'Status', width: 24 }, { header: 'Students affected', width: 10 }, { header: 'Times reopened', width: 10 },
        { header: 'Reported at', width: 17 }, { header: 'Last update', width: 17 }, { header: 'Resolved at', width: 17 },
        { header: 'Why (AI reason)', width: 48, wrap: true },
      ],
      rows: problems.map((i) => [
        i.id, i.title, labelType(i.problem_type), i.location || 'Unknown', i.building || '', i.department,
        i.severity, i.hazard === 'none' ? '' : i.hazard, i.priority_score, STATUS[i.status] || i.status,
        i.affected, i.reopen_count, d(i.created_at), d(i.updated_at), d(i.resolved_at), i.reason,
      ]),
    },
    {
      name: 'Reports by student',
      columns: [
        { header: 'Report ID', width: 9 }, { header: 'Submitted at', width: 17 }, { header: 'Student', width: 20 },
        { header: 'Username', width: 16 }, { header: 'Location', width: 18 }, { header: 'Building', width: 16 },
        { header: 'Problem type', width: 14 }, { header: 'Report status', width: 18 }, { header: 'Issue ID(s)', width: 11 },
        { header: 'Routed to', width: 14 }, { header: 'Triaged by', width: 14 }, { header: 'Injection attempt', width: 10 },
        { header: 'What the student wrote', width: 60, wrap: true },
      ],
      rows: reports.map((r) => [
        r.id, d(r.created_at), r.student, r.username, r.location || '(not given yet)', r.building || '',
        r.problem_type ? labelType(r.problem_type) : '', REPORT_STATUS[r.status] || r.status, r.issue_ids || '',
        r.departments || '', r.fallback_used ? 'Backup classifier' : 'AI', r.injection_flag ? 'Yes' : '', r.clean_text,
      ]),
    },
    {
      name: 'Students',
      columns: [
        { header: 'Student', width: 22 }, { header: 'Username', width: 16 }, { header: 'Trust score', width: 10 },
        { header: 'Vote weight', width: 10 }, { header: 'Reports', width: 9 }, { header: 'Issues affected by', width: 10 },
        { header: 'Votes cast', width: 9 }, { header: '2FA', width: 6 }, { header: 'Joined', width: 17 },
      ],
      rows: students.map((u) => [
        u.name, u.username, u.trust_score, personWeight(u), u.reports, u.issues_joined, u.votes, u.mfa_enabled ? 'On' : 'Off', d(u.created_at),
      ]),
    },
    {
      name: 'Locations',
      columns: [
        { header: 'Location', width: 20 }, { header: 'Building', width: 18 }, { header: 'Type', width: 12 },
        { header: 'Total issues', width: 10 }, { header: 'Open', width: 8 }, { header: 'Critical open', width: 10 },
        { header: 'Students affected', width: 10 }, { header: 'Most common problem', width: 18 },
      ],
      rows: locations.map((l) => [
        l.name, l.building, l.kind.replace('_', ' '), l.total, l.open, l.critical, l.affected, l.top_type ? labelType(l.top_type) : '',
      ]),
    },
    {
      name: 'Confidential (anonymous)',
      columns: [
        { header: 'Case ID', width: 9 }, { header: 'Reporter', width: 18 }, { header: 'Severity', width: 10 },
        { header: 'Someone hurt', width: 10 }, { header: 'Status', width: 24 }, { header: 'Place', width: 18 },
        { header: 'Reported at', width: 17 }, { header: 'Last update', width: 17 }, { header: 'Summary', width: 50, wrap: true },
      ],
      rows: confidential.map((c) => [
        c.id, 'Anonymous student', c.severity, c.hazard === 'medical' ? 'Yes' : '', STATUS[c.status] || c.status,
        c.location || 'Not given', d(c.created_at), d(c.updated_at), c.reason,
      ]),
    },
  ];
  return { buffer: buildXlsx(sheets), counts: { problems: problems.length, reports: reports.length, students: students.length, confidential: confidential.length } };
}
