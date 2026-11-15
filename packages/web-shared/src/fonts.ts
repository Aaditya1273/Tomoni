// Generated from fonts/manifest.json (Anek by Ek Type, SIL OFL 1.1; see fonts/OFL.txt).
// Self-hosted so builds need no network and no font request ever leaves our origin.
// Each script's file loads only when a page uses that script (unicode-range).
import localFont from 'next/font/local';

const latin = localFont({
  src: [{ path: '../fonts/anek-latin-latin.woff2', weight: '100 800', style: 'normal' }],
  variable: '--font-anek-latin',
  display: 'swap',
  preload: true,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
    { prop: 'font-stretch', value: '75% 125%' },
  ],
});

const devanagari = localFont({
  src: [{ path: '../fonts/anek-devanagari-devanagari.woff2', weight: '100 800', style: 'normal' }],
  variable: '--font-anek-devanagari',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0900-097F, U+1CD0-1CF4, U+1CF7-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B0A',
    },
    { prop: 'font-stretch', value: '75% 125%' },
  ],
});

const gujarati = localFont({
  src: [{ path: '../fonts/anek-gujarati-gujarati.woff2', weight: '100 800', style: 'normal' }],
  variable: '--font-anek-gujarati',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+0951-0952, U+0964-0965, U+0A80-0AFF, U+200C-200D, U+20B9, U+25CC, U+A830-A839',
    },
    { prop: 'font-stretch', value: '75% 125%' },
  ],
});

const gurmukhi = localFont({
  src: [{ path: '../fonts/anek-gurmukhi-gurmukhi.woff2', weight: '100 800', style: 'normal' }],
  variable: '--font-anek-gurmukhi',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+0951-0952, U+0964-0965, U+0A01-0A76, U+200C-200D, U+20B9, U+25CC, U+262C, U+A830-A839',
    },
    { prop: 'font-stretch', value: '75% 125%' },
  ],
});

const tamil = localFont({
  src: [{ path: '../fonts/anek-tamil-tamil.woff2', weight: '100 800', style: 'normal' }],
  variable: '--font-anek-tamil',
  display: 'swap',
  preload: false,
  declarations: [
    { prop: 'unicode-range', value: 'U+0964-0965, U+0B82-0BFA, U+200C-200D, U+20B9, U+25CC' },
    { prop: 'font-stretch', value: '75% 125%' },
  ],
});

const bangla = localFont({
  src: [{ path: '../fonts/anek-bangla-bengali.woff2', weight: '100 800', style: 'normal' }],
  variable: '--font-anek-bangla',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0951-0952, U+0964-0965, U+0980-09FE, U+1CD0, U+1CD2, U+1CD5-1CD6, U+1CD8, U+1CE1, U+1CEA, U+1CED, U+1CF2, U+1CF5-1CF7, U+200C-200D, U+20B9, U+25CC, U+A8F1, U+11DF0-11DF1',
    },
    { prop: 'font-stretch', value: '75% 125%' },
  ],
});

export const fontVariables = [latin, devanagari, gujarati, gurmukhi, tamil, bangla]
  .map((f) => f.variable)
  .join(' ');
