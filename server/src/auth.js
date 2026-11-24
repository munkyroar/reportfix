// Real authentication: scrypt password hashes, opaque server-side sessions in an HttpOnly cookie.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;
export const SESSION_COOKIE = 'rf_session';
export const SESSION_TTL_MS = 8 * 3600 * 1000;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(password.normalize('NFKC'), salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${dk.toString('base64')}`;
}
export function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(password.normalize('NFKC'), salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${dk.toString('base64')}`;
}

// a fixed dummy hash so unknown usernames cost the same time as wrong passwords
const DUMMY = hashPasswordSync(crypto.randomBytes(12).toString('hex'));

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored || DUMMY).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const dk = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(dk, expected) && !!stored;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(sha256(token), userId, t, t + SESSION_TTL_MS);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  return token;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
}

export function userFromToken(db, token) {
  if (!token || token.length > 100) return null;
  const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash=?').get(sha256(token));
  if (!s || s.expires_at < Date.now()) return null;
  return db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id) || null;
}

export function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function destroyAllSessions(db, userId, exceptToken = null) {
  if (exceptToken) db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash != ?').run(userId, sha256(exceptToken));
  else db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}

// ---------- one-time tokens (password reset codes, pending 2FA logins) ----------
export function issueToken(db, userId, kind, ttlMs, token = crypto.randomBytes(32).toString('base64url')) {
  db.prepare('DELETE FROM auth_tokens WHERE (user_id=? AND kind=?) OR expires_at < ?').run(userId, kind, Date.now());
  db.prepare('INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at) VALUES (?,?,?,?)').run(sha256(token), userId, kind, Date.now() + ttlMs);
  return token;
}
// returns user_id or null; burns the token after maxAttempts wrong second-factor tries
export function peekToken(db, token, kind) {
  if (!token || token.length > 100) return null;
  const t = db.prepare('SELECT * FROM auth_tokens WHERE token_hash=? AND kind=?').get(sha256(token), kind);
  if (!t || t.expires_at < Date.now()) return null;
  return t;
}
export function burnToken(db, token) {
  db.prepare('DELETE FROM auth_tokens WHERE token_hash=?').run(sha256(token));
}
export function failToken(db, token, maxAttempts = 5) {
  db.prepare('UPDATE auth_tokens SET attempts = attempts + 1 WHERE token_hash=?').run(sha256(token));
  db.prepare('DELETE FROM auth_tokens WHERE token_hash=? AND attempts >= ?').run(sha256(token), maxAttempts);
}
// human-typeable reset code: 4 groups of 4 from an unambiguous alphabet (~80 bits)
export function newResetCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += A[bytes[i] % A.length] + (i % 4 === 3 && i < 15 ? '-' : '');
  return s;
}
export const normaliseCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');

// ---------- TOTP (RFC 6238: SHA-1, 30 s, 6 digits) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function newTotpSecret() { return base32Encode(crypto.randomBytes(20)); }
export function totpAt(secretB32, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}
export const currentStep = (t = Date.now()) => Math.floor(t / 30000);
// accepts +-1 step of clock drift; returns the matched step (for replay protection) or 0
export function verifyTotp(secretB32, code, lastStep = 0, now = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secretB32) return 0;
  const s = currentStep(now);
  for (const step of [s - 1, s, s + 1]) {
    if (step <= lastStep) continue; // a code can be used once
    if (crypto.timingSafeEqual(Buffer.from(totpAt(secretB32, step)), Buffer.from(c))) return step;
  }
  return 0;
}

export function setSessionCookie(req, res, token) {
  const secure = req.secure || process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}
