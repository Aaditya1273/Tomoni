import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, passMfa, signIn, snap } from './helpers';

/** BUILD_PROMPT §5.3 and rule 2.3: families tap to approve, doctors sign, the worker confirms → does → verifies. */
test.describe.serial('agent actions', () => {
  test.skip(({ isMobile }) => isMobile, 'state-changing flow, run once on desktop');

  const raj = (page: Page) => page.locator('section[data-patient="Raj-bhai"]');
  const kokila = (page: Page) => page.locator('section[data-patient="Kokila Patel"]');

  test('a pharmacy transfer waits for the family’s one tap, then the worker does and verifies it', async ({
    page,
  }, info) => {
    await signIn(page, 'asha@demo.tomoni.test');
    const closure = kokila(page).locator('li[data-warning="pharmacy_closure"]');
    await closure.getByRole('button', { name: 'Ask Tomoni to help' }).click();
    // Two medicines at the closing pharmacy: two transfers, each its own tap (the card once hid one).
    const ask = closure.locator('[data-action="needs-you"]');
    await expect(ask).toHaveCount(2);
    for (const drug of ['Levothyroxine', 'Losartan'])
      await expect(ask.filter({ hasText: `Move ${drug}` })).toContainText(
        /to Main Street Pharmacy\? Tomoni will contact both pharmacies/,
      );
    await expectAccessible(page);
    await snap(page, info, 'family-approval');
    for (const drug of ['Levothyroxine', 'Losartan'])
      await ask
        .filter({ hasText: `Move ${drug}` })
        .getByRole('button', { name: 'Approve' })
        .click();
    await expect(closure.locator('[data-action="succeeded"]')).toHaveCount(2, { timeout: 15_000 });
    await expect(closure.locator('[data-action="succeeded"]').first()).toHaveText(
      'Moved to Main Street Pharmacy.',
    );
  });

  test('a renewal goes to the doctor; once signed, the family sees it done', async ({ page, browser }) => {
    await signIn(page, 'asha@demo.tomoni.test');
    const runOut = raj(page).locator('li[data-warning="run_out"]');
    await runOut.getByRole('button', { name: 'Ask Tomoni to help' }).click();
    await expect(runOut).toContainText('Waiting for the doctor to sign.');

    const doc = await (await browser.newContext()).newPage();
    await signIn(doc, 'dr.rao@demo.tomoni.test');
    await passMfa(doc, 'dr.rao@demo.tomoni.test');
    const item = doc
      .locator('li[data-approval="draftRenewalForDoctor"]')
      .filter({ hasText: 'Renew Clopidogrel 75 mg tablet' });
    await expect(item).toBeVisible();
    await expectAccessible(doc);
    await item.getByRole('button', { name: 'Sign' }).click();
    await expect(item).toHaveCount(0);

    await expect(runOut.locator('[data-action="succeeded"]')).toHaveText(
      "The doctor signed the renewal. It's on its way to the pharmacy.",
      { timeout: 15_000 },
    );
  });
});
