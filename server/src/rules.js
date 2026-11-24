// "Code decides": every decision lives here, never in the AI.
import { normalise, tokens, phraseIn, tokEq } from './text.js';

export const DEPARTMENTS = ['EE', 'CSE', 'IS', 'Library', 'Cafeteria', 'Labs'];
export const ROUTE_TARGETS = [...DEPARTMENTS, 'Admin'];
export const HAZARDS = ['none', 'fire', 'sparks', 'gas', 'medical', 'structural', 'electrical'];
export const PROBLEM_TYPES = [
  'projector', 'computer', 'software', 'lab_network', 'wifi', 'portal',
  'electrical', 'power_outage', 'generator', 'lighting', 'fan', 'ac',
  'furniture', 'seating', 'books', 'noise', 'cleanliness', 'food', 'hygiene', 'prices',
  'water', 'plumbing', 'lab_equipment', 'harassment', 'other',
];
export const LANGUAGES = ['english', 'roman_urdu', 'mixed', 'urdu', 'other'];

// ---------- keyword safety nets (EN + Roman Urdu) ----------
// Each entry: [hazard, array of phrases]. Phrases are matched on normalised tokens (typo tolerant for long words).
const HAZARD_KEYWORDS = [
  ['fire', ['fire', 'aag', 'aagg', 'flames', 'flame', 'burning', 'burning smell', 'smoke', 'smoking socket', 'dhuan', 'dhuwan', 'dhoan', 'dhuaan','burnt smell', 'smell of burning', 'melting', 'pighal', 'aag lag', 'aag lagi', 'jalne ki', 'jalnay ki', 'jalne ki boo', 'jalne ki bu']],
  ['sparks', ['sparks', 'spark', 'sparking', 'chingari', 'chingariyan', 'chingaari', 'sparkin']],
  ['gas', ['gas leak', 'gas smell', 'smell of gas', 'gas ki boo', 'gas ki bu', 'gas leak ho', 'gas nikal']],
  ['electrical', ['current lag', 'current lagta', 'current lagaa', 'current laga', 'shock', 'electric shock', 'bijli ka jhatka', 'jhatka', 'exposed wire', 'naked wire', 'open wire', 'nangi taar', 'live wire', 'wire nangi', 'short circuit', 'shortcircuit']],
  ['medical', ['behosh', 'bayhosh', 'behoshi', 'unconscious', 'fainted', 'passed out', 'khoon', 'bleeding', 'blood', 'injured', 'injury', 'zakhmi', 'hurt badly', 'not breathing', 'saans nahi', 'heart attack', 'seizure', 'broken arm', 'broken leg', 'chot lagi', 'choot lagi', 'sar phat', 'head injury']],
  ['structural', ['ceiling falling', 'ceiling fell', 'roof falling', 'chhat gir', 'chat gir', 'deewar gir', 'wall crack', 'crack in wall', 'collapsing', 'about to collapse', 'gir raha', 'gir rahi', 'gir sakti', 'gir sakta', 'stairs broken', 'railing broken']],
];

const HARASSMENT_KEYWORDS = [
  'ragging', 'rag', 'ragged', 'harass', 'harassed', 'harassment', 'harassing', 'tang karna', 'tang karte', 'tang kar', 'tang kiya', 'tang krte',
  'stalking', 'stalker', 'stalks', 'stalked', 'threat', 'threatened', 'threatening', 'dhamki', 'dhamkiyan', 'bully', 'bullying', 'bullied',
  'blackmail', 'blackmailing', 'molest', 'touched me', 'inappropriate touch', 'chhera', 'chhed', 'cheda', 'cheira', 'eve teasing',
  'abused me', 'beat me', 'beat him', 'beat her', 'mara mujhe', 'maar rahe', 'maara', 'peet rahe', 'pushed me', 'pushed him', 'pushed her', 'pushed a guy', 'pushed a student', 'dhakka diya', 'dhakka de', 'sexual', 'creep', 'following me', 'peecha kar', 'seniors tang',
];

// Injection / manipulation patterns. Matched on lower-cased raw-ish text (not tokens) so punctuation shapes count.
const INJECTION_PATTERNS = [
  /ignore\s+(all|any|the|every|previous|prior|above|your|these|those)?\s*(previous|prior|above|earlier)?\s*(rules?|instructions?|prompts?|guidelines?|directions?)/i,
  /disregard\s+(all|any|the|previous|prior|above|your)?\s*(rules?|instructions?|prompts?)/i,
  /forget\s+(all|your|the|previous)?\s*(rules?|instructions?)/i,
  /\byou\s+are\s+now\b/i,
  /\bact\s+as\s+(an?\s+)?(admin|administrator|system|developer)/i,
  /\b(system|assistant|developer)\s*(prompt)?\s*:/i,
  /\bnew\s+instructions?\b/i,
  /\boverride\b/i,
  /\b(mark|set|make|flag|classify|treat)\s+(this|it|me|the\s+report)?\s*(as\s+)?(critical|urgent|high|top)\s*(priority)?/i,
  /\bpriority\s*(=|:|to|should\s+be|must\s+be)\s*(critical|high|urgent|100|max)/i,
  /\b(route|send|forward|escalate|assign)\s+(this|it)?\s*(directly\s+)?to\s+(the\s+)?(admin|principal|director|rector|ceo|head)/i,
  /["']?(priority|department|hazard|severity|is_harassment|problem_type)["']?\s*:\s*["']?\w+/i,
  /<\/?\s*report\s*>/i,
  /\bjailbreak\b|\bDAN\s+mode\b|\bdeveloper\s+mode\b/i,
  // Roman Urdu
  /(rules?|hidayat|hidayaat|instructions?|qawaid)\s+(ko\s+)?(ignore|nazar\s*andaz|bhool)\s*(kar|kr|karo|kro|do|dein|jao)?/i,
  /(pichli|pichle|purani|sari|saari|tamam)\s+(hidayat|hidayaat|instructions?|rules?)/i,
  /\b(isko|isay|ise|is\s+ko|ye|yeh)\s+(critical|urgent|high\s+priority|top\s+priority)\s*(mark\s+)?(kar|kr|karo|kro|kardo|krdo|kar\s+do|kr\s+do|bana|banao)/i,
  /\bpriority\s+(high|critical|top|zyada)\s+(kar|kr|karo|kro|kardo|krdo|rakho|rakh)/i,
  /\b(tum|aap|ap)\s+(ab|abhi)\s+(admin|system)\s+(ho|hain|hai|bano)/i,
  /\badmin\s+(ko|k\s+paas|ke\s+pas|ke\s+paas)\s+(bhejo|bhej\s+do|send\s+karo|forward\s+karo|seedha)/i,
  /\bseedha\s+(admin|principal|director)/i,
];

function phrasesToTokens(list) {
  return list.map((p) => ({ phrase: p, toks: tokens(p) }));
}
const HAZARD_INDEX = HAZARD_KEYWORDS.map(([h, list]) => [h, phrasesToTokens(list)]);
const HARASS_INDEX = phrasesToTokens(HARASSMENT_KEYWORDS);

// Negation guard: "no fire", "not smoke", "koi aag nahi" shouldn't fire the hazard net... but we stay safe:
// only an explicit "no <word>" directly before the keyword is ignored.
function negatedAt(toks, i) {
  const prev = toks[i - 1];
  return prev === 'no' || prev === 'not' || prev === 'without';
}

function findPhrase(toks, phrase) {
  for (let i = 0; i + phrase.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++) {
      const a = toks[i + j], b = phrase[j];
      // hazard words are short; only allow typo tolerance for words >= 5 chars
      if (!(a === b || tokEq(a, b))) { ok = false; break; }
    }
    if (ok && !negatedAt(toks, i)) return true;
  }
  return false;
}

export function keywordHazards(text) {
  const toks = tokens(text);
  const found = [];
  for (const [h, list] of HAZARD_INDEX) {
    if (list.some((p) => findPhrase(toks, p.toks))) found.push(h);
  }
  return found;
}

export function keywordHarassment(text) {
  const toks = tokens(text);
  return HARASS_INDEX.some((p) => findPhrase(toks, p.toks));
}

export function detectInjection(text) {
  const hits = [];
  for (const re of INJECTION_PATTERNS) {
    const m = String(text).match(re);
    if (m) hits.push(m[0].slice(0, 60));
  }
  return hits;
}

// Remove clauses that carry an injection so words like "hazard fire" inside an instruction can't trip the safety net.
export function stripInjectedClauses(text) {
  return String(text).split(/[.!?;,\n{}]+/).filter((c) => !INJECTION_PATTERNS.some((re) => re.test(c))).join('. ');
}

// ---------- keyword problem-type classifier (fallback + safety net) ----------
const TYPE_KEYWORDS = {
  projector: ['projector', 'projecter', 'projectr', 'multimedia', 'beamer', 'screen projector'],
  computer: ['pc', 'pcs', 'computer', 'computers', 'system band', 'monitor', 'keyboard', 'mouse', 'cpu', 'desktop', 'laptop charging'],
  software: ['software', 'matlab', 'visual studio', 'vs code', 'license', 'installed', 'install', 'compiler', 'ide', 'python not'],
  lab_network: ['lan', 'ethernet', 'lab network', 'lab internet', 'network cable'],
  wifi: ['wifi', 'wi fi', 'wify', 'wireless', 'internet', 'net nahi', 'net slow', 'net band', 'net nai', 'signal', 'eduroam', 'net chal'],
  portal: ['portal', 'lms', 'qalam', 'cms', 'login nahi', 'website down', 'result portal', 'registration portal'],
  electrical: ['socket', 'switch board', 'switchboard', 'wiring', 'wire', 'wires', 'plug', 'electric', 'electrical', 'bijli ka', 'taar', 'short circuit', 'sparks', 'spark', 'chingari', 'current lag'],
  power_outage: ['light gayi', 'light chali', 'lights gone', 'bijli nahi', 'bijli gayi', 'power outage', 'power cut', 'no power', 'load shedding', 'loadshedding', 'electricity gone', 'no electricity', 'power off', 'power gone'],
  generator: ['generator', 'genset', 'ups', 'backup power'],
  lighting: ['light', 'lights', 'tube light', 'tubelight', 'bulb', 'bulbs', 'dark', 'andhera', 'lighting'],
  fan: ['fan', 'fans', 'pankha', 'pankhay', 'pankhe'],
  ac: ['ac', 'a c', 'air conditioner', 'air conditioning', 'aircon', 'cooling', 'thanda nahi', 'garmi', 'hot inside', 'too hot', 'heater'],
  furniture: ['chair', 'chairs', 'kursi', 'kursiyan', 'table', 'tables', 'desk', 'desks', 'bench', 'benches', 'door', 'darwaza', 'window', 'khirki', 'cupboard', 'whiteboard', 'white board', 'broken chair'],
  seating: ['seating', 'seats', 'seat', 'no place to sit', 'jagah nahi', 'baithne'],
  books: ['book', 'books', 'kitab', 'kitaab', 'kitabain', 'issue book', 'novel', 'journal'],
  noise: ['noise', 'noisy', 'shor', 'loud', 'shouting', 'talking loudly'],
  cleanliness: ['dirty', 'dirt', 'gand', 'ganda', 'gandi', 'kachra', 'garbage', 'trash', 'dustbin', 'cleaning', 'safai', 'dust', 'smell bad', 'badboo', 'bad smell', 'stinks', 'cockroach', 'rats', 'chuha', 'washroom', 'toilet', 'bathroom'],
  food: ['food', 'khana', 'khaana', 'chai', 'tea', 'samosa', 'biryani', 'paratha', 'roti', 'burger', 'fries', 'sandwich', 'coffee', 'cold food', 'thanda khana', 'stale', 'basi', 'taste'],
  hygiene: ['hygiene', 'unhygienic', 'hair in', 'baal', 'insect in', 'keera', 'fly in', 'makhi', 'food poisoning', 'expired', 'rotten', 'kharab khana', 'sick after eating'],
  prices: ['price', 'prices', 'expensive', 'mehenga', 'mehnga', 'overcharging', 'overcharge', 'rate', 'rates', 'paisay', 'costly'],
  water: ['water', 'pani', 'paani', 'cooler', 'water cooler', 'filter', 'drinking water'],
  plumbing: ['leak', 'leaking', 'leakage', 'tap', 'nalka', 'pipe', 'flush', 'drain', 'blocked drain', 'seepage', 'seelan'],
  lab_equipment: ['oscilloscope', 'multimeter', 'breadboard', 'equipment', 'apparatus', 'function generator', 'power supply', 'kit', 'microscope', 'soldering', 'trainer kit'],
  harassment: [],
  other: [],
};
const TYPE_INDEX = Object.entries(TYPE_KEYWORDS).map(([t, l]) => [t, phrasesToTokens(l)]);

export function keywordTypes(text) {
  const toks = tokens(text);
  const hits = [];
  for (const [t, list] of TYPE_INDEX) {
    for (const p of list) {
      if (findTypePhrase(toks, p.toks)) { hits.push(t); break; }
    }
  }
  return hits;
}
function findTypePhrase(toks, phrase) {
  for (let i = 0; i + phrase.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++) if (!tokEq(toks[i + j], phrase[j])) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

// pick the most specific type when several keyword hits overlap
const TYPE_SPECIFICITY = ['hygiene', 'projector', 'software', 'lab_network', 'portal', 'wifi', 'generator', 'power_outage', 'electrical',
  'lab_equipment', 'computer', 'ac', 'fan', 'lighting', 'books', 'seating', 'noise', 'prices', 'plumbing', 'water', 'cleanliness', 'food', 'furniture'];
export function bestType(hits) {
  for (const t of TYPE_SPECIFICITY) if (hits.includes(t)) return t;
  return 'other';
}

// When one keyword family implies another, collapse it so "sparks from socket" is ONE electrical issue, not two.
export function collapseTypes(hits) {
  const s = new Set(hits);
  if (s.has('hygiene')) s.delete('food');
  if (s.has('power_outage') || s.has('generator') || s.has('electrical')) s.delete('lighting');
  if (s.has('electrical') && s.has('power_outage')) s.delete('electrical');
  if (s.has('lab_network')) s.delete('wifi');
  if (s.has('seating')) s.delete('furniture');
  if (s.has('lab_equipment')) s.delete('electrical');
  if (s.has('projector')) { s.delete('computer'); s.delete('lighting'); }
  if (s.has('software')) s.delete('computer');
  if (s.has('water') && s.has('plumbing')) s.delete('water');
  if (s.has('ac') && s.has('fan')) s.delete('fan');
  return [...s];
}

// ---------- language guess (fallback) ----------
const ROMAN_URDU_WORDS = new Set(['hai', 'hy', 'hain', 'he', 'ha', 'nahi', 'nai', 'nhi', 'kharab', 'band', 'aur', 'bhi', 'mein', 'main', 'mai', 'ka', 'ki', 'ke', 'ko', 'se', 'raha', 'rahi', 'rhi', 'rha', 'kar', 'karo', 'kro', 'kya', 'yahan', 'wahan', 'bohat', 'bahut', 'bht', 'boht', 'chal', 'raha', 'gaya', 'gayi', 'hua', 'hui', 'ho', 'tha', 'thi', 'abhi', 'jaldi', 'please', 'yaar', 'pankha', 'pani', 'bijli', 'aag', 'kachra', 'garmi']);
export function guessLanguage(text) {
  const toks = tokens(text).filter((t) => /[a-z]/.test(t));
  if (!toks.length) return 'other';
  const ur = toks.filter((t) => ROMAN_URDU_WORDS.has(t)).length;
  const ratio = ur / toks.length;
  if (ratio > 0.35) return 'roman_urdu';
  if (ratio > 0.08) return 'mixed';
  return 'english';
}

// ---------- location matching against the whitelist ----------
const PLACE_WORDS = '(lab|labs|room|hall|block|lh|lt|class|classroom|hostel)';
const NUMBERED_PLACE = new RegExp(`\\b${PLACE_WORDS}\\s*(no\\s*)?(\\d+)\\b`, 'g');

export function buildLocationIndex(locations) {
  return locations.map((l) => {
    const phrases = [l.name, ...(l.aliases || [])].map((a) => tokens(a)).filter((t) => t.length);
    return { ...l, phrases };
  });
}

// Returns { location, score, fake: [] }
export function matchLocation(index, ...texts) {
  const all = [];
  const fake = [];
  for (const t of texts) {
    if (!t) continue;
    const toks = tokens(t);
    // numbered places must exist exactly ("lab 47" != "lab 4")
    const norm = toks.join(' ');
    for (const m of norm.matchAll(NUMBERED_PLACE)) {
      const phrase = `${m[1]} ${m[3]}`;
      const exists = index.some((l) => l.phrases.some((p) => p.join(' ') === phrase || p.join(' ').endsWith(' ' + phrase) || p.join(' ') === `${m[1]} ${m[3]}`));
      if (!exists) fake.push(phrase);
    }
    for (const l of index) {
      for (const p of l.phrases) {
        // single short words must match exactly ("around" must not become "ground")
        const hit = p.length === 1 && p[0].length < 7 ? toks.includes(p[0]) : phraseIn(toks, p);
        if (hit) all.push({ location: l, len: p.join(' ').length, words: p.length });
      }
    }
  }
  if (!all.length) return { location: null, fake };
  // most specific (longest) alias wins; ties between different locations = ambiguous
  all.sort((a, b) => b.words - a.words || b.len - a.len);
  const best = all[0];
  const rivals = all.filter((x) => x.location.id !== best.location.id && x.words === best.words && x.len === best.len);
  // a generic building match loses to a specific room inside it
  return { location: best.location, ambiguous: rivals.length > 0, fake };
}

// ---------- routing table (ROADMAP 3.4) ----------
export function route(problemType, location, hazard, aiDept) {
  const kind = location?.kind;
  const isCseLab = kind === 'cse_lab';
  const isLab = kind === 'lab';
  const inBuilding = (b) => location?.building === b;
  switch (problemType) {
    case 'harassment': return 'Confidential';
    case 'projector':
    case 'computer':
    case 'software':
      if (isLab) return 'Labs';
      if (kind === 'library') return 'Library';
      return 'CSE';
    case 'lab_network': return isCseLab || inBuilding('CSE Block') ? 'CSE' : 'IS';
    case 'wifi':
    case 'portal': return 'IS';
    case 'electrical':
    case 'power_outage':
    case 'generator':
    case 'lighting':
    case 'fan': return 'EE';
    case 'ac':
      if (kind === 'library') return 'Library';
      if (kind === 'cafeteria') return 'Cafeteria';
      if (isLab || isCseLab) return 'Labs';
      return 'EE';
    case 'books':
    case 'noise': return kind === 'library' || problemType === 'books' ? 'Library' : 'Admin';
    case 'seating':
    case 'furniture':
      if (kind === 'library') return 'Library';
      if (kind === 'cafeteria') return 'Cafeteria';
      if (isLab || isCseLab) return 'Labs';
      return 'Admin';
    case 'food':
    case 'hygiene':
    case 'prices': return 'Cafeteria';
    case 'cleanliness':
      if (kind === 'cafeteria') return 'Cafeteria';
      if (kind === 'library') return 'Library';
      if (isLab || isCseLab) return 'Labs';
      return 'Admin';
    case 'lab_equipment': return isCseLab ? 'CSE' : 'Labs';
    case 'water':
    case 'plumbing': return kind === 'cafeteria' ? 'Cafeteria' : 'Admin';
    default:
      if (['fire', 'sparks', 'electrical'].includes(hazard)) return 'EE';
      if (hazard === 'gas') return kind === 'cafeteria' ? 'Cafeteria' : 'Admin';
      if (hazard !== 'none') return 'Admin';
      return DEPARTMENTS.includes(aiDept) ? aiDept : 'Admin';
  }
}

// ---------- severity + priority (ROADMAP 5.3) ----------
export const TIER_BASE = { Critical: 100, High: 60, Medium: 30, Low: 10 };
const TIER_ORDER = ['Low', 'Medium', 'High', 'Critical'];
const TYPE_TIER = {
  electrical: 'High', power_outage: 'High', generator: 'High', plumbing: 'Medium', water: 'Medium', harassment: 'High',
  projector: 'Medium', computer: 'Medium', software: 'Medium', lab_network: 'Medium', wifi: 'Medium', portal: 'Medium',
  ac: 'Medium', lab_equipment: 'Medium', hygiene: 'Medium', lighting: 'Medium', fan: 'Low',
  furniture: 'Low', seating: 'Low', books: 'Low', noise: 'Low', cleanliness: 'Low', food: 'Low', prices: 'Low', other: 'Low',
};
export function severityFor(problemType, hazard) {
  if (hazard && hazard !== 'none') return 'Critical';
  return TYPE_TIER[problemType] || 'Low';
}

export const CROWD_K = 10;
export const PERSON_WEIGHT_CAP = 1.5;
export const CREDIBLE_TRUST = 40;
export const CREDIBLE_NEEDED = 5;

// weight of one person (used for votes and crowd)
export function personWeight(user, now = Date.now()) {
  let w = Math.min(2.0, Math.max(0.2, (user.trust_score ?? 50) / 50));
  if (isNewAccount(user, now)) w *= 0.5;
  return Math.round(w * 100) / 100;
}
export const NEW_ACCOUNT_MS = 10 * 60 * 1000;
export const NEW_ACCOUNT_ACTIONS = 3;
export function isNewAccount(user, now = Date.now()) {
  return (now - user.created_at) < NEW_ACCOUNT_MS || ((user.action_count ?? 0) < NEW_ACCOUNT_ACTIONS && user.is_new === 1);
}

// members: [{trust_score, created_at, action_count, is_new}] (distinct users, reporters + me-too)
export function computePriority(severity, members, now = Date.now()) {
  const base = TIER_BASE[severity];
  const weights = members.map((m) => Math.min(PERSON_WEIGHT_CAP, personWeight(m, now)));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const boost = Math.log2(1 + sumW) * CROWD_K;
  const credible = members.filter((m) => m.trust_score >= CREDIBLE_TRUST && !isNewAccount(m, now)).length;
  let cap, capRule;
  if (severity === 'Critical') {
    cap = Infinity; capRule = 'Critical: no cap';
  } else {
    const nextTier = TIER_ORDER[TIER_ORDER.indexOf(severity) + 1];
    if (credible >= CREDIBLE_NEEDED && nextTier !== 'Critical') {
      cap = TIER_BASE[nextTier] + 29;
      capRule = `${credible} credible members: may rise into ${nextTier}, not beyond`;
    } else {
      cap = TIER_BASE[nextTier] - 1;
      capRule = `fewer than ${CREDIBLE_NEEDED} credible members (trust >= ${CREDIBLE_TRUST}): stays inside ${severity}`;
    }
  }
  const raw = base + boost;
  const total = Math.round(Math.min(raw, cap) * 10) / 10;
  return {
    total,
    breakdown: {
      severity, base,
      members: members.length,
      credible_members: credible,
      sum_weights: Math.round(sumW * 100) / 100,
      per_person_cap: PERSON_WEIGHT_CAP,
      crowd_boost: Math.round(boost * 10) / 10,
      formula: `base ${base} + log2(1 + ${Math.round(sumW * 100) / 100}) x ${CROWD_K} = ${Math.round(raw * 10) / 10}`,
      cap: cap === Infinity ? null : cap,
      cap_rule: capRule,
      capped: raw > cap,
      total,
    },
  };
}

// ---------- reopen / close rule (ROADMAP 5.1) ----------
export const REOPEN_WEIGHT = 1.5;
export const REOPEN_MIN_PEOPLE = 2;
export function evaluateVotes(votes, memberCount) {
  const dW = votes.filter((v) => v.verdict === 'dispute').reduce((a, v) => a + v.weight_at_vote, 0);
  const cW = votes.filter((v) => v.verdict === 'confirm').reduce((a, v) => a + v.weight_at_vote, 0);
  const dN = votes.filter((v) => v.verdict === 'dispute').length;
  const cN = votes.filter((v) => v.verdict === 'confirm').length;
  const r = (x) => Math.round(x * 100) / 100;
  const summary = { dispute_weight: r(dW), confirm_weight: r(cW), disputers: dN, confirmers: cN, members: memberCount };
  if (dW >= REOPEN_WEIGHT && dN >= REOPEN_MIN_PEOPLE && dW > cW) return { outcome: 'reopen', ...summary };
  const needConfirmers = Math.min(REOPEN_MIN_PEOPLE, memberCount);
  const needWeight = Math.min(1.0, 0.5 * memberCount);
  // close when enough affected people confirm and confirms outweigh disputes,
  // or when every affected member has voted and disputes did not reach the reopen bar
  if (cN >= needConfirmers && cW >= needWeight && cW > dW) return { outcome: 'close', ...summary };
  if (dN + cN >= memberCount && cW >= dW && cN > 0) return { outcome: 'close', ...summary };
  return { outcome: 'pending', ...summary };
}

export const TRUST = {
  CONFIRMED_FIX: 5,
  VOTE_MATCH: 2,
  VOTE_MISMATCH: -2,
  SPAM: -10,
  INJECTION: -15,
};
