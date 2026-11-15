import { expect, test } from '@playwright/test';
import { expectAccessible, expectSandboxBadge, passMfa, signIn, snap } from './helpers';

/**
 * Phase 3 Definition of Done: a simulated call with a symptom puts a nurse flag on the doctor
 * desk, live, in under 5 seconds (BUILD_PROMPT §6, §9).
 */
test('a symptom on a simulated call reaches the nurse desk live in under 5 seconds', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'two windows side by side is a desktop workflow');
  await signIn(page, 'nurse.priya@demo.tomoni.test');
  await passMfa(page, 'nurse.priya@demo.tomoni.test');
  await expect(page).toHaveURL(/\/desk$/);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();

  const sim = await context.newPage();
  await sim.goto('/desk/simulator');
  await sim.getByLabel('Patient').selectOption({ label: 'Raj Patel (gu)' });
  await sim.getByRole('button', { name: 'Start call' }).click();
  const transcript = sim.getByRole('list', { name: 'Transcript' });
  await expect(transcript).toContainText(
    "This is Tomoni, an automated assistant calling from Dr. Anil Rao's office",
  );
  await expectSandboxBadge(sim);
  await expectAccessible(sim);

  await sim.getByLabel('Reply as the patient').fill("I'm fine");
  await sim.getByRole('button', { name: 'Send' }).click();
  await expect(transcript).toContainText("Have you taken today's medicines?");

  await sim.getByLabel('Reply as the patient').fill('Mujhe subah se chakkar aa rahe hain');
  const sent = Date.now();
  await sim.getByRole('button', { name: 'Send' }).click();
  await expect(sim.getByText('Nurse flag raised: Symptom')).toBeVisible();

  const flag = page
    .locator('li[data-flag="symptom"]')
    .filter({ hasText: 'Mujhe subah se chakkar aa rahe hain' });
  await expect(flag).toBeVisible({ timeout: 5_000 });
  const ms = Date.now() - sent;
  console.warn(`nurse flag on the desk ${ms} ms after the caller spoke`);
  expect(ms).toBeLessThan(5_000);
  await snap(sim, info, 'call-simulator');
  await snap(page, info, 'desk-flag');
  await expectAccessible(page);

  // The nurse closes the loop.
  await flag.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(flag).toContainText('Acknowledged');
  await flag.getByRole('button', { name: 'Resolve' }).click();
  await flag.getByLabel('What was done').fill('Called back; advised to rest and hydrate. Doctor informed.');
  await flag.getByRole('button', { name: 'Save and resolve' }).click();
  await expect(page.locator('li[data-flag]').filter({ hasText: 'Mujhe subah se chakkar' })).toHaveCount(0);
});

test('an emergency phrase ends the call with the 911 script', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'covered once');
  await signIn(page, 'nurse.priya@demo.tomoni.test');
  await passMfa(page, 'nurse.priya@demo.tomoni.test');
  await page.goto('/desk/simulator');
  await page.getByLabel('Patient').selectOption({ label: 'Raj Patel (gu)' });
  await page.getByRole('button', { name: 'Start call' }).click();
  await page.getByLabel('Reply as the patient').fill('મને છાતીમાં દુખાવો થાય છે');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('list', { name: 'Transcript' })).toContainText(
    'Please hang up and call 911 now.',
  );
  await expect(page.getByText('Call ended: escalated to emergency')).toBeVisible();
  await expect(page.getByLabel('Reply as the patient')).toHaveCount(0);
});
