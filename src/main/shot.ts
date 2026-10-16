// `npm run shot`: captures the app and the design at the same full-screen size, light and dark,
// into shots/ (git-ignored), plus shots/compare.html to view them side by side.
import { app, BrowserWindow, type WebContents } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDesignHarness } from './design-harness';

const THEMES = ['light', 'dark'] as const;

interface Pair {
  /** File name stem. */
  name: string;
  route: string;
  /** Screen name in the design file plus extra screen props. */
  design: string;
  designAttrs?: Record<string, string>;
  /** Opens the first row's detail drawer in the app before capturing. */
  openDrawer?: boolean;
  parts?: number;
}

/** Long pages: capture the top, then scroll by 90% of the viewport, up to this many frames. */
const MAX_PARTS = 4;

const PAIRS: Pair[] = [
  { name: 'opportunities', route: 'opportunities', design: 'opportunities' },
  {
    name: 'drawer',
    route: 'opportunities',
    design: 'opportunities',
    designAttrs: { drawer: 'hf1' },
    openDrawer: true,
  },
  { name: 'settings', route: 'settings', design: 'settings' },
  { name: 'components', route: 'components', design: 'components', parts: MAX_PARTS },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loaded(wc: WebContents): Promise<void> {
  if (wc.isLoading()) await new Promise<void>((r) => wc.once('did-finish-load', () => r()));
}

async function waitFor(wc: WebContents, expr: string, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await wc.executeJavaScript(expr).catch(() => false)) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for: ${expr}`);
}

async function capture(win: BrowserWindow, file: string): Promise<void> {
  const image = await win.webContents.capturePage();
  writeFileSync(file, image.toPNG());
  console.log(`[shot] ${file}`);
}

async function captureParts(
  win: BrowserWindow,
  scroller: string,
  base: string,
  parts: number,
): Promise<void> {
  for (let i = 0; i < parts; i++) {
    const atEnd = await win.webContents.executeJavaScript(`(() => {
      const s = ${scroller};
      if (!s) return true;
      const max = s.scrollHeight - s.clientHeight;
      if (${i} > 0 && s.scrollTop >= max) return true;
      s.scrollTop = ${i} * Math.round(s.clientHeight * 0.9);
      return false;
    })()`);
    if (atEnd) break;
    await sleep(300);
    await capture(win, `${base}${i === 0 ? '' : `-${i + 1}`}.png`);
  }
}

export async function runShots(appWin: BrowserWindow): Promise<void> {
  const root = app.getAppPath();
  const out = join(root, 'shots');
  const harnessDir = join(out, '.design');
  mkdirSync(harnessDir, { recursive: true });

  // --- App ---
  const wc = appWin.webContents;
  await loaded(wc);
  if (!appWin.isVisible()) {
    appWin.maximize();
    appWin.show();
  }
  await sleep(600);
  const [width = 1440, height = 900] = appWin.getContentSize();
  console.log(`[shot] capturing at ${width}x${height}`);

  // The throwaway profile is empty; the dev sample fills the Opportunities page.
  await wc.executeJavaScript('window.radar.dev.loadSampleData()');

  for (const theme of THEMES) {
    await wc.executeJavaScript(`window.radar.settings.set('theme', '${theme}')`);
    wc.reload();
    await loaded(wc);
    await waitFor(wc, `document.documentElement.dataset.theme === '${theme}'`, 10_000);
    for (const pair of PAIRS) {
      await wc.executeJavaScript(`location.hash = '#/${pair.route}'`);
      await waitFor(wc, `!!document.querySelector('main h1')`, 10_000);
      if (pair.route === 'opportunities') {
        await waitFor(
          wc,
          `!!document.querySelector('[role="table"] [role="row"][aria-label]')`,
          10_000,
        );
      }
      if (pair.openDrawer) {
        await wc.executeJavaScript(
          `document.querySelector('[role="table"] [role="row"][aria-label]').click()`,
        );
        await waitFor(wc, `!!document.querySelector('[role="dialog"] h2')`, 10_000);
      }
      await wc.executeJavaScript('document.fonts.ready.then(() => true)');
      await sleep(900); // score rings count up for 600 ms
      await captureParts(
        appWin,
        "document.querySelector('main')",
        join(out, `app-${pair.name}-${theme}`),
        pair.parts ?? 1,
      );
      if (pair.openDrawer) {
        await wc.executeJavaScript(
          `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`,
        );
      }
    }
  }

  // --- Design ---
  const bundle = readFileSync(join(root, 'design', 'Radar Overview.html'), 'utf8');
  const designWin = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    x: 0,
    y: 0,
    frame: false,
    show: true,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  try {
    for (const theme of THEMES) {
      for (const pair of PAIRS) {
        const file = join(harnessDir, `${pair.name}-${theme}.html`);
        writeFileSync(
          file,
          buildDesignHarness(bundle, {
            screen: pair.design,
            theme,
            width,
            attrs: pair.designAttrs,
          }),
        );
        await designWin.loadFile(file);
        await waitFor(designWin.webContents, `document.body.innerText.length > 200`, 20_000);
        await waitFor(designWin.webContents, `document.fonts.status === 'loaded'`, 10_000);
        await sleep(1500); // lucide icons resolve asynchronously
        await captureParts(
          designWin,
          'document.scrollingElement',
          join(out, `design-${pair.name}-${theme}`),
          pair.parts ?? 1,
        );
      }
    }
  } finally {
    designWin.destroy();
  }

  writeFileSync(join(out, 'compare.html'), compareHtml(width));
  console.log(`[shot] open ${join(out, 'compare.html')}`);
}

function compareHtml(width: number): string {
  const img = (name: string) => `<img src="${name}.png" onerror="this.replaceWith('(none)')">`;
  const rows = THEMES.flatMap((theme) =>
    PAIRS.flatMap(({ name, parts }) =>
      Array.from({ length: parts ?? 1 }, (_, i) => {
        const part = i === 0 ? '' : `-${i + 1}`;
        return `
  <h2>${name}${part} · ${theme}</h2>
  <div class="pair">
    <figure><figcaption>App</figcaption>${img(`app-${name}-${theme}${part}`)}</figure>
    <figure><figcaption>Design</figcaption>${img(`design-${name}-${theme}${part}`)}</figure>
  </div>`;
      }),
    ),
  ).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Radar shots</title>
<style>
  body{font:14px system-ui,sans-serif;margin:24px;background:#e4e5e9;color:#1d1d1f}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:40px}
  figure{margin:0} figcaption{font-weight:600;margin-bottom:6px}
  img{width:100%;border:1px solid #c8c8cc;background:#fff}
</style>
<h1>App vs design at ${width}px</h1>
${rows}`;
}
