# OpportunityRadar: build spec

A local desktop app that SEARCHES many sources (big job boards, niche boards, company career pages, program pages) for internships, programs and jobs abroad, scores them with plain rules, and shows a deadline on each result when one exists. Search breadth is the core feature; deadlines and reminders are an attribute of results, not the organizing idea.

Hard constraints (do not break these):
1. 100% free to run: no paid APIs, no paid hosting.
2. No LLM at runtime. All scoring is deterministic rules and keyword lists.
3. Local-first. Data lives in one SQLite file on the user's machine. Hosting is optional (see M8).
4. The app never sends an application or email on its own. The human sends everything.
5. Respect each site's ToS and robots.txt. Use public APIs, public ATS feeds, RSS and plain public pages. Sites that forbid scraping and block bots (Indeed, LinkedIn, Glassdoor) are covered through the user's own email job alerts (see section 5, item 6), not by scraping. Every adapter declares its `access_method` (api | rss | public_html | email_alert | manual) and its ToS note in `sources.config_json`.

## 1. User profile (seed into Settings, editable)

- Tunisian software engineering student, AI development focus. Average 15/20 (Tunisian system).
- Wants a ~2 month internship abroad (summer 2027), onsite preferred, remote OK, English-speaking preferred. Goal: lead to a PFE internship and then a job.
- Roles: AI/ML engineer, backend, full-stack, software engineer intern.
- Timezone for all reminders: configurable, default Africa/Tunis.

## 2. Stack (decision made, do not re-debate)

TypeScript end to end, one language, one process tree.

| Layer | Choice |
|---|---|
| Shell | Electron (tray icon, autostart on login, native notifications) |
| UI | React + Vite + Tailwind + TanStack Table |
| DB | SQLite via better-sqlite3-multiple-ciphers (SQLite3 Multiple Ciphers, ChaCha20-Poly1305), encrypted at rest; migrations with a tiny runner (no ORM needed) |
| Lock | Mandatory password. A random 32-byte data key encrypts the database; it is stored only wrapped (AES-256-GCM) by a scrypt key from the password and by a recovery key shown once at setup. Node `crypto` only, no extra dependency |
| Scheduler | node-cron inside the main process, plus startup catch-up |
| Fetch/parse | undici/fetch, cheerio, fast-xml-parser for RSS. Playwright only for pages that truly need JS, behind a flag |
| Alerts | Electron Notification, Telegram bot (free), Gmail SMTP with app password via nodemailer (optional), ntfy.sh (optional) |
| Tests | Vitest, plus recorded HTML/JSON fixtures per adapter |
| Packaging | electron-builder (NSIS/dmg/AppImage), GitHub release optional |

Process layout:
- `main` (Electron main): owns DB, scheduler, alerts, tray. Keeps running when the window is closed (minimize to tray). Starts in two parts: the shell (window, tray, lock screen IPC) and, after unlock, everything that needs the database. Lock (toolbar or tray) stops the scheduler and scans, removes the data IPC handlers, closes the database and wipes the key from memory.
- `renderer` (React): talks to main over typed IPC only. No direct DB access.
- `core/` (pure TS, no Electron imports): adapters, rules, deadline engine, dedupe. Runs under plain Node so it can also run headless: `node cli.js scan` for an OS scheduler or CI.

Python is a fine substitute if the user prefers it; the module boundaries below stay the same.

## 3. Repo layout

```
radar/
  src/core/
    adapters/        # one file per source type
    rules/           # scoring, filters, keyword lists (JSON, user-editable)
    deadlines/       # date parsing, reminder engine
    dedupe.ts
    db/              # schema.sql, migrations, queries
    runner.ts        # scan orchestration, run log, heartbeat
  src/main/          # electron main, tray, scheduler, notifier, ipc
  src/renderer/      # React app
  src/cli.ts         # headless entry: scan | remind | export
  seeds/             # programs.json, companies.json, rules.json
  fixtures/          # saved HTML/JSON per adapter for tests
  tests/
```

## 4. Data model (SQLite)

`<userData>/radar.db` is encrypted with the data key (SQLite3 Multiple Ciphers, default ChaCha20-Poly1305); without the key it does not open. Next to it, `<userData>/keys.json` holds the data key wrapped twice (AES-256-GCM): by a key derived from the password (scrypt, N 2^17, r 8, p 1) and by a key derived from the recovery key (HKDF-SHA256; the recovery key is 160 random bits shown as 8 groups of 4 Crockford base32 characters). Neither the password nor the recovery key is stored. Forgot password: the recovery key opens the data and the data key is re-wrapped with a new password. A recovery key never confirmed as saved is replaced by a new one at the next unlock. A plain `radar.db` from before encryption is copied, encrypted, checked table by table, and only then replaced (the plain file is deleted after the check); an interrupted run resumes on the next unlock.

```
sources(id, kind, name, url, config_json, enabled, last_ok_at, last_error, consecutive_empty, created_at)
opportunities(id, dedupe_key UNIQUE, source_id, org, title, location, remote_type, url, apply_url,
              description, posted_at, deadline_at, deadline_status, eligibility_notes,
              score, score_breakdown_json, verdict, first_seen_at, last_seen_at, closed_at)
programs(id, name, org, url, typical_open, typical_deadline, last_cycle_deadline, eligibility_json,
         deadline_status, next_check_at, notes)
pipeline(id, opportunity_id NULL, program_id NULL, org, status, planned_send_date, sent_at,
         followup1_at, followup2_at, contact_name, contact_url, notes, updated_at)
reminders(id, target_type, target_id, due_at, kind, fired_at, snoozed_until)
page_snapshots(id, source_id, content_hash, text_excerpt, fetched_at)
runs(id, started_at, finished_at, trigger, sources_ok, sources_failed, new_items, error_summary)
settings(key PRIMARY KEY, value_json)
```

`verdict` is one of: `apply`, `maybe`, `needs_review`, `skip`.
`deadline_status` is one of: `confirmed`, `expected` (inferred from last cycle), `rolling`, `unknown`, `closed`.
Dedupe key: `lower(org) | normalized(title) | normalized(location)`; also dedupe on canonical URL.

## 5. Sources layer

Adapters implement `fetch(source) -> RawItem[]` and are tested against fixtures.

1. **ATS public feeds** (best signal, stable):
   - Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`
   - Lever: `https://api.lever.co/v0/postings/{company}?mode=json`
   - Ashby: `https://api.ashbyhq.com/posting-api/job-board/{company}`
   - Verify each endpoint live in M2 before relying on it; some companies use other ATSs.
2. **Aggregator API**: Arbeitnow `https://www.arbeitnow.com/api/job-board-api` (free, no key, has visa sponsorship info). Add other free public APIs/RSS only after checking their terms.
3. **Program watchlist pages**: plain public pages for IAESTE, MBZUAI UGRIP, KAUST VSRP, Google Summer of Code, Erasmus+ (school office), InstaDeep, etc. Use page-change detection (below), not full parsing.
4. **Manual entry**: always available. Paste a URL, title and deadline; any opportunity can be added by hand.
6. **Email-alert ingestion (covers Indeed, LinkedIn, Glassdoor and any site with job alerts)**: the user creates saved searches/alerts on those sites, sent to a dedicated Gmail address. The app reads that mailbox over IMAP (read-only, app password, label/folder filter), parses the job cards and links from each alert email with per-sender parsers (fixtures required), and creates opportunities like any other source. No scraping of those sites.
7. **Free job APIs and feeds (add each only after checking its current terms; keys are free where needed)**: Adzuna API, Jooble API, The Muse API, Remotive, RemoteOK, We Work Remotely RSS, Hacker News "Who is hiring" via the Algolia HN API, Arbeitnow (above). Treat the list as candidates to verify in M2, not as confirmed.
8. **Niche and regional boards (public pages or RSS, checked individually for ToS/robots)**: startup boards such as Y Combinator Work at a Startup, Wellfound, Welcome to the Jungle, Berlin Startup Jobs; research/academic internships such as EURAXESS; EURES for EU roles; Tunisian/MENA and French-language boards for "stage" postings. The user can add any board as a source from the Sources page with a CSS-selector config and a test-fetch preview.
9. **Search queries as config**: each source stores keyword/location queries (e.g. "machine learning intern", "stage ia", "backend internship remote Europe"). The user edits the query list in the UI; the runner expands queries per source.
5. **Company careers pages**: generic adapter = fetch page, extract links matching internship/stage/intern keywords, diff against previous snapshot.

Politeness: User-Agent identifies the app, 1 request/second per host, cache with ETag/Last-Modified, honor robots.txt, exponential backoff on 429/5xx.

## 6. Rules engine (no LLM)

All lists live in `seeds/rules.json` and are editable in the UI.

Hard filters (drop to `skip`, keep the row so it can be reviewed):
- Title excludes: senior, staff, principal, lead, manager, director, "5+ years", "PhD required".
- Not an internship/student role and the user toggled "internships only".
- Explicit work-authorization lock the user cannot meet (phrases like "must be authorized to work in", "no visa sponsorship", "EU citizens only", "US persons only"). These go to `needs_review` instead of `skip` when the text is ambiguous.

Weighted score 0-100:

| Signal | Points |
|---|---|
| Role keywords in title (ai, ml, machine learning, backend, full-stack, software engineer, intern, stage, PFE) | up to +30 |
| Stack keywords in description (Python, TypeScript, FastAPI, Node, React, PyTorch, LLM, RAG, Postgres) | up to +15 |
| Internship / student / summer 2027 / 8 weeks / 2 months | up to +20 |
| Remote or English-speaking location preference match | up to +10 |
| Visa sponsorship or "international students welcome" | +10 |
| Source is on the curated watchlist | +5 |
| Posted within 14 days | +5 |
| Deadline known and more than 14 days away | +5 |
| Penalties: senior-ish words, language requirement the user lacks (e.g. "fluent German required"), onsite country with no visa path | up to -40 |

Store `score_breakdown_json` so the UI can show exactly why an item scored what it did (explainability is a requirement).
Thresholds: `>=65 apply`, `40-64 maybe`, `<40 skip`; anything with an ambiguous eligibility phrase is forced to `needs_review`.

GPA rules: parse "GPA 3.5/4" style requirements and compare with a configurable conversion of 15/20 (store the user's own conversion and mark as "unverified"). If the requirement is above the converted value, flag `eligibility_notes` rather than silently skipping.

## 7. Deadline engine

- Parse dates from text with a multi-pattern parser (EN and FR: "31 mars 2027", "March 31", "rolling", "until filled"). Always store the original sentence next to the parsed date.
- Two kinds of date:
  - `confirmed`: explicitly on the live page.
  - `expected`: copied from last cycle (e.g. UGRIP last cycle Feb 28, GSoC contributor window Mar 16-31, InstaDeep PFE windows closing in November, IAESTE nominations Dec-Feb). Show these with a visible "expected, unconfirmed" badge and a `next_check_at`.
- Reminders at T-30, T-14, T-7, T-2, T-0 days, plus "window should open soon" reminders at T-14 before an expected open date.
- Page-change detection: hash the normalized text of each watchlist page; on change, create an alert "page changed, review" with a text diff. Normalize to ignore timestamps and ad noise.
- Follow-up engine for outreach: when `sent_at` is set, set follow-ups at +7 and +14 days; fire a reminder when due and status is still Sent.
- Snooze and mark-done on every reminder.

## 8. Reliability (this is what makes it "never miss anything")

- **Locked means idle**: nothing runs while Radar is locked (no scans, reminders, page checks or backups); catch-up happens at unlock. Radar starts locked; autostart therefore waits at the lock screen.
- **Startup catch-up**: on unlock and on wake from sleep, if last successful scan > 12 h ago, run immediately. Fire any reminders whose `due_at` has passed and `fired_at` is null.
- **Autostart on login** (`app.setLoginItemSettings`) and tray residency.
- **Heartbeat**: a persistent banner "Last successful scan: X ago", red if > 48 h.
- **Per-source health**: if a source returns zero items or errors 3 runs in a row, alert once ("source X looks broken") and show it in the Sources page.
- **Run log** for every scan with counts and errors; viewable and exportable.
- **Backups**: daily SQLite backup to a user-chosen folder, keep the last 14 (`VACUUM INTO`, so each backup is encrypted with the same key and opens with the same password). JSON/CSV export of everything (exports are plain files the user chose to write).
- **Headless mode** so a plain OS scheduler (Task Scheduler, cron, launchd) can run `cli scan` even if the app is closed. The CLI needs the password (typed, or `RADAR_PASSWORD`) or the recovery key (`--recovery-key`, or `RADAR_RECOVERY_KEY`), and `keys.json` next to the database.
- **Optional free hosting (M8)**: GitHub Actions cron running `cli scan` and pushing alerts via Telegram, with the SQLite file stored in a private repo or artifact. Standard runners are free for public repos; private repos get 2,000 minutes per month on the Free plan. Scheduled workflows in public repos can be paused after long inactivity, so keep a keep-alive commit or rely on the local app as primary.
- Secrets (Telegram token, SMTP app password) go in the OS keychain (keytar) or env vars, never in the repo or the DB in plain text.

## 9. UI

Pages:
1. **Opportunities (home page)**: new results since last visit first, then the full searchable table. Deadline shown as a column and filter ("closing within N days", "has deadline", "no deadline"). Table with filters (verdict, score, remote, country, deadline window, source), sort, bulk actions (star, dismiss, add to pipeline), detail drawer with score breakdown and original text.
2. **Deadlines** (a secondary view over results that have one, plus reminders due): calendar and list; confirmed vs expected styling; add manual deadline; export to .ics so it also appears in the user's phone calendar.
4. **Pipeline**: kanban or table: Not started, Drafted, Sent, Follow-up sent, Interview, Rejected, Offer, Not eligible. Planned send date, sent date, auto follow-up dates, notes.
5. **Programs**: the watchlist (IAESTE, UGRIP, KAUST VSRP, GSoC, Erasmus+, InstaDeep, etc.) with typical windows, last-cycle dates, next check date, change alerts.
6. **Outreach**: email draft templates with merge fields; button opens the user's mail client via `mailto:` or copies to clipboard. Never sends automatically.
7. **Sources**: add/enable/disable sources, health, last run, test-fetch button.
8. **Rules**: edit keyword lists, weights, thresholds, GPA conversion, with a "re-score everything" button and a live preview.
9. **Settings**: profile, timezone, alert channels (test buttons), backup folder, autostart toggle, quiet hours.

Design: dark/light, keyboard shortcuts (j/k, s to star, x to dismiss), fast search over title/org/description.

## 10. Seed data

Seed `pipeline` and `programs` from the user's Google Sheet "Internship outreach tracker 2027" (13 organizations). Planned first sends:

| Date | Organization |
|---|---|
| 2026-10-19 | IAESTE Tunisia, Erasmus+ office, InstaDeep Tunis |
| 2026-10-20 | Entrelacs |
| 2026-10-21 | Weaviate |
| 2026-10-22 | Photoroom, DeepL |
| 2026-12-01 | Hugging Face |
| 2027-01-11 | Mistral |
| 2027-01-18 | Cohere |
| 2027-01-25 | MBZUAI UGRIP |
| 2027-03-16 | Google Summer of Code |

Known expected windows (mark as `expected`, never `confirmed`, until the live page says so): IAESTE nominations Dec-Feb; MBZUAI UGRIP last cycle Feb 28 (CGPA 3.5/4 or equivalent); KAUST VSRP rolling, apply 4-6 months ahead; GSoC contributor applications last cycle Mar 16-31; InstaDeep PFE windows historically closed in November; Hugging Face summer 2027 postings expected Nov-Dec 2026. Already passed or not applicable: Mitacs Globalink 2027 (Sept 16, 2026), JetBrains, DAAD RISE.

Implementation note: add a one-time importer that reads the sheet exported as CSV (the user downloads each tab) so no Google API credentials are needed.

## 11. Milestones with acceptance tests

Build in this order; each milestone must pass its tests before the next starts.

**M1 Foundation.** Electron + React shell, SQLite schema and migrations, settings page, tray, autostart.
Test: app starts, closing the window keeps the tray process alive, DB file is created, migrations are idempotent.

**M2 Adapters.** Greenhouse, Lever, Ashby, Arbeitnow, the free job APIs/feeds in section 5 item 7 (verify each live, drop any that fail or whose terms forbid use), generic careers-page and page-hash adapters, IMAP email-alert ingestion with parsers for Indeed and LinkedIn alert emails, manual entry. Fixture tests for each.
Test: each adapter parses its fixture into `RawItem[]`; a live smoke test passes for at least one real board per ATS; politeness limits respected.

**M3 Dedupe and storage.** Upsert by dedupe key, track `first_seen_at`/`last_seen_at`, mark `closed_at` when an item disappears.
Test: scanning the same fixture twice yields zero new rows; a removed posting gets `closed_at`.

**M4 Rules engine.** Filters, weighted score, breakdown, verdicts, GPA rule.
Test: a table of at least 30 labelled sample postings (apply / maybe / skip / needs_review) all classified as labelled; changing a weight in Rules changes the result after re-score.

**M5 Deadline and reminder engine.** Date parser (EN/FR), confirmed vs expected, reminder schedule, follow-ups, snooze, page-change alerts.
Test (with an injectable clock): at T-30/14/7/2/0 exactly one reminder fires each; a reminder missed while the app was off fires on next start; marking a pipeline row Sent creates follow-ups at +7 and +14; a changed page hash raises exactly one alert.

**M6 Alerts.** Desktop notifications, Telegram bot, optional email and ntfy, quiet hours, test buttons.
Test: each channel's "send test" works; failures are logged and do not crash the scan; quiet hours defer rather than drop.

**M7 UI completion.** All pages in section 9, .ics export, CSV/JSON export, daily backup.
Test: every page loads with seed data; .ics imports into a calendar app; restoring a backup reproduces the same data.

**M8 Optional headless and hosting.** `cli scan|remind|export`, OS-scheduler instructions per platform, optional GitHub Actions workflow with Telegram alerts.
Test: `cli scan` runs with the app closed and writes a run row; the workflow dry-run succeeds.

**M9 Hardening and packaging.** Source-health alerts, heartbeat banner, run log UI, electron-builder installers, README.
Test: simulate a source returning empty three times, one "broken source" alert appears; the installer produces a working app on the user's OS.

## 12. Vibe-coding guardrails

- Never fail silently: every adapter error is logged to `runs` and shown in the UI.
- Validate all external data (zod) before it touches the DB.
- Time handling: store UTC ISO strings, convert for display, run reminder math in the user's timezone, and always inject the clock so tests are deterministic.
- Do not hardcode secrets or personal data in the repo.
- Commit after each milestone with the tests passing.
- When an adapter breaks because a site changed, fix the adapter and add the new HTML to `fixtures/` as a regression test.
