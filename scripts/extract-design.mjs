// Unpacks a Claude Design "Bundled Page" HTML: writes the template and every manifest asset.
// Usage: node scripts/extract-design.mjs "design/Radar Overview.html" <outDir>
// Then search <outDir>/<uuid>.html (Radar.dc.html) for `TH = {` (tokens) and `isComponents` (component specs).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [src, outDir] = process.argv.slice(2);
const html = fs.readFileSync(src, 'utf8');
const block = (type) => {
  const m = html.match(new RegExp(`<script type="__bundler/${type}">([\\s\\S]*?)</script>`));
  return m ? JSON.parse(m[1]) : null;
};
const manifest = block('manifest');
const template = block('template');
const pageOrder = block('page_order') || [];
const ext = block('ext_resources') || [];

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'template.html'), template);
const extOf = (mime) =>
  ({
    'text/javascript': 'js',
    'application/javascript': 'js',
    'text/css': 'css',
    'text/html': 'html',
    'font/woff2': 'woff2',
    'font/woff': 'woff',
    'font/ttf': 'ttf',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/jpeg': 'jpg',
    'text/babel': 'jsx',
    'text/jsx': 'jsx',
  })[mime] || 'bin';
for (const [uuid, e] of Object.entries(manifest)) {
  let bytes = Buffer.from(e.data, 'base64');
  if (e.compressed) bytes = zlib.gunzipSync(bytes);
  const name = `${uuid}.${pageOrder.includes(uuid) ? 'page.html' : extOf(e.mime)}`;
  fs.writeFileSync(path.join(outDir, name), bytes);
  console.log(`${name}\t${e.mime}\t${bytes.length}`);
}
console.log('ext_resources:', JSON.stringify(ext));
console.log('page_order:', JSON.stringify(pageOrder));
console.log('template bytes:', template.length);
