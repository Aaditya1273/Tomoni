import { expect, test } from '@playwright/test';
import { expectAccessible, expectSandboxBadge, passMfa, signIn, snap } from './helpers';

test.describe('sign-in and role routing (Phase 1 DoD)', () => {
  test('login screen: accessible, sandbox badge, strict CSP', async ({ page }, info) => {
    const res = await page.goto('/login');
    const csp = res!.headers()['content-security-policy']!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    await expectSandboxBadge(page);
    // A submit before hydration must POST, never put the password in the URL.
    await expect(page.locator('form')).toHaveAttribute('method', 'post');
    await expectAccessible(page);
    await snap(page, info, 'login');
  });

  test('wrong password shows a plain-language error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('asha@demo.tomoni.test');
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "don't match" })).toBeVisible();
    await expectAccessible(page);
  });

  for (const email of ['asha@demo.tomoni.test', 'raj@demo.tomoni.test']) {
    test(`family side: ${email} lands on the family card, no MFA`, async ({ page }, info) => {
      await signIn(page, email);
      await expect(page).toHaveURL(/\/family$/);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        email.startsWith('asha') ? 'Asha' : 'Raj',
      );
      await expectSandboxBadge(page);
      await expectAccessible(page);
      await snap(page, info, `family-${email.split('@')[0]}`);
    });
  }

  const staff: [string, string, RegExp][] = [
    ['dr.rao@demo.tomoni.test', 'desk', /\/desk$/],
    ['nurse.priya@demo.tomoni.test', 'desk', /\/desk$/],
    ['frontdesk@demo.tomoni.test', 'desk', /\/desk$/],
    ['ops.kiran@demo.tomoni.test', 'ops', /\/ops$/],
    ['research@demo.tomoni.test', 'research', /\/research$/],
    ['admin@demo.tomoni.test', 'admin', /\/admin\/data$/],
  ];
  for (const [email, surface, url] of staff) {
    test(`${surface}: ${email} must pass MFA, then lands on ${surface}`, async ({ page }, info) => {
      await signIn(page, email);
      await expectAccessible(page); // the MFA screen itself
      await snap(page, info, `mfa-${email.split('@')[0]}`);
      await passMfa(page, email);
      await expect(page).toHaveURL(url);
      // A URL alone once let a blank admin page pass: the page must render its main content.
      await expect(page.locator('main#main h1')).toBeVisible();
      await expectSandboxBadge(page);
      await expectAccessible(page);
      await snap(page, info, `${surface}-${email.split('@')[0]}`);
    });
  }

  test('staff cannot reach data pages before MFA', async ({ page }) => {
    await signIn(page, 'nurse.priya@demo.tomoni.test');
    await page.goto('/desk');
    await expect(page).toHaveURL(/\/mfa$/);
  });

  test('a family member cannot open the desk', async ({ page }) => {
    await signIn(page, 'asha@demo.tomoni.test');
    await page.goto('/desk');
    await expect(page).toHaveURL(/\/family$/);
  });

  test('a sponsor account is sent to its own portal', async ({ page }) => {
    await signIn(page, 'sponsor@demo.tomoni.test');
    await passMfa(page, 'sponsor@demo.tomoni.test');
    await expect(page).toHaveURL(/\/login\?wrongApp=1$/);
    await expect(page.getByRole('status').filter({ hasText: 'research partner portal' })).toBeVisible();
  });

  test('sign out ends the session', async ({ page }) => {
    await signIn(page, 'asha@demo.tomoni.test');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/family');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('preferences', () => {
  test('Hindi, dark theme and larger text persist across reloads', async ({ page }, info) => {
    await signIn(page, 'asha@demo.tomoni.test');
    await page.getByRole('combobox').selectOption('hi');
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Asha');
    await expect(page.getByRole('button', { name: 'साइन आउट करें' })).toBeVisible();
    await page.getByRole('radio', { name: 'गहरा' }).click();
    await page.getByRole('button', { name: 'बड़े अक्षर' }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-text', 'large');
    await expectAccessible(page);
    await snap(page, info, 'family-hindi-dark-large');
  });
});

test.describe('desk keyboard', () => {
  test('"?" opens the shortcut list', async ({ page }) => {
    await signIn(page, 'dr.rao@demo.tomoni.test');
    await passMfa(page, 'dr.rao@demo.tomoni.test');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    // The key listener attaches on hydration; retry the press until it has.
    await expect(async () => {
      if (!(await dialog.isVisible())) await page.keyboard.press('?');
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
