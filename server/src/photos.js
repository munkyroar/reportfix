// Photo evidence. Checklist #16: type + size limits, stored outside the web root under a random name,
// never executed, served only through an access-checked endpoint with a locked-down Content-Type.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS_PER_REPORT = 3;

// Decide the type from the bytes, never from the filename or the client's Content-Type.
export function sniff(buf) {
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

// JPEG: drop APP1..APP15 (EXIF/GPS/XMP) and COM segments; keep the image data. Throws on malformed files.
function stripJpeg(buf) {
  const out = [buf.slice(0, 2)];
  let p = 2;
  while (p < buf.length) {
    if (buf[p] !== 0xff) throw new Error('bad jpeg');
    const marker = buf[p + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { out.push(buf.slice(p, p + 2)); p += 2; continue; }
    if (marker === 0xd9) { out.push(buf.slice(p, p + 2)); return Buffer.concat(out); }
    if (p + 4 > buf.length) throw new Error('bad jpeg');
    const len = buf.readUInt16BE(p + 2);
    if (len < 2 || p + 2 + len > buf.length) throw new Error('bad jpeg');
    if (marker === 0xda) { out.push(buf.slice(p)); return Buffer.concat(out); } // start of scan: rest is image data
    const isMeta = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMeta) out.push(buf.slice(p, p + 2 + len));
    p += 2 + len;
  }
  throw new Error('bad jpeg');
}

// PNG: keep only image chunks, drop text/EXIF/time chunks; require IHDR first and IEND last.
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
function stripPng(buf) {
  const out = [buf.slice(0, 8)];
  let p = 8, first = true, ended = false;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.slice(p + 4, p + 8).toString('latin1');
    if (p + 12 + len > buf.length) throw new Error('bad png');
    if (first && type !== 'IHDR') throw new Error('bad png');
    first = false;
    if (!PNG_DROP.has(type)) out.push(buf.slice(p, p + 12 + len));
    p += 12 + len;
    if (type === 'IEND') { ended = true; break; }
  }
  if (!ended) throw new Error('bad png');
  return Buffer.concat(out);
}

export function cleanImage(buf) {
  const mime = sniff(buf);
  if (!mime) return null;
  try {
    return { mime, data: mime === 'image/jpeg' ? stripJpeg(buf) : stripPng(buf) };
  } catch {
    return null;
  }
}

export function savePhoto(db, dir, { reportId, userId, mime, data }) {
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${crypto.randomBytes(16).toString('hex')}${mime === 'image/png' ? '.png' : '.jpg'}`;
  fs.writeFileSync(path.join(dir, fileName), data, { flag: 'wx', mode: 0o600 });
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  return Number(db.prepare('INSERT INTO photos (report_id, user_id, file_name, mime, bytes, sha256, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(reportId, userId, fileName, mime, data.length, sha, Date.now()).lastInsertRowid);
}

// Who may see a photo: admin; the student who took it; staff of a department that owns a PUBLIC issue it belongs to.
// Confidential evidence: admin + uploader only.
export function canViewPhoto(db, user, photo) {
  if (user.role === 'admin') return true;
  if (user.id === photo.user_id) return true;
  if (user.role === 'staff') {
    return !!db.prepare(`SELECT 1 FROM issue_members m JOIN issues i ON i.id=m.issue_id
      WHERE m.report_id=? AND i.confidential=0 AND i.department=? LIMIT 1`).get(photo.report_id, user.department);
  }
  return false;
}

// photo ids attached to an issue (through the reports that joined it)
export function photosForIssue(db, issueId) {
  return db.prepare(`SELECT p.id FROM photos p JOIN issue_members m ON m.report_id=p.report_id WHERE m.issue_id=? ORDER BY p.id`).all(issueId).map((r) => r.id);
}

export function clearUploads(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (/^[0-9a-f]{32}\.(jpg|png)$/.test(f)) fs.unlinkSync(path.join(dir, f));
}
