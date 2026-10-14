import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, parseHex } from '../../src/design/contrast';
import { color, contrastPairs, lineAlpha } from '../../src/design/tokens';

const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');

describe('design token contrast', () => {
  for (const pair of contrastPairs) {
    it(`${pair.use}: ${pair.fg} on ${pair.bg} ≥ ${pair.min}:1`, () => {
      expect(contrastRatio(parseHex(color[pair.fg]), parseHex(color[pair.bg]))).toBeGreaterThanOrEqual(pair.min);
    });
  }

  it('control boundaries reach 3:1 against every surface', () => {
    const text = parseHex(color.text);
    for (const bg of [color.bg, color.surface, color.inset]) {
      const line = composite(text, lineAlpha.control, parseHex(bg));
      expect(contrastRatio(line, parseHex(bg))).toBeGreaterThanOrEqual(3);
    }
  });

  it('the lime focus ring is visible on every surface', () => {
    for (const bg of [color.bg, color.surface, color.surfaceHover, color.inset]) {
      expect(contrastRatio(parseHex(color.accent), parseHex(bg))).toBeGreaterThanOrEqual(3);
    }
  });

  it('tokens.css matches tokens.ts', () => {
    const vars: Record<string, string> = {
      '--bg': color.bg,
      '--surface': color.surface,
      '--surface-hover': color.surfaceHover,
      '--inset': color.inset,
      '--text': color.text,
      '--text-2': color.text2,
      '--text-3': color.text3,
      '--accent': color.accent,
      '--accent-hover': color.accentHover,
      '--accent-pressed': color.accentPressed,
      '--on-accent': color.onAccent,
      '--alert': color.alert,
    };
    for (const [name, value] of Object.entries(vars)) {
      const m = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css);
      expect(m?.[1]?.toUpperCase(), name).toBe(value.toUpperCase());
    }
    expect(css).toMatch(new RegExp(`--line-control:\\s*rgba\\(243,\\s*243,\\s*233,\\s*${lineAlpha.control}\\)`));
  });
});
