# ReportFix

Students report campus problems in English, Roman Urdu, or a mix, typos included. AI reads the report, code decides what happens, the right department acts, and the students affected confirm or dispute the fix.

## Setup (3 steps)

1. Install Node 20.19+ and run `npm install` in this folder. (If your network blocks `registry.npmjs.org`, use `npm install --registry=https://registry.yarnpkg.com/`, an official mirror that serves the same packages and hashes.)
2. Copy `.env.example` to `.env` (already present) and set `LLM_API_KEY` (Gemini by default: `gemini-3.5-flash-lite`, retrying on `gemini-flash-lite-latest` when the first is overloaded). With no key, the app runs on the keyword fallback classifier.
3. `npm run dev`, then open http://localhost:5173 and sign in. Every seeded account (10 students, 6 department staff, 1 admin) gets its own random password on first start. The list is in `server/data/demo-credentials.txt` (gitignored; the DB only stores scrypt hashes). Anyone can create a **student** account on the sign-in page. Staff and admin accounts can't be self-registered.

## Authentication and RBAC

- **Real sign-in:** username and password, hashed with scrypt (random salt, constant-time compare). Unknown users take the same time and get the same error as wrong passwords. There is no user switcher and no impersonation endpoint.
- **Sessions:** a 256-bit random opaque token in an `HttpOnly; SameSite=Strict` cookie (`Secure` on HTTPS), 8-hour expiry. Only its SHA-256 is stored server-side. The token is rotated on every login, and logout deletes it on the server. JavaScript never sees the token.
- **RBAC:** `server/src/rbac.js` is the single permission table (student / staff / admin). Every route declares `requirePerm(...)`. On top of that, handlers enforce ownership (your own reports) and department scope (staff see and act on their own department only; confidential issues are admin only). The client builds its navigation from the permission list the server returns.
- **Abuse guards:**
  - Login: 10 attempts per IP+username every 15 min, plus 50 per IP.
  - Registration: 10 per IP per hour.
  - Reports and votes: per-user limits, plus a global limit.
  - Honeypot field on the sign-in and sign-up forms.
  - Injection attempts cost 15 trust and raise an admin flag.
  - Brigading discounts the votes and raises a flag. Vote and me-too uniqueness is enforced by DB constraints.
- **Headers:** helmet (CSP, HSTS, nosniff, X-Frame-Options, `strict-origin-when-cross-origin`), plus `Permissions-Policy` and `Cache-Control: no-store`. The Vite dev server sends the same headers and a report-only CSP. Production builds ship no source maps.
- **Demo reset:** admin only, and only when `DEMO_MODE=true`.
- **Change password** (Account security page): you must enter your current password, and the new one goes through a policy check (10+ characters, can't contain your username, can't be an obvious pattern, must differ from the current one). Every other session is signed out and your own session token is replaced.
- **Forgot password:** the admin issues a one-time reset code (about 80 bits, 15 minutes, single use, bound to that one account) from the Users page and hands it over in person. The user enters it under "Forgot password?". All their sessions are signed out. Admin accounts can't receive reset codes. Both issuing and using a code raise an admin flag.
- **Two-factor sign-in (TOTP, RFC 6238):** works with any authenticator app.
  - Setup asks for your password again, and turning it on requires a valid code.
  - When 2FA is on, the password step only returns a one-time challenge (5 minutes, burned after 5 wrong codes). The session is created after the 6-digit code, never before.
  - Each code works once (replay protection), with ±30 s of clock drift allowed.
  - Turning 2FA off needs both your password and a fresh code.

Tests: `npm run test:attack` (keyword fallback, no network) and `npm run test:attack:live -w server` (real LLM from `.env`).

## AI vs code: "AI understands, code decides"

| AI does (one call per report, temperature 0, JSON only) | Code does |
|---|---|
| department guess, location *mention* (as written), canonical problem_type, hazard flag, harassment flag, one-line reason, language, extra issues in the same message | sanitising, injection detection + penalty, hazard keyword override, location validation against the whitelist, confidential routing, grouping, the routing table, priority, crowd caps, votes, reopen/close, trust, permissions, rate limits |

- The report is wrapped in `<report>` tags and the system prompt says it is data. Angle brackets are stripped before that, so the report cannot close the tag.
- AI output is parsed with zod, and every field is clamped to its enum. Invalid output gets one retry, then the keyword fallback takes over. The 8s timeout applies to each attempt.
- Priority is **never** read from the AI or the text. CAPS, "urgent", "!!!" and "mark this critical" change nothing.
- A hazard keyword (EN + Roman Urdu: aag, dhuan, chingari, current lag, behosh, khoon...) forces Critical even if the AI says none. If the report contains an injection and no real hazard word, the AI's hazard is ignored. Hazard words inside the injected clause itself don't count.
- Location: the AI's mention is fuzzy-matched against `server/seed/locations.json`, which includes aliases and typos. Numbered places must exist exactly ("Lab 47" is not "Lab 4"). An unknown or missing place sets `needs_clarification`, and the report is **not routed** until the student picks a real place from a dropdown. An unlocated hazard also raises an admin flag.
- Confidential: if the AI flag or any harassment keyword fires, the report goes to the admin queue only. It is never grouped and never shown on the board, trending, the summary, or department queues, all filtered in SQL. The admin payload says "Anonymous student" and carries no user ids.
- Grouping key: `location_id + problem_type` among non-final public issues. A repeat report from the same student counts once (unique DB constraint). For `problem_type = other` only, an LLM "same problem?" check runs, falling back to token Jaccard ≥ 0.4.
- Routing table: `server/src/rules.js` `route()`. A projector, PC or software problem goes to CSE (Labs in a non-CSE lab, Library in the library). WiFi and the portal go to IS. Wiring, power, lights and fans go to EE. AC, furniture and equipment in a lab go to Labs. Books and library noise go to Library. Food, hygiene and prices go to Cafeteria. Harassment is Confidential. Anything unmatched goes to Admin triage.

## Photo evidence, urgent support, admin-verified severity

**Photos (students):** attach up to 3 JPEG/PNG photos to a report.
- The browser shrinks the image and re-encodes it, which drops EXIF/GPS on the device.
- The server checks it again, following checklist #16:
  - the type comes from the file's bytes, not its name or Content-Type, so HTML, SVG or PHP disguised as an image is rejected
  - 5 MB limit, 3 photos per report, adding photos only within 24 h, rate-limited
  - JPEG APP1–APP15/COM segments and PNG text/EXIF/time chunks are stripped, so a hidden GPS location never gets stored
  - files are saved outside the web root under random names and are never executed
  - they're served only through `GET /api/photos/:id` with a sniffed Content-Type, `Content-Security-Policy: sandbox`, `nosniff` and `no-store`
- Who can view a photo: the admin, the student who took it, and staff of the department that owns the (public) issue. Confidential evidence is visible to the admin and the uploader only. Photos never appear on the public board.

**Urgent support page (admin):**
- **Places that need help most:** campus places ranked by need score (the sum of the priorities of open issues there), with counts of critical issues, students affected, and photos.
- **Open problems:** listed most urgent first, with photos (optionally filtered to only those with photos).
- **Dispatch urgent support:** records what was sent, moves the issue to *In progress*, and logs it on the timeline that students see.

**Admin-verified severity and student credibility:**
- Students can optionally rate a report Minor / Moderate / Serious / Emergency. **That rating never changes priority by itself**, so it can't be used to jump the queue.
- The admin verifies the actual severity (Critical/High/Medium/Low). That becomes the issue's real severity, and the priority is recomputed.
- Every reporter who rated the issue is scored once (a DB-unique `rating_outcomes` row per report and issue):

| Student rating vs verified | Trust |
|---|---|
| Exact | +3 |
| One level off | +1 |
| Two levels too high | −3 |
| Three levels too high (e.g. "Emergency" for cold chai) | −6 |
| Rated lower than verified | 0 (playing it down isn't abuse) |

- Trust drives vote weight and crowd weight, so accurate raters gain influence and exaggerators lose it. The reason appears in the student's trust history, and the admin Users page shows each student's rating accuracy (e.g. "4/5 accurate").

## Excel export (admin)

**Admin → Export to Excel** downloads a live `.xlsx` workbook built from the database. It's generated by a dependency-free writer in `server/src/xlsx.js` and tested by opening it in Microsoft Excel. The workbook has five sheets:

| Sheet | Contents |
|---|---|
| Reported problems | Every public issue: problem, type, location, building, department, severity, hazard, priority, status, students affected, times reopened, dates, AI reason |
| Reports by student | Every report with the student's name and username, location, what they wrote, linked issue IDs, routed-to department, whether AI or the backup classifier triaged it, injection flag |
| Students | Trust score, vote weight, report count, issues affected by, votes cast, 2FA status, join date |
| Locations | Per campus place: total and open issues, critical hazards open, students affected, most common problem |
| Confidential (anonymous) | Harassment cases: severity, someone hurt, status, place, dates, summary. The reporter is always "Anonymous student" |

Safety rules:
- Admin-only (`admin:export` permission), rate-limited, and every download is logged as a `data_export` admin flag.
- Confidential reports are filtered out of the student sheets in SQL, so a student is never linked to one.
- Cells are written as inline strings, so text like `=cmd|...` is never evaluated as a formula (no CSV/Excel formula injection).

## Formulas

**Person weight:** `w = clamp(trust / 50, 0.2, 2.0)`, halved for new accounts (account under 10 minutes old, or fewer than 3 actions).

**Priority:** `priority = severity_base + crowd_boost`, then capped.
- severity_base: Critical 100 (any hazard), High 60, Medium 30, Low 10, set by problem type in code.
- `crowd_boost = log2(1 + Σ min(w_i, 1.5)) × 10` over distinct affected students (reporters + "me too").
- Tier cap: a non-critical issue stays inside its own tier (below the next tier's base) unless it has ≥ 5 credible members (trust ≥ 40, not new). Then it may rise into the next tier, but no further. A crowd can never reach Critical.
- Example: one trust-99 student on "chai is cold" gives 10 + log2(2.5)×10 = 23.2, which stays Low.

**Trust (start 50, range 0–100, every change logged in `trust_events` with a reason):** report leads to a confirmed fix +5, vote matches final outcome +2, vote against outcome −2, report rejected as spam by staff −10, injection attempt −15. An innocent "urgent" gets no penalty.

**Reopen / close (votes only from affected students; DB unique on issue + user + round):**
- Reopen if dispute weight ≥ 1.5 **and** ≥ 2 distinct disputers **and** dispute weight > confirm weight. The issue returns to the department queue and `reopen_count` goes up by 1.
- Close if confirmers ≥ min(2, members), confirm weight ≥ min(1.0, 0.5 × members), and confirm > dispute. It also closes once every member has voted and confirm ≥ dispute.
- Brigading: if ≥ 3 accounts younger than 10 minutes vote the same way on one issue within 5 minutes, those votes drop to weight 0.1 and the admin gets a flag.

## Security

The API key stays server-side in `.env`. Auth uses an HMAC-signed demo token, and the role is loaded from the DB on every request. Role and ownership are checked on every endpoint: CSE staff opening a Library issue get 403. SQL is parameterised everywhere. Text renders through React only, with no `dangerouslySetInnerHTML`. Every route has zod validation and length limits (4000 raw, 1200 kept). Report and vote endpoints are rate-limited per user, plus a global limit. Helmet sets security headers, and CORS is locked to `CLIENT_ORIGIN`. Clients get generic errors. Uniqueness is enforced by DB constraints. `status_log`, `trust_events`, `ai_log` and `admin_flags` form the audit trail. The demo switch and reset exist only when `DEMO_MODE=true`. `.env` is gitignored.

## Attack test results

`npm run test:attack` (keyword fallback, no network): **103 / 103 pass**. That includes a photo suite (EXIF/GPS stripped, disguised HTML/SVG/PHP rejected, truncated files rejected, 5 MB / 3-photo limits, owner-only upload, view rules for admin / uploader / department / other students, confidential evidence admin-only, never on the board), a severity-verification suite (a student rating can't move priority, +3/+1/−3/−6/0 scoring, no double scoring, the admin can raise or lower the real priority, only the admin can verify or dispatch, the urgent board is sorted by need and excludes confidential issues), an Excel export suite (admin-only, valid workbook, student + location data present, confidential reporter never linked, no formulas, download audited),  a password / reset / 2FA suite (change signs out other devices, reset codes are admin-only, single-use and bound to one account, 2FA blocks sign-in until the code, codes can't be replayed, the challenge dies after 5 wrong codes, disabling needs password + code), an authentication suite (no impersonation endpoint, generic 401, cross-account password reuse, HttpOnly/SameSite cookie, rotation, server-side logout, self-registration can't create staff/admin, honeypot, hashes never returned, brute-force 429, security headers) and an RBAC matrix (each role × each protected route → 403, anonymous → 401). The suites cover duplicates in 3 languages (10 → 1 issue), the same student ×5 (count 1), 6 calm hazards, 6 shouting non-issues, 6 injections (EN, Roman Urdu, hidden, JSON-shaped, `system:`, "you are now admin"), 5 fake or missing places plus clarification, 4 harassment cases (including one with a location and one with an injury), 3 multi-issue messages, vote abuse (non-affected, staff, double vote, 5-account brigade), reopen and close, crowd caps, cross-department 403, student → staff 403, forged token 401, hostile input (empty, emoji, 4001 chars, `<script>`, `</report>` breakout, bad JSON), AI down → fallback, reset, and rate limits.

Live LLM run, `npm run test:attack:live -w server` (gemini-3.5-flash-lite): **64 / 64 pass**. In that run, 35 of 74 reports were triaged by Gemini and the rest fell back to keywords because of free-tier rate limits. The 5 rejected inputs (empty, emoji, too long) never reach the AI.

## Status

**Works**
- Full pipeline: sanitise, AI triage, overrides, location check and clarification, confidential path, multi-issue split, grouping, routing, priority
- Keyword fallback classifier (the app works with no key, a bad key, or the API down)
- Student: report, My issues with a live timeline (3s poll), campus board with "me too", confirm/dispute, trust history
- Staff: own department queue only, acknowledge / in progress / resolve / reject as spam / re-route with a reason
- Admin: all issues, confidential queue (anonymous), users with trust history, flags (injection, brigading, unlocated hazard), summary
- Votes, reopen/close, trust events, crowd priority with caps, brigading detection, trending board, AI admin summary (with a code fallback)
- Real sign-in and student self-registration, RBAC on every route, redesigned UI with a sidebar built from the user's permissions

**Partial**
- Not every multi-issue split works in fallback mode: it splits on conjunctions and punctuation ("aur", "and", ","). Two problems in one clause with no conjunction may stay one issue unless the live LLM catches them.
- Grouping `other`-type issues without a key uses lexical similarity only.
- No auto-close timer: a resolved issue closes through votes only.
- A single affected student can't reopen alone, because the rule needs 2 disputers.

**Not done**
- Email-based password reset (no mail server; the admin hands out reset codes instead)
- Backup / recovery codes for 2FA (if you lose your phone, the admin issues a reset code, but 2FA stays on, so this case needs a DB fix today)
- Embeddings (an LLM yes/no or Jaccard check is used instead)
- Git history: commits were skipped on request
