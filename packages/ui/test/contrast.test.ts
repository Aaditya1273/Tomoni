import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Keeps docs/DESIGN.md's contrast promise: every text pair ≥ 4.5:1, control borders ≥ 3:1. */
const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--t-([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]),
  );
}

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const themes = { light: block(':root'), dark: block(":root[data-theme='dark']") };

describe.each(Object.entries(themes))('%s theme', (_name, t) => {
  it.each(['ink', 'muted', 'neel', 'jamun', 'ok', 'watch', 'act'])(
    '%s text is AA on paper and surface',
    (fg) => {
      expect(ratio(t[fg]!, t.paper!)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t[fg]!, t.surface!)).toBeGreaterThanOrEqual(4.5);
    },
  );
  it.each(['ok', 'watch', 'act'])('%s is AA on its own tint', (s) => {
    expect(ratio(t[s]!, t[`${s}-bg`]!)).toBeGreaterThanOrEqual(4.5);
  });
  it('primary button text is AA', () => {
    expect(ratio(t['neel-ink']!, t.neel!)).toBeGreaterThanOrEqual(4.5);
  });
  it('control borders are ≥ 3:1 (WCAG 1.4.11)', () => {
    expect(ratio(t['line-strong']!, t.surface!)).toBeGreaterThanOrEqual(3);
  });
  it('the media-query dark block matches the explicit dark block', () => {
    const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    for (const [k, v] of Object.entries(themes.dark)) expect(media).toContain(`--t-${k}: ${v}`);
  });
});
