// Text helpers: sanitising, normalising, tokenising, fuzzy compare.

export const MAX_RAW = 4000;   // hard reject above this (zod)
export const MAX_CLEAN = 1200; // what we keep and send to the AI

export function sanitise(raw) {
  let t = String(raw ?? '');
  t = t.normalize('NFKC');
  // drop script/style blocks entirely, then any remaining tags
  t = t.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');
  t = t.replace(/<[^>]*>/g, ' ');
  // remove any leftover angle brackets so nothing can close our <report> wrapper
  t = t.replace(/[<>]/g, ' ');
  // control chars and zero-width / bidi chars (used to hide injections)
  t = t.replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > MAX_CLEAN) t = t.slice(0, MAX_CLEAN);
  return t;
}

export function hasWords(t) {
  return /\p{L}{2,}/u.test(t);
}

// lower-case, split letters from digits ("lab3" -> "lab 3"), keep only letters/digits
export function normalise(t) {
  return String(t ?? '')
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(t) {
  const n = normalise(t);
  return n ? n.split(' ') : [];
}

export function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// fuzzy token equality: numbers must match exactly; short words exactly; longer words allow typos
export function tokEq(a, b) {
  if (a === b) return true;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return false;
  const len = Math.min(a.length, b.length);
  if (len < 6) return false;
  const d = lev(a, b);
  return len >= 10 ? d <= 2 : d <= 1;
}

// does phrase (array of tokens) occur contiguously in toks (fuzzy)?
export function phraseIn(toks, phrase) {
  if (!phrase.length || phrase.length > toks.length) return false;
  outer: for (let i = 0; i + phrase.length <= toks.length; i++) {
    for (let j = 0; j < phrase.length; j++) {
      if (!tokEq(toks[i + j], phrase[j])) continue outer;
    }
    return true;
  }
  return false;
}

export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
