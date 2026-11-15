import { expect, test } from '@playwright/test';
import { expectAccessible, passMfa, signIn, snap } from './helpers';

/** Phase 4: the doctor signs a care plan and the month's APCM list shows what can be billed and why. */
test.describe.serial('care plan and APCM billing', () => {
  test.skip(({ isMobile }) => isMobile, 'desk workflow, run once on desktop');

  test('draft and sign Raj’s care plan; his November becomes billable with evidence', async ({
    page,
  }, info) => {
    await signIn(page, 'dr.rao@demo.tomoni.test');
    await passMfa(page, 'dr.rao@demo.tomoni.test');

    // Before a signed plan, the month is checked but not billable, and says why.
    await page.getByRole('link', { name: 'APCM billing' }).click();
    await page.getByRole('button', { name: 'Check this month' }).click();
    const raj = page.locator('tr').filter({ hasText: 'Raj Patel' });
    await expect(raj).toContainText('Not billable');
    await expect(raj).toContainText('no signed care plan');
    await expectAccessible(page);

    await raj.getByRole('link', { name: 'Raj Patel' }).click();
    await page.getByRole('button', { name: 'Draft care plan' }).click();
    const plan = page.locator('[data-plan-status="draft"]');
    await expect(plan).toContainText('Clopidogrel 75 mg tablet');
    await expect(plan).toContainText('Asha Patel (daughter)');
    await expectAccessible(page);
    await snap(page, info, 'desk-patient-plan');
    await plan.getByRole('button', { name: 'Sign care plan' }).click();
    await expect(page.locator('[data-plan-status="signed"]')).toContainText('Version 1, signed');

    await page.getByRole('link', { name: 'APCM billing' }).click();
    await page.getByRole('button', { name: 'Check this month' }).click();
    await expect(raj).toContainText('Ready to bill');
    await expect(raj).toContainText('G0557');
    await expect(raj).toContainText('$53.78');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export evidence (CSV)' }).click();
    expect((await download).suggestedFilename()).toBe('apcm-2026-11.csv');
    await snap(page, info, 'desk-billing');

    await page.getByRole('link', { name: 'Practice report' }).click();
    await expect(page.locator('[data-metric="revenue"]')).not.toContainText('$0.00');
    await expectAccessible(page);
  });

  test('keyboard first: x selects, Shift+S signs, with evidence beside the queue', async ({ page }, info) => {
    await signIn(page, 'dr.rao@demo.tomoni.test');
    await passMfa(page, 'dr.rao@demo.tomoni.test');
    // Raj gets version 2 of his plan to sign.
    await page.goto('/desk/billing');
    await page
      .locator('tr')
      .filter({ hasText: 'Raj Patel' })
      .getByRole('link', { name: 'Raj Patel' })
      .click();
    await page.getByRole('button', { name: 'Draft care plan' }).click();
    await expect(page.locator('[data-plan-status="draft"]')).toBeVisible();

    await page.getByRole('link', { name: 'Queue' }).click();
    const row = page.locator('li[data-plan="draft"]').filter({ hasText: 'Raj Patel' });
    await row.click({ position: { x: 5, y: 5 } });
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-evidence="care_plan"]')).toContainText('Clopidogrel 75 mg tablet');
    await expectAccessible(page);
    await snap(page, info, 'desk-queue');
    await page.keyboard.press('x');
    await expect(page.getByText('1 item selected. Shift+S signs them.')).toBeVisible();
    await page.keyboard.press('Shift+S');
    await expect(row).toHaveCount(0);
  });
});
