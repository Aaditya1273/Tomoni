import { expect, test } from '@playwright/test';
import { expectAccessible, signIn, snap } from './helpers';

/** Phase 4b Definition of Done: a family abroad sees sourced warnings for a parent in India, and adds medicines. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('Priya, in New Jersey, sees her mother’s medicines in Ahmedabad and adds one from the bill', async ({
  page,
  isMobile,
}, info) => {
  await signIn(page, 'priya@demo.tomoni.test');
  const sunita = page.locator('section[data-patient="Sunita-ben"]');
  const telmisartan = sunita.locator('li[data-warning="run_out"]').filter({ hasText: 'Telmisartan' });
  await expect(telmisartan).toContainText('Telmisartan 40 mg runs out in 9 days and has no refills left.');
  await expect(telmisartan).toContainText('Entered by the family, filled Oct 25');
  await expect(sunita.locator('li[data-warning="late_refill"]')).toContainText('Atorvastatin 10 mg ran out');
  await expect(sunita.getByRole('button', { name: /Connect Medicare/ })).toHaveCount(0);
  await expectAccessible(page);
  await snap(page, info, 'family-india');
  test.skip(isMobile, 'adding is state-changing; run once');

  await sunita.getByRole('button', { name: 'Add a medicine' }).click();
  await sunita.getByLabel('Medicine and strength').fill('Amlodipine 5 mg');
  await sunita.getByLabel('Tablets or doses bought').fill('15');
  await sunita.getByLabel('Refills left on the prescription').fill('0');
  await sunita
    .getByLabel('Photo of the prescription or bill')
    .setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: PNG });
  await expectAccessible(page);
  await sunita.getByRole('button', { name: 'Add medicine' }).click();
  await expect(sunita.getByText('Added. Tomoni is checking when it will run out.')).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(
      sunita.locator('li[data-warning="run_out"]').filter({ hasText: 'Amlodipine 5 mg' }),
    ).toBeVisible();
  }).toPass({ timeout: 20_000 });

  await sunita
    .locator('li[data-warning="run_out"]')
    .filter({ hasText: 'Amlodipine 5 mg' })
    .getByRole('link', { name: 'See where this comes from' })
    .click();
  const photo = page.getByRole('link', { name: 'See the photo' });
  await expect(photo).toBeVisible();
  const res = await page.request.get((await photo.getAttribute('href'))!);
  expect(res.headers()['content-type']).toBe('image/png');
});

test('Priya turns on daily calls for her mother: the family pays, through checkout (D-030)', async ({
  page,
  isMobile,
}, info) => {
  test.skip(isMobile, 'state-changing; run once');
  await signIn(page, 'priya@demo.tomoni.test');
  const sunita = page.locator('section[data-patient="Sunita-ben"]');
  const plan = sunita.locator('[data-plan-status]');
  await expect(plan).toHaveAttribute('data-plan-status', 'none');
  await expect(plan).toContainText('$29.00 a month, paid by you. Cancel any time.');
  await plan.getByRole('button', { name: /Start daily calls/ }).click();

  await expect(page.getByRole('heading', { name: 'Sandbox checkout' })).toBeVisible();
  await expect(page.getByText('It asks for no card, and no money moves.')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Complete sandbox payment' }).click();

  await expect(page.getByText('Thank you. Daily calls are on')).toBeVisible();
  await expect(plan).toHaveAttribute('data-plan-status', 'active');
  await expect(plan).toContainText('Daily calls are on. The next payment of $29.00 is on');
  await expect(plan.getByRole('button', { name: /Start daily calls/ })).toHaveCount(0);
  await expectAccessible(page);
  await snap(page, info, 'family-india-plan');

  // Self-service cancel at the end of the paid month, then change of mind.
  await plan.getByRole('button', { name: 'Update card or cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Sandbox payment account' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Cancel at the end of this month' }).click();
  await expect(plan).toContainText('Daily calls to Sunita-ben end on');
  await plan.getByRole('button', { name: 'Update card or cancel' }).click();
  await page.getByRole('button', { name: 'Keep daily calls' }).click();
  await expect(plan).toContainText('The next payment of $29.00 is on');
});
