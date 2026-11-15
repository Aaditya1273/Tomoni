/**
 * Text normalization before matching (BUILD_PROMPT rule 2.1, SECURITY "language mixing").
 * Defeats the cheap ways a phrase can slip past: Unicode forms, zero-width characters,
 * look-alike letters from other scripts, Latin accents, punctuation and spacing tricks,
 * and spelling variants of Indic marks (nukta, chandrabindu).
 */

// Cyrillic and Greek letters that render like Latin ones.
const HOMOGLYPHS: Record<string, string> = {
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ӏ: 'l',
  α: 'a',
  ο: 'o',
  ρ: 'p',
  ν: 'v',
  τ: 't',
  ι: 'i',
  κ: 'k',
  υ: 'u',
};
const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join('')}]`, 'g');

export function normalizeText(input: string): string {
  return (
    input
      .normalize('NFKC')
      .toLowerCase()
      // zero-width space/joiners, soft hyphen, word joiner, BOM
      .replace(/[​-‍­⁠﻿]/g, '')
      .replace(HOMOGLYPH_RE, (c) => HOMOGLYPHS[c] ?? c)
      // Latin accents only: NFD splits them off; Indic vowel signs are left alone.
      .normalize('NFD')
      .replace(/([a-z])[̀-ͯ]+/g, '$1')
      .normalize('NFC')
      // Indic spelling variants: drop nukta; chandrabindu and tippi count as anusvara/bindi.
      .replace(/[़়਼઼଼]/g, '')
      .replace(/ँ/g, 'ं')
      .replace(/ঁ/g, 'ং')
      .replace(/[ੰਁ]/g, 'ਂ')
      .replace(/ઁ/g, 'ં')
      // ASCII apostrophes inside words ("can't" ~ "cant"), then everything else non-letter → space.
      .replace(/(\p{L})['’`](\p{L})/gu, '$1$2')
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
      .trim()
  );
}
