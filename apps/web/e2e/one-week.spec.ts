import { expect, test, type Browser, type Page } from '@playwright/test';
import { expectAccessible, passMfa, signIn, snap } from './helpers';

/**
 * Phase 4 Definition of Done: "one week in Tomoni", end to end. Raj talks, Asha taps, Dr. Rao
 * signs, the nurse calls back, a sibling joins, and the practice can bill the month.
 */
test.describe.serial('one week in Tomoni', () => {
  test.skip(({ isMobile }) => isMobile, 'one scripted week, run once on desktop');

  const staff = async (browser: Browser, email: string) => {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, email);
    await passMfa(page, email);
    return page;
  };
  const call = async (page: Page, replies: string[]) => {
    await page.goto('/desk/simulator');
    await page.getByLabel('Patient').selectOption({ label: 'Raj Patel (gu)' });
    await page.getByRole('button', { name: 'Start call' }).click();
    for (const r of replies) {
      await page.getByLabel('Reply as the patient').fill(r);
      await page.getByRole('button', { name: 'Send' }).click();
      await expect(page.getByRole('list', { name: 'Transcript' })).toContainText(r);
    }
  };

  test('Monday: the daily call, "yes, help me", the doctor signs, the family sees it done', async ({
    browser,
  }) => {
    const nurse = await staff(browser, 'nurse.priya@demo.tomoni.test');
    await call(nurse, ["I'm fine", 'yes', 'yes please', 'yes please']);
    await expect(nurse.getByText('Call ended: completed')).toBeVisible();

    // Whatever clinical request the call produced waits for Dr. Rao; non-clinical ones just run.
    const doc = await staff(browser, 'dr.rao@demo.tomoni.test');
    await expect(doc.getByRole('heading', { name: 'Queue' })).toBeVisible();
    const pending = doc.locator('li[data-approval]').filter({ hasText: 'Raj Patel' });
    if (await pending.count()) await pending.first().getByRole('button', { name: 'Sign' }).click();

    const asha = await (await browser.newContext()).newPage();
    await signIn(asha, 'asha@demo.tomoni.test');
    await expect(async () => {
      await asha.reload();
      await expect(
        asha.locator('section[data-patient="Raj-bhai"] [data-action="succeeded"]').filter({
          hasText: /the lowest-cost plan is|keep covering it/,
        }),
      ).not.toHaveCount(0);
    }).toPass({ timeout: 20_000 });
  });

  test('Wednesday: a symptom on the call, the nurse calls back and resolves it', async ({ browser }) => {
    const nurse = await staff(browser, 'nurse.priya@demo.tomoni.test');
    await call(nurse, ['Pet mein dard hai aaj']);
    await expect(nurse.getByText('Nurse flag raised: Symptom')).toBeVisible();
    await nurse.getByRole('link', { name: 'Queue' }).click();
    const flag = nurse.locator('li[data-flag="symptom"]').filter({ hasText: 'Pet mein dard hai aaj' });
    await flag.getByRole('button', { name: 'Resolve' }).click();
    await flag
      .getByLabel('What was done')
      .fill('Called Raj back; mild, after a heavy meal. Will check tomorrow.');
    await flag.getByRole('button', { name: 'Save and resolve' }).click();
    await expect(flag).toHaveCount(0);
  });

  test('Thursday: Asha invites her brother, who joins and sees the same card', async ({ browser }, info) => {
    const asha = await (await browser.newContext()).newPage();
    await signIn(asha, 'asha@demo.tomoni.test');
    await asha.getByRole('link', { name: 'Invite a sibling or the doctor' }).click();
    await asha.getByLabel('Their e-mail').fill('nikhil.patel@demo.tomoni.test');
    await asha.getByRole('button', { name: 'Create invite' }).click();
    const link = (await asha.locator('[data-invite-link]').innerText()).trim();
    await expectAccessible(asha);
    await snap(asha, info, 'family-invite');

    const nikhil = await (await browser.newContext()).newPage();
    await nikhil.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    await nikhil.getByLabel('Your name').fill('Nikhil Patel');
    await nikhil.getByLabel('Choose a password (12 characters or more)').fill('a long enough password');
    await nikhil.getByRole('button', { name: 'Join' }).click();
    await expect(nikhil.getByText("You're in.")).toBeVisible();
    await nikhil.getByLabel('Email').fill('nikhil.patel@demo.tomoni.test');
    await nikhil.getByLabel('Password').fill('a long enough password');
    await nikhil.getByRole('button', { name: 'Sign in' }).click();
    await expect(nikhil.locator('section[data-patient="Raj-bhai"]')).toBeVisible();
  });

  test('Friday: Dr. Rao signs the care plan; the month is billable', async ({ browser }) => {
    const doc = await staff(browser, 'dr.rao@demo.tomoni.test');
    await doc.getByRole('link', { name: 'APCM billing' }).click();
    await doc.getByRole('button', { name: 'Check this month' }).click(); // the table fills on a check
    await doc.locator('tr').filter({ hasText: 'Raj Patel' }).getByRole('link', { name: 'Raj Patel' }).click();
    await expect(doc.getByRole('heading', { name: 'Care plan', exact: true })).toBeVisible();
    if (await doc.getByRole('button', { name: 'Draft care plan' }).isVisible()) {
      await doc.getByRole('button', { name: 'Draft care plan' }).click();
      await expect(doc.locator('[data-plan-status="draft"]')).toBeVisible();
    }
    // The doctor edits a goal in place, then signs exactly what is on screen.
    await doc.getByRole('button', { name: 'Edit goals and interventions' }).click();
    const goals = doc.getByLabel('Goals');
    await goals.fill(`${await goals.inputValue()}\nWalk 20 minutes every morning with Asha.`);
    await expectAccessible(doc);
    await doc.getByRole('button', { name: 'Save draft' }).click();
    // The saved list, not the textarea: the page has the new revision only once this renders.
    await expect(
      doc.locator('[data-plan-status="draft"] li').filter({ hasText: 'Walk 20 minutes every morning' }),
    ).toHaveCount(1);
    await doc.getByRole('button', { name: 'Sign care plan' }).click();
    await expect(doc.locator('[data-plan-status="signed"]')).toContainText('Walk 20 minutes every morning');
    await doc.getByRole('link', { name: 'APCM billing' }).click();
    await doc.getByRole('button', { name: 'Check this month' }).click();
    await expect(doc.locator('tr').filter({ hasText: 'Raj Patel' })).toContainText(/Ready to bill|Billed/);
  });

  test('Sunday: Asha reads the week', async ({ page }, info) => {
    await signIn(page, 'asha@demo.tomoni.test');
    await expect(page.locator('[data-week]')).toContainText('This week:');
    await expect(page.locator('section[data-patient="Raj-bhai"] [data-streak]')).toBeVisible();
    await page.getByRole('link', { name: 'Everything Tomoni did' }).click();
    await expect(page.locator('[data-activity="call.completed"]').first()).toContainText(
      'Daily call with Raj-bhai',
    );
    await expect(page.locator('[data-activity="action.succeeded"]').first()).toContainText('Done for');
    await expect(page.locator('[data-activity="flag.symptom"]').first()).toContainText('the nurse was told');
    await expect(page.getByText('Pet mein dard')).toHaveCount(0); // the caller's words stay with the care team
    // Times of day are in the viewer's time zone, not UTC.
    const t = page.locator('[data-activity] time').first();
    await expect(async () => {
      const [shown, local] = await t.evaluate((el) => [
        el.textContent,
        new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(el.getAttribute('datetime')!),
        ),
      ]);
      expect(shown?.replace(/\s/g, ' ')).toBe(local.replace(/\s/g, ' '));
    }).toPass();
    await expectAccessible(page);
    await snap(page, info, 'family-activity');
  });
});
