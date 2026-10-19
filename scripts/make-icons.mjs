// Renders Radar's app icon from vector art into every file the platforms need.
// Run: npm run icons   (Electron's Chromium draws the SVG at each size; no other tool needed)
//
// Writes to resources/:
//   icon.svg        the master (full-bleed tile)
//   icon.png        512 px, window and taskbar icon on Windows and Linux
//   icon.ico        16-256 px (Windows), PNG entries
//   icon.icns       16-1024 px (macOS), the tile on Apple's icon grid with its shadow
//   tray.png        16 px + tray@2x.png 32 px, the tray icon (Electron picks @2x on HiDPI)
//
// Brand colors follow --brand-from / --brand-to in tokens.css.
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
const BRAND_FROM = '#2d9bff';
const BRAND_TO = '#0a6cdb';

/**
 * The icon at `size` px. `grid`: macOS layout (the tile is 824/1024 of the canvas with room for a
 * shadow). `small` (32 px and under): only the ring and dot, thicker, so they stay crisp.
 */
function svg(size, { grid = false, small = size <= 32 } = {}) {
  const S = 1024;
  const inset = grid ? 100 : 0;
  const tile = S - inset * 2;
  const r = tile * 0.225; // the macOS icon corner (22.5 %), as --radius-icon
  const c = S / 2;
  const ring = small ? { r: 238, w: 104 } : { r: 214, w: 62 };
  const dot = small ? 92 : 70;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BRAND_FROM}"/>
      <stop offset="1" stop-color="${BRAND_TO}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0" r="0.9">
      <stop offset="0" stop-color="#fff" stop-opacity="0.34"/>
      <stop offset="0.55" stop-color="#fff" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <!-- Across the sweep: clear at its trailing edge, brightest at the leading one. -->
    <linearGradient id="beam" gradientUnits="userSpaceOnUse" x1="${c + 190}" y1="${c - 250}" x2="${c + 300}" y2="${c}">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.75" stop-color="#fff" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0.26"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.45"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0.18"/>
    </linearGradient>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="${small ? 0 : 14}" stdDeviation="${small ? 0 : 18}" flood-color="#002a66" flood-opacity="${small ? 0 : 0.35}"/>
    </filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000" flood-opacity="0.28"/>
    </filter>
    <clipPath id="tile"><rect x="${inset}" y="${inset}" width="${tile}" height="${tile}" rx="${r}"/></clipPath>
  </defs>
  <g ${grid ? 'filter="url(#shadow)"' : ''}>
    <rect x="${inset}" y="${inset}" width="${tile}" height="${tile}" rx="${r}" fill="url(#bg)"/>
  </g>
  <g clip-path="url(#tile)">
    <rect x="${inset}" y="${inset}" width="${tile}" height="${tile}" fill="url(#glow)"/>
    ${
      small
        ? ''
        : `<circle cx="${c}" cy="${c}" r="352" fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="10"/>
    <path d="M ${c} ${c} L ${c + 352 * Math.cos(-Math.PI / 4)} ${c + 352 * Math.sin(-Math.PI / 4)} A 352 352 0 0 1 ${c + 352} ${c} Z" fill="url(#beam)" transform="rotate(-8 ${c} ${c})"/>`
    }
  </g>
  <g filter="url(#lift)">
    <circle cx="${c}" cy="${c}" r="${ring.r}" fill="none" stroke="#fff" stroke-width="${ring.w}"/>
    <circle cx="${c}" cy="${c}" r="${dot}" fill="#fff"/>
  </g>
  ${
    small
      ? ''
      : `<rect x="${inset + 3}" y="${inset + 3}" width="${tile - 6}" height="${tile - 6}" rx="${r - 3}" fill="none" stroke="url(#edge)" stroke-width="6"/>`
  }
</svg>`;
}

/** One transparent offscreen page; each size is drawn at its top-left corner and captured. */
let canvas = null;

/** PNG bytes of `markup` drawn at exactly size x size. */
async function render(markup, size) {
  canvas ??= new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${markup}</body></html>`;
  await canvas.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 150));
  let image = await canvas.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  const got = image.getSize();
  if (got.width !== size || got.height !== size) {
    image = image.resize({ width: size, height: size, quality: 'best' });
  }
  return image.toPNG();
}

/** ICO with PNG entries (Windows Vista and later). */
function ico(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

/** ICNS with PNG entries (OSType per pixel size). */
function icns(entries) {
  const parts = entries.map(({ type, png }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

app
  .whenReady()
  .then(main)
  .catch((err) => {
    console.error('[icons] failed:', err);
    app.exit(1);
  });

async function main() {
  mkdirSync(OUT, { recursive: true });
  const cache = new Map();
  const png = async (size, opts = {}) => {
    const key = `${size}:${JSON.stringify(opts)}`;
    if (!cache.has(key)) cache.set(key, await render(svg(size, opts), size));
    return cache.get(key);
  };

  writeFileSync(join(OUT, 'icon.svg'), svg(1024));
  writeFileSync(join(OUT, 'icon.png'), await png(512));

  const icoEntries = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256])
    icoEntries.push({ size, png: await png(size) });
  writeFileSync(join(OUT, 'icon.ico'), ico(icoEntries));

  const mac = [
    ['icp4', 16],
    ['icp5', 32],
    ['ic11', 32],
    ['ic12', 64],
    ['ic07', 128],
    ['ic13', 256],
    ['ic08', 256],
    ['ic14', 512],
    ['ic09', 512],
    ['ic10', 1024],
  ];
  const macEntries = [];
  for (const [type, size] of mac) macEntries.push({ type, png: await png(size, { grid: true }) });
  writeFileSync(join(OUT, 'icon.icns'), icns(macEntries));

  writeFileSync(join(OUT, 'tray.png'), await png(16));
  writeFileSync(join(OUT, 'tray@2x.png'), await png(32));

  // Previews for checking by eye (not shipped): large, medium and the small variants.
  writeFileSync(join(OUT, '..', 'shots', 'icon-preview-1024.png'), await png(1024));
  writeFileSync(
    join(OUT, '..', 'shots', 'icon-preview-mac-512.png'),
    await png(512, { grid: true }),
  );
  for (const s of [16, 32, 48, 64]) {
    writeFileSync(join(OUT, '..', 'shots', `icon-preview-${s}.png`), await png(s));
  }
  console.log(`icons written to ${OUT}`);
  canvas?.destroy();
  app.quit();
}
