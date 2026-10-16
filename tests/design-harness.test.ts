import { describe, expect, it } from 'vitest';
import { buildDesignHarness } from '../src/main/design-harness';

const template =
  '<html><head></head><body><x-dc><helmet><style>a{}</style></helmet><div>canvas</div></x-dc></body></html>';
const bundle = (tpl: string) =>
  `<html><script type="__bundler/manifest">{}</script>\n<script type="__bundler/template">\n${JSON.stringify(tpl).replace(/<\//g, '<\\u002F')}\n</script></html>`;

function templateOf(html: string): string {
  const m = /<script type="__bundler\/template">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m![1]!) as string;
}

describe('design harness', () => {
  it('replaces the canvas with one screen and keeps the helmet', () => {
    const out = buildDesignHarness(bundle(template), {
      screen: 'settings',
      theme: 'dark',
      width: 1920,
    });
    const t = templateOf(out);
    expect(t).toContain('<helmet><style>a{}</style></helmet>');
    expect(t).toContain('screen="settings" theme="dark" embedded="true" width="1920"');
    expect(t).not.toContain('canvas');
    expect(out).toContain('<script type="__bundler/manifest">{}</script>');
  });

  it('never emits a literal closing tag inside the template script', () => {
    const out = buildDesignHarness(bundle(template), {
      screen: 'opportunities',
      theme: 'light',
      width: 1440,
    });
    const script = /<script type="__bundler\/template">([\s\S]*?)<\/script>/.exec(out)![1]!;
    expect(script).not.toContain('</');
  });

  it('fails loudly on an unexpected file', () => {
    expect(() =>
      buildDesignHarness('<html></html>', { screen: 's', theme: 'light', width: 1 }),
    ).toThrow(/no __bundler\/template/);
    expect(() =>
      buildDesignHarness(bundle('<html>no canvas</html>'), {
        screen: 's',
        theme: 'light',
        width: 1,
      }),
    ).toThrow(/unexpected shape/);
  });
});
