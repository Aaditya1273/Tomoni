# Design system

**One sentence:** Indian indigo ink on cool paper, one Indian-made type family across six scripts, and its width axis tuned to each surface's job.

## Palette

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `paper` | #F4F6FB | #0F1230 | Page background (cool; dark is indigo night, not neutral black) |
| `surface` | #FFFFFF | #181C42 | Raised panels |
| `sunken` | #E9EDF7 | #0B0E26 | Wells, inputs, inactive tracks |
| `ink` | #161B4A | #E9ECFA | Text (15:1) |
| `muted` | #4A5280 | #A9B0D6 | Secondary text (≥ 6.9:1) |
| `line` / `line-strong` | #C9D0E6 / #6E77A6 | #343A6E / #7880B8 | Dividers / control borders (≥ 4:1) |
| `neel` (indigo) | #3341A8 | #9AA5FF | Primary actions, links, focus ring |
| `jamun` (plum) | #7A2F68 | #E39BCF | Family moments: streaks, invites, "together" |
| `ok` / `watch` / `act` | #1D6B45 / #8F5300 / #B3261E | #6FD3A0 / #F2B65A / #FF8A80 | Access Score status, always with an icon and words |

Every text/background pair is at least WCAG AA (4.5:1). Most are at least AAA (7:1). The ratios were measured when the palette was chosen; `packages/ui/test/contrast.test.ts` keeps them.

## Type

**Anek** (Ek Type) in six scripts: Latin, Devanagari, Gujarati, Gurmukhi, Tamil and Bangla. One design voice for every language a family speaks.

The `wdth` axis is set per surface:

| Surface | Width | Base size | Line height | Radius |
| --- | --- | --- | --- | --- |
| Family | 100 (normal) | 18px | 1.55 | 14px |
| Desk / ops | 87.5 (semi-condensed) | 15px | 1.4 | 6px |
| Sponsor | 93.75 | 15px | 1.45 | 8px |

The scale is a 1.25 ratio from the base size. The family app's greeting is the one place type gets loud: large, normal width, tight leading. Everything else stays quiet. Tabular figures go on any column of numbers.

## Principles

1. **Status is never color alone.** An icon, a word and a color, every time.
2. **One primary action per family screen.** The desk can show many, each with its own keyboard shortcut.
3. **Plain words.** "Needs you", not "Action required". "Asha approved the switch", not "Approval recorded".
4. **No decorative chrome.** No eyebrows above headings, no identical card grids, no shadow stacks. Hierarchy comes from tone and space.
5. **Sandbox is loud.** Whenever any adapter is a mock, a fixed SANDBOX badge sits on every screen.
6. **Motion only answers a person's action**, and `prefers-reduced-motion` turns it off.
