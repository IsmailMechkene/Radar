# Radar

A local-first desktop app that searches job boards, company career pages and student programs for internships and jobs abroad, scores the results with plain rules, and shows deadlines when they exist. Everything runs on your machine; data lives in one SQLite file.

Status: early. The app has its window shell, navigation, the Opportunities page (list, filters, detail drawer) and a working Settings page; the other pages are placeholders. Scans fetch real postings, and every posting gets a score and a verdict from plain rules, plus a deadline read from its text. Programs are watched for page changes and reminders arrive as desktop notifications. It lives in the system tray.

UI work follows [DESIGN.md](DESIGN.md).

## Requirements

- Node.js 22 or newer
- npm

## Install

```sh
npm install
```

## Run

```sh
npm run dev
```

Closing the window keeps Radar running in the tray. Use the tray menu's **Open** to bring it back and **Quit** to exit.

## Accounts

Radar needs an account (Supabase Auth): sign up with email and password, or **Continue with
Google**. The Supabase URL and publishable key go in an uncommitted `.env` (copy
[.env.example](.env.example)). Sign-ins that go through the browser (Google, the email confirmation
link, the password reset link) come back to Radar at `http://127.0.0.1:47319/auth/callback`, a small
server that runs only while such a step waits. Open those links on the computer running Radar.

One-time project setup in the Supabase dashboard:

1. **Authentication → URL Configuration → Redirect URLs:** add
   `http://127.0.0.1:47319/auth/callback`.
2. **Google** (optional): in Google Cloud Console create an OAuth client of type _Web application_
   with the authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`, then paste
   its client ID and secret in **Authentication → Providers → Google** and enable it. Until then,
   Continue with Google says it is not set up.
3. **Email:** Supabase's built-in email sender is limited to a few messages per hour; set up custom
   SMTP (**Authentication → Emails**) before real use.
4. **Confirmation code:** Radar's Verify your email screen takes the 6-digit code from the
   confirmation email. In **Authentication → Emails → Confirm signup**, add the code to the template
   (for example `Your code: {{ .Token }}`) and keep the email OTP length at 6. The link in the
   email keeps working too.

Email accounts: the account password also encrypts Radar's data on this computer. Google accounts:
after the first Google sign-in you choose a separate Radar password for this computer. Either way
Radar unlocks offline once you have signed in, and renews the session in the background when
online. Sign-in tokens stay in Radar's main process, encrypted with the system's secure storage
(DPAPI on Windows); the page never sees them. **Settings → Account** shows the account and signs
out.

### Sync

Your pipeline, outreach templates and drafts, manual deadlines, rules, profile settings, and the
programs and sources you added or edited follow your account to every computer. Each row is
encrypted on your computer before it is uploaded; Supabase stores ciphertext only and cannot read
it. Postings are not synced: each computer scans for itself. On a new computer, sign in and enter
your **recovery key** once. A computer that already had its own data links it in **Settings →
Account** with the same recovery key; afterwards that one key opens every computer. The database
side is in [supabase/migrations](supabase/migrations) (tables with row-level security, applied to
the project once).

## Password and encryption

Radar's database is encrypted on disk with your password (above) and shows a **recovery key**
once: save it somewhere safe. If you forget your password, the reset email restores your account
and the recovery key restores the data on this computer; without it that data cannot be opened.
If you change your password on another computer, Radar asks for the recovery key once here. A database from an earlier
version is encrypted at that moment; the unencrypted file is deleted only after the encrypted copy
has been checked.

**Lock** (the padlock in the toolbar, or the tray menu) closes the database and stops everything:
no scans, reminders or backups run until you unlock again. Backups are encrypted with the same key
and open with the same password. The key file is `keys.json` next to `radar.db`
(`%APPDATA%\radar` on Windows); without it the data cannot be opened, so back it up with the
database.

In development, an empty Opportunities page offers **Load sample data** so the page can be tried before any source exists. Sample rows are labeled as such and can be removed from the same page.

## Test and check

```sh
npm test           # unit tests (run under plain Node, no Electron)
npm run typecheck
npm run lint
npm run shot       # screenshots of the app next to the design, saved to shots/
```

## Sources and scanning

Configured sources live in [seeds/sources.json](seeds/sources.json): five Ashby job boards (Cohere,
DeepL, Mistral AI, Photoroom, Weaviate) and Arbeitnow internships. InstaDeep and Entrelacs are listed
as pending until the careers-page adapter exists. Research notes: [docs/source-spike.md](docs/source-spike.md).

In the app, **Scan now** (bottom of the sidebar, or Ctrl+R) fetches every enabled source and stores
new postings; postings that disappear from a source are marked closed. The same scan runs headless,
for example from Windows Task Scheduler or cron, into the app's own database:

```sh
npm run scan                                   # every enabled source
npm run scan -- --source "Mistral AI"          # only some sources
npm run scan -- --db ./scratch.db              # another database file (keys.json must sit next to it)
```

The CLI asks for your password. Under a scheduler, where nobody can type it, set `RADAR_PASSWORD`
(or `RADAR_RECOVERY_KEY`) in that task's environment; add `--recovery-key` to type the recovery key
instead of the password.

Fetch one source live and print what Radar would store, without writing anything:

```sh
npm run scan:dry -- --source "Mistral AI"
npm run scan:dry -- --source "Arbeitnow internships" --json --limit 5
```

Requests identify Radar in the User-Agent, respect robots.txt, and wait at least one second between
calls to the same host.

None of the current sources needs an API key. Sources that do (Adzuna, later) will read their free
key from environment variables (`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`); keys are never stored in the
repository.

## Scoring

Every posting gets a score out of 100 and a verdict: **Apply** (65 or more), **Maybe** (40–64),
**Skip** (below 40, or caught by a hard filter such as a senior title), or **Needs review** when
eligibility is unclear (work authorization, GPA). The detail drawer lists each signal and its points.
Keywords, weights and thresholds can be edited on the **Rules** page, which re-scores a live preview of your own postings as you drag and re-scores everything when you save; **Reset to defaults** goes back to [seeds/rules.json](seeds/rules.json); your role, region
and remote preferences come from Settings. Postings are re-scored at startup, after every scan and
when a scoring setting changes, in small batches in the background so the window stays responsive
with tens of thousands of postings. To re-score from the command line (it uses your edited rules too):

```sh
npm run rescore                                # re-score the app database
npm run rescore -- --db ./scratch.db           # another database file
```

## New-match alerts

After each scan (Scan now or the background schedule), Radar sends one Windows notification for
the new postings worth a look, for example "3 new strong matches" with the best three and their
scores. Clicking it opens Opportunities showing exactly those postings. If Radar's window is in
front, a short message with **Show** appears instead. **Settings → Notifications → New-match
alerts** chooses Apply only (the default), Apply and Maybe, a daily summary at 09:00, or off.

Each posting is considered once: closed, dismissed, already-in-pipeline and program postings never
alert, and a later re-score or another source finding the same posting does not alert again.
Quiet hours hold alerts until they end. Alerts need Radar running (it keeps running in the tray
when you close the window; turn on **Launch at login** to have it always on).

## Deadlines, programs and reminders

After every scan, Radar reads each posting's deadline from its text (English and French:
"apply by March 31, 2027", "date limite : 31 mars 2027", "candidatures jusqu'au 15/11",
"rolling basis"). A date stated in the posting is **confirmed**; "rolling" and "until filled" are
**rolling**; a date it cannot read with confidence (03/04 in English text, a day/month without a
year that has just passed) stays **unknown** with its sentence kept and a "check the deadline"
note. Dates without a year use the posting date: the next occurrence, unless it passed 1–60 days
before (then flagged). A deadline means the end of that day in your Settings time zone.

The Programs watchlist lives in [seeds/programs.json](seeds/programs.json) (IAESTE Tunisia,
MBZUAI UGRIP, KAUST VSRP, Google Summer of Code, Erasmus+ via your school, InstaDeep PFE,
Hugging Face, Entrelacs). Their windows are copied from the last cycle and marked **expected**
("from last cycle, unverified"), never confirmed. Programs are not scored. Program pages with a
known URL are fetched about once a day; the first fetch is a baseline, and a later change in the
page text (timestamps, scripts, navigation and cookie banners ignored) creates a "page changed,
review" alert with a short diff.

Reminders: T-30, T-14, T-7, T-2 and T-0 days (09:00 local) for deadlines of starred or pipeline
opportunities and of programs; "window should open soon" 14 days before an expected opening;
follow-ups 7 and 14 days after a pipeline row is marked Sent, while it is still Sent. The app
checks every hour, at startup and after the computer wakes (and scans if the last good scan is
too old). Reminders missed while it was off come back as one notification per item. During
quiet hours (Settings) notifications wait until the quiet period ends.

See what would fire at a given time, without saving anything:

```sh
npm run remind:dry -- --now 2026-10-19T09:00    # local time in your Settings time zone
npm run remind:dry -- --now 2026-11-17T09:00 --db ./scratch.db
```

## Deadlines

The Deadlines page lists every dated deadline: opportunities that state one, the programs'
expected windows (marked "Expected, unconfirmed") and deadlines you add by hand with **Add
deadline**. Switch between a list and a month calendar. **Due soon** shows what needs attention in
the next 14 days, including follow-ups; **Snooze** brings an item back tomorrow and **Done** stops
its reminders (Undo right after). **Export .ics** saves the upcoming dates as a calendar file you
can import into Google Calendar or a phone calendar; each date has a reminder the day before, and
importing again updates the events instead of duplicating them.

## Programs

The Programs page shows each watched program (IAESTE, UGRIP, KAUST VSRP, GSoC, Erasmus+, InstaDeep,
Hugging Face, Entrelacs, and any you add with **Watch a program**): its typical window, the next
cycle's dates, the last cycle and when its page is checked next. When an official page changes,
the card turns amber and shows what changed; **Update deadline** lets you enter the new dates as
confirmed, **Mark reviewed** dismisses it. **Check now** fetches the page right away. Once you edit
a program, your version is kept even when the seed file changes.

## Sources

The Sources page lists every board, feed and page Radar fetches, grouped by type, with its health
(green healthy, amber nothing found last time, red broken after a failure or 3 empty runs), when it
last worked, how many open postings it lists and the last error. The switch pauses a source (kept
across restarts). **Test fetch** fetches it the way a scan would and shows what came back without
saving anything. **Add source** adds a company's job board on Ashby, Greenhouse, Lever or Recruitee (paste
its link, e.g. jobs.ashbyhq.com/photoroom, job-boards.greenhouse.io/datadog, jobs.lever.co/palantir
or bunq.recruitee.com, and the platform is picked for you) or a web page to watch for changes, with
a preview before adding. All four use the platforms' public job-board APIs, without a key.

Radar ships with about 80 sources checked live (`seeds/sources.json`, notes in
[docs/source-spike.md](docs/source-spike.md)): AI labs and tools, big tech, trading firms and
European scale-ups whose boards list internships, plus the Arbeitnow aggregator.

## Outreach

The Outreach page drafts emails for the organizations in your Pipeline. Pick a template (an English
first email, a follow-up and a French candidature come with Radar; edit them or add your own under
**Templates**) and fill its [fields]: company, role, the contact's first name, the email and the
sent date come from the Pipeline; "my name" and "my school" are typed once for every organization;
the rest (product, project, ...) per organization. **Copy** puts the draft on the clipboard and
**Open in Mail** opens it in your mail app; Radar never sends email. After opening it, **Mark sent**
records the date and plans the follow-ups.

## Pipeline

The Pipeline page tracks outreach from Not started to Offer. **Add entry** creates a row for any
organization; **Add to pipeline** on an opportunity links the posting. Changing a row's status to
**Sent** fills in today as the sent date and plans follow-up reminders 7 and 14 days later.

**Import CSV** reads your outreach tracker exported from Google Sheets (File → Download → CSV) or
Excel. The first row must name the columns; English and French names work in any order:
Organization (required), Role, Status, Planned send date, Sent, Contact, Email or link, Notes.
Dates are read day-first (19/10/2026, 2026-10-19, Oct 19, 19 octobre). Rows already in the
pipeline (same organization and role) are skipped, so importing again is safe, and every row or
value that could not be read is listed after the import.

## Backups and export

Radar backs up its database once a day (a consistent SQLite copy named `radar-YYYY-MM-DD.db`) and
keeps the last 14. Backups go to a `Backups` folder inside Radar's data folder until you choose
another one in **Settings → Data**, which also has **Back up now** and **Open**. To restore, quit
Radar and copy a backup over `radar.db` in the data folder.

**Export JSON** saves every table in one file; **Export CSV** writes one CSV per table into a new
folder (UTF-8, opens in Excel; cells that would run as spreadsheet formulas are neutralized).

## Security and privacy

- Nothing leaves your machine except requests to the sources you scan. Every request goes through
  one client that sends a Radar User-Agent, checks robots.txt on each redirect hop, waits a second
  between requests to the same host and stops reading a response after 10 MB.
- The window is sandboxed with context isolation and a strict Content Security Policy; it cannot
  navigate away, open other windows or request permissions (camera, location, notifications from
  web content), and the main process only answers requests from Radar's own page.
- Text from job boards is treated as untrusted: it is never rendered as HTML, and the text
  processing (HTML to text, deadline parsing, page-change diffs, CSV import) runs in linear time
  on hostile input.

## Build

```sh
npm run build      # outputs to out/
```
