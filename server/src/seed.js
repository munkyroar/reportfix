import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wipe } from './db.js';
import crypto from 'node:crypto';
import { addTrust, logStatus } from './store.js';
import { hashPasswordSync } from './auth.js';
import { recomputePriority } from './pipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LOCATIONS = JSON.parse(fs.readFileSync(path.join(here, '..', 'seed', 'locations.json'), 'utf8'));

const DAY = 24 * 3600 * 1000;

// 2 students per scenario, 1 staff per department, 1 admin
const STUDENTS = [
  ['Ayesha Khan', 'duplicates', 'ayesha'], ['Bilal Ahmed', 'duplicates', 'bilal'],
  ['Hira Malik', 'hazard', 'hira'], ['Usman Tariq', 'hazard', 'usman'],
  ['Sana Iqbal', 'confidential', 'sana'], ['Hamza Raza', 'confidential', 'hamza'],
  ['Zainab Ali', 'voting', 'zainab'], ['Fahad Qureshi', 'voting', 'fahad'],
  ['Maryam Siddiqui', 'clarification', 'maryam'], ['Ali Hassan', 'clarification', 'ali'],
];
const STAFF = [['Engr. Kamran (EE)', 'EE', 'ee.staff'], ['Dr. Nadia (CSE)', 'CSE', 'cse.staff'], ['Mr. Imran (IS)', 'IS', 'is.staff'], ['Ms. Rubina (Library)', 'Library', 'library.staff'], ['Mr. Aslam (Cafeteria)', 'Cafeteria', 'cafeteria.staff'], ['Mr. Tariq (Labs)', 'Labs', 'labs.staff']];

// Unique random password per seeded account. Kept stable across resets via a gitignored file (never in the DB as plaintext).
function loadCredentials(file) {
  const creds = {};
  if (file && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^(\S+)\s+(\S+)\s+(\S+)$/);
      if (m && m[1] !== 'username') creds[m[1]] = m[3];
    }
  }
  return creds;
}
function newPassword() {
  return crypto.randomBytes(9).toString('base64url');
}

export function seed(db, { withSamples = true, credentialsFile = null } = {}) {
  const creds = loadCredentials(credentialsFile);
  const allAccounts = [...STUDENTS.map((s) => [s[2], 'student']), ...STAFF.map((s) => [s[2], 'staff']), ['admin', 'admin']];
  for (const [u] of allAccounts) if (!creds[u]) creds[u] = newPassword();
  const hashes = Object.fromEntries(allAccounts.map(([u]) => [u, hashPasswordSync(creds[u])]));
  const tx = db.transaction(() => {
    wipe(db);
    const insLoc = db.prepare('INSERT INTO locations (id, name, building, kind, aliases) VALUES (?,?,?,?,?)');
    for (const l of LOCATIONS) insLoc.run(l.id, l.name, l.building, l.kind, JSON.stringify(l.aliases));

    const old = Date.now() - 30 * DAY;
    const insUser = db.prepare('INSERT INTO users (name, username, password_hash, role, department, trust_score, is_new, action_count, created_at) VALUES (?,?,?,?,?,?,0,5,?)');
    const ids = {};
    for (const [name, scenario, u] of STUDENTS) ids[name] = { id: Number(insUser.run(name, u, hashes[u], 'student', null, 50, old).lastInsertRowid), scenario };
    for (const [name, dept, u] of STAFF) insUser.run(name, u, hashes[u], 'staff', dept, 50, old);
    insUser.run('Admin Office', 'admin', hashes.admin, 'admin', null, 50, old);

    if (withSamples) {
      const sample = (userName, loc, type, dept, sev, status, text, reason) => {
        const u = ids[userName].id;
        const t = Date.now() - 2 * 3600 * 1000;
        const rep = db.prepare(`INSERT INTO reports (user_id, raw_text, clean_text, ai_json, location_id, problem_type, status, created_at) VALUES (?,?,?,?,?,?,?,?)`)
          .run(u, text, text, JSON.stringify({ seeded: true }), loc, type, 'submitted', t).lastInsertRowid;
        const locRow = LOCATIONS.find((l) => l.id === loc);
        const id = db.prepare(`INSERT INTO issues (location_id, problem_type, department, severity, base_severity, hazard, priority_score, status, confidential, title, reason, sample_text, created_at, updated_at, resolved_at)
          VALUES (?,?,?,?,?,'none',0,?,0,?,?,?,?,?,?)`).run(loc, type, dept, sev, { High: 60, Medium: 30, Low: 10 }[sev], status,
          `${type === 'ac' ? 'AC' : type === 'wifi' ? 'WiFi' : type[0].toUpperCase() + type.slice(1)} - ${locRow.name}`, reason, text, t, t, status === 'resolved' ? Date.now() : null).lastInsertRowid;
        db.prepare('INSERT INTO issue_members (issue_id, user_id, report_id, joined_at) VALUES (?,?,?,?)').run(id, u, rep, t);
        logStatus(db, id, null, 'open', null, `Seeded sample: routed to ${dept}.`);
        return Number(id);
      };
      sample('Ayesha Khan', 6, 'ac', 'Library', 'Medium', 'open', 'Library ka AC kaam nahi kar raha, bohat garmi hai', 'Library air conditioning not working.');
      sample('Ali Hassan', 7, 'food', 'Cafeteria', 'Low', 'open', 'Chai in the cafe is always cold', 'Cafeteria tea served cold.');
      const v = sample('Zainab Ali', 2, 'wifi', 'IS', 'Medium', 'resolved', 'WiFi in lab 2 keeps disconnecting', 'WiFi disconnecting in CSE Lab 2.');
      // second affected student so the voting scenario is ready to demo
      db.prepare('INSERT INTO issue_members (issue_id, user_id, report_id, joined_at) VALUES (?,?,NULL,?)').run(v, ids['Fahad Qureshi'].id, Date.now());
      logStatus(db, v, 'open', 'resolved', null, 'Seeded sample: IS marked this resolved. Affected students can confirm or dispute.');
      for (const id of db.prepare('SELECT id FROM issues').all().map((r) => r.id)) recomputePriority(db, id);
    }
    for (const u of db.prepare('SELECT id FROM users').all()) {
      db.prepare('INSERT INTO trust_events (user_id, delta, reason, ref_id, score_after, created_at) VALUES (?,?,?,?,?,?)').run(u.id, 0, 'Starting score for every account: 50.', null, 50, old);
    }
  });
  tx();
  if (credentialsFile) {
    const lines = ['username            role      password', ...allAccounts.map(([u, r]) => `${u.padEnd(19)} ${r.padEnd(9)} ${creds[u]}`)];
    fs.mkdirSync(path.dirname(credentialsFile), { recursive: true });
    fs.writeFileSync(credentialsFile, lines.join('\n') + '\n', { mode: 0o600 });
  }
  return creds;
}

export { addTrust };
