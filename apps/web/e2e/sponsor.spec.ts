import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectSandboxBadge, PASSWORD, passMfa, snap } from './helpers';

const PORTAL = 'http://localhost:3101';

async function signInPortal(page: Page, email: string) {
  await page.goto(`${PORTAL}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login') || u.search.includes('notPartner'));
}

test.describe('sponsor portal (separate origin, D-002)', () => {
  test('sponsor signs in with MFA and sees only the aggregate shell', async ({ page }, info) => {
    await signInPortal(page, 'sponsor@demo.tomoni.test');
    await passMfa(page, 'sponsor@demo.tomoni.test');
    await expect(page).toHaveURL(`${PORTAL}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Research partner portal');
    await expect(page.getByText('Groups smaller than 11 people are never shown')).toBeVisible();
    await expectSandboxBadge(page);
    await expectAccessible(page);
    await snap(page, info, 'sponsor-home');
  });

  test('a family account is turned away, not looped', async ({ page }) => {
    await signInPortal(page, 'asha@demo.tomoni.test');
    await expect(page).toHaveURL(/\/login\?notPartner=1$/);
    await expect(page.getByRole('status').filter({ hasText: 'research partners only' })).toBeVisible();
  });

  test('the care API is not reachable through the portal origin', async ({ request }) => {
    const res = await request.get(`${PORTAL}/api/family/card`);
    expect(res.status()).toBe(404); // not proxied at all
  });
});
