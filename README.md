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
npm run scan -- --db ./scratch.db              # another database file
```

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
Keywords, weights and thresholds live in [seeds/rules.json](seeds/rules.json); your role, region
and remote preferences come from Settings. Postings are re-scored at startup, after every scan and
when a scoring setting changes. After editing the rules file:

```sh
npm run rescore                                # re-score the app database
npm run rescore -- --db ./scratch.db           # another database file
```

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

## Build

```sh
npm run build      # outputs to out/
```
