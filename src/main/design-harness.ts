// Builds a standalone page that renders one screen of the Claude Design bundle
// (design/Radar Overview.html) at a given width, for side-by-side screenshots. No Electron imports.

export interface HarnessOptions {
  screen: string;
  theme: 'light' | 'dark';
  width: number;
}

const TEMPLATE_BLOCK = /(<script type="__bundler\/template">)([\s\S]*?)(<\/script>)/;
const BODY = /<\/helmet>[\s\S]*<\/x-dc>/;

/**
 * The bundle stores the page as a JSON string in a `__bundler/template` script. We keep the
 * <helmet> (fonts, base styles) and replace the canvas with a single embedded Radar screen.
 */
export function buildDesignHarness(bundleHtml: string, o: HarnessOptions): string {
  const match = TEMPLATE_BLOCK.exec(bundleHtml);
  if (!match?.[2]) throw new Error('Design bundle has no __bundler/template block');
  const template: unknown = JSON.parse(match[2]);
  if (typeof template !== 'string' || !BODY.test(template)) {
    throw new Error('Design template has an unexpected shape (no <helmet> … </x-dc>)');
  }
  const screen =
    `</helmet><dc-import name="Radar" screen="${o.screen}" theme="${o.theme}" ` +
    `embedded="true" width="${o.width}" hint-size="${o.width}px,900px"></dc-import></x-dc>`;
  const replaced = template.replace(BODY, () => screen);
  // Same escaping as the bundler: never emit a literal "</" inside the script element.
  const json = JSON.stringify(replaced).replace(/<\//g, '<\\u002F');
  return bundleHtml.replace(
    TEMPLATE_BLOCK,
    (_m, open: string, _body, close: string) => open + json + close,
  );
}
