# Radar

A local-first desktop app that searches job boards, company career pages and student programs for internships and jobs abroad, scores the results with plain rules, and shows deadlines when they exist. Everything runs on your machine; data lives in one SQLite file.

Status: early scaffold. The app opens a placeholder window and lives in the system tray.

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

## Test and check

```sh
npm test           # unit tests (run under plain Node, no Electron)
npm run typecheck
npm run lint
```

## Build

```sh
npm run build      # outputs to out/
```
