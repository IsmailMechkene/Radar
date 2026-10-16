# Radar

A local-first desktop app that searches job boards, company career pages and student programs for internships and jobs abroad, scores the results with plain rules, and shows deadlines when they exist. Everything runs on your machine; data lives in one SQLite file.

Status: early. The app has its window shell, navigation, the Opportunities page (list, filters, detail drawer) and a working Settings page; the other pages are placeholders. Nothing is scanned yet, so Opportunities starts empty. It lives in the system tray.

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

## Build

```sh
npm run build      # outputs to out/
```
