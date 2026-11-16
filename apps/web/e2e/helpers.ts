import { expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { generate } from 'otplib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const PASSWORD = 'tomoni-demo-2026';

export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/**
 * MFA state shared across Playwright workers/projects through a file: the secret captured at
 * enrollment and the last time step used (the API rejects a step that was already claimed).
 */
const STATE = 'e2e/.state/mfa.json';
type MfaState = Record<string, { secret: string; lastStep: number }>;
const load = (): MfaState => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
const save = (s: MfaState) => {
  mkdirSync('e2e/.state', { recursive: true });
  writeFileSync(STATE, JSON.stringify(s));
};
export const resetMfaState = () => save({});

/** Enroll on first sign-in (reads the manual key off the page), or verify with an unused code. */
export async function passMfa(page: Page, email: string) {
  await page.waitForURL('**/mfa');
  const state = load();
  if (!state[email]) {
    const key = page.locator('code');
    await expect(key).toBeVisible();
    state[email] = { secret: (await key.innerText()).replace(/\s/g, ''), lastStep: 0 };
  }
  const entry = state[email];
  let now = Math.floor(Date.now() / 30_000);
  // The API accepts now±1; take the earliest unused step from now on, waiting if both are spent.
  while (entry.lastStep >= now + 1) {
    await page.waitForTimeout(2_000);
    now = Math.floor(Date.now() / 30_000);
  }
  // Never the previous step: a 30 s boundary between generating and checking would expire it.
  const step = Math.max(now, entry.lastStep + 1);
  const code = await generate({ secret: entry.secret, epoch: step * 30 + 1 });
  entry.lastStep = step;
  save(state);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/mfa'));
}

/** WCAG 2.2 AA scan; fails the test on any violation. */
export async function expectAccessible(page: Page) {
  // After a client-side navigation the URL changes before Next streams the new <title> in.
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
    [],
  );
}

/** Screenshot for design review; one per screen per project (desktop/mobile). */
export async function snap(page: Page, info: TestInfo, name: string) {
  await page.waitForLoadState('networkidle');
  await page.screenshot({
    path: `e2e/__screens__/${info.project.name}/${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

export async function expectSandboxBadge(page: Page) {
  await expect(page.getByTestId('sandbox-badge')).toBeVisible();
}
