# Radar

Local-first Electron desktop app that searches job boards, company career pages and student programs for internships and jobs abroad, scores results with plain rules (no LLM in the core), and shows deadlines when they exist.

**Read SPEC.md before starting any task.** (SPEC.md and `design/` are kept locally and are not committed.)

## Stack

- Electron (main process: DB, scheduler, scanner, alerts, tray) built with electron-vite
- React + Vite + Tailwind CSS for the renderer (talks to main over typed IPC only)
- SQLite via better-sqlite3
- TypeScript everywhere, zod for validating external data
- Vitest for tests, ESLint + Prettier for lint/format

Layout: `src/core` (pure TS, headless), `src/main` (Electron main), `src/renderer` (React), `src/cli.ts` (headless entry), `seeds/`, `fixtures/`, `tests/`.

## Ground rules

- Each commit or push is made in the user's name only. Never add Claude as author or co-author (no `Co-Authored-By` trailer).
- `src/core` must never import Electron, so it can run headless. (Enforced by ESLint.)
- The scanner runs in the Electron main process, never in a hidden window.
- Never fail silently. Validate external data with zod. Store dates in UTC. Inject the clock in tests.
- Do not scrape Indeed, LinkedIn or Glassdoor. Respect robots.txt and ToS.
- No secrets in the repo.
- Keep changes small and do not refactor outside the current step.

## How to run and test

```sh
npm install        # install deps (better-sqlite3 ships Node-API prebuilds that work in Node and Electron)
npm run dev        # start Electron + Vite dev server
npm run build      # build main + renderer into out/
npm test           # Vitest (plain Node, no Electron)
npm run typecheck  # tsc for node and web projects
npm run lint       # ESLint
```

The SQLite file is created at `<userData>/radar.db` (on Windows: `%APPDATA%\radar\radar.db`).

If `npm run dev` fails with `Cannot read properties of undefined (reading 'whenReady')`, the environment has `ELECTRON_RUN_AS_NODE=1` set (some editor/agent shells do this); unset it before running.
