import { expect, test, type Browser, type Page } from '@playwright/test';
import { closePools, ownerDb, sql } from '@tomoni/db';
import { expectAccessible, PASSWORD, passMfa, signIn, snap } from './helpers';

/**
 * Phase 5 Definition of Done: the referral funnel end to end. Raj joins the registry himself,
 * matching finds him, Dr. Rao introduces the study, the coordinator moves him through, the
 * sponsor sees only rounded counts and billed work, and Raj can leave at any time.
 */
const PORTAL = 'http://localhost:3101';

test.afterAll(closePools);

test.describe.serial('Trial Bridge, end to end', () => {
  test.skip(({ isMobile }) => isMobile, 'state-changing funnel, run once on desktop');
  let matchId = ''; // other synthetic patients share Raj's name: follow his match, not the name

  const staff = async (browser: Browser, email: string) => {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, email);
    await passMfa(page, email);
    return page;
  };

  test('Raj joins the research registry: separate from care, one opt-in per use', async ({ page }, info) => {
    await signIn(page, 'raj@demo.tomoni.test');
    await page.getByRole('link', { name: 'Research studies' }).click();
    await expect(page.getByText("This is separate from Tomoni's care.")).toBeVisible();
    await expect(page.getByText('Approved by Central IRB (demo) (DEMO-IRB-0001)')).toBeVisible();
    await expectAccessible(page);
    await snap(page, info, 'family-research');
    await page.getByLabel('Find medical studies that may fit').check();
    await page.getByLabel('Type your full name to sign').fill('Raj Patel');
    await page.getByRole('button', { name: 'I agree' }).click();
    await expect(page.locator('[data-research="joined"]')).toContainText('is in the registry since');
  });

  test('matching finds Raj; Dr. Rao introduces the study at his visit', async ({ browser }) => {
    const doc = await staff(browser, 'dr.rao@demo.tomoni.test');
    const card = doc.locator('[data-intro^="HEART-SA"]').filter({ hasText: 'Raj Patel' });
    await expect(async () => {
      await doc.reload();
      await expect(card).toBeVisible();
    }).toPass({ timeout: 20_000 });
    await expect(card).toContainText('Raj Patel may fit HEART-SA');
    matchId = (await card.getAttribute('data-id'))!;

    // Raj's next daily call pre-screens him with the study's approved questions (D-033).
    const sim = await staff(browser, 'nurse.priya@demo.tomoni.test');
    await sim.goto('/desk/simulator');
    await sim.getByLabel('Patient').selectOption({ label: 'Raj Patel (gu)' });
    await sim.getByRole('button', { name: 'Start call' }).click();
    const transcript = sim.getByRole('list', { name: 'Transcript' });
    const reply = async (text: string) => {
      const n = await transcript.locator('li').count();
      await sim.getByLabel('Reply as the patient').fill(text);
      await sim.getByRole('button', { name: 'Send' }).click();
      // The patient's line shows at once; wait for Tomoni's answer too.
      await expect.poll(() => transcript.locator('li').count()).toBeGreaterThan(n + 1);
    };
    await reply("I'm fine");
    await reply('yes');
    await reply('no thanks'); // his two scripted care items come first: the renewal…
    await reply('no thanks'); // …and the premium change
    await expect(transcript).toContainText('for the research registry you joined');
    await expect(transcript).toContainText('heart disease or heart failure?');
    await reply('yes');
    await expect(transcript).toContainText('walk across a room without help?');
    await reply('haan');
    await expect(transcript).toContainText('your doctor will tell you about it');
    const { rows } = await ownerDb().execute<{ status: string }>(
      sql`SELECT status FROM research.trial_match WHERE id = ${matchId}`,
    );
    expect(rows[0]!.status).toBe('prescreened');
    await doc.reload();
    await card.getByRole('button', { name: 'Introduced at visit' }).click();
    await expect(card).toHaveCount(0);
  });

  test('the coordinator moves Raj to randomized; the sponsor sees counts, never people', async ({
    browser,
  }, info) => {
    const coordinator = await staff(browser, 'research@demo.tomoni.test');
    await coordinator.goto('/research');
    const row = coordinator.locator(`tr[data-id="${matchId}"]`);
    for (const stage of ['Consent prep', 'Referred to site', 'Randomized']) {
      await row.getByRole('button', { name: `Move to ${stage}` }).click();
      await expect(row).toContainText(stage);
    }
    await expectAccessible(coordinator);

    const sponsor = await (await browser.newContext()).newPage();
    await sponsor.goto(`${PORTAL}/login`);
    await sponsor.getByLabel('Email').fill('sponsor@demo.tomoni.test');
    await sponsor.getByLabel('Password').fill(PASSWORD);
    await sponsor.getByRole('button', { name: 'Sign in' }).click();
    await passMfa(sponsor, 'sponsor@demo.tomoni.test');
    const trial = sponsor.locator('article[data-trial^="HEART-SA"]');
    await expect(trial.locator('[data-stage="randomized"] dd')).toHaveText('fewer than 11'); // one person: hidden
    const matched = await trial.locator('[data-stage="matched"] dd').innerText();
    expect(Number(matched) % 5).toBe(0); // rounded to 5
    await expect(sponsor.locator('[data-usage="introduction_delivered"]')).toBeVisible();
    await expect(sponsor.locator('[data-usage="consent_prep_call"]')).toBeVisible();
    await expect(sponsor.getByText('Raj')).toHaveCount(0);

    await sponsor.getByLabel('heart failure').check();
    await sponsor.getByRole('button', { name: 'Count' }).click();
    const total = await sponsor.locator('[data-total]').innerText();
    expect(total === 'fewer than 11' || Number(total.replace(/,/g, '')) % 5 === 0).toBe(true);
    await expectAccessible(sponsor);
    await snap(sponsor, info, 'sponsor-portal');
  });

  test('Raj leaves the registry; research stops at once', async ({ page, browser }) => {
    await signIn(page, 'raj@demo.tomoni.test');
    await page.goto('/family/research');
    await page.getByRole('button', { name: 'Leave the registry' }).click();
    await expect(page.getByLabel('Find medical studies that may fit')).toBeVisible();
    const coordinator: Page = await staff(browser, 'research@demo.tomoni.test');
    await coordinator.goto('/research');
    await expect(coordinator.locator(`tr[data-id="${matchId}"]`)).toHaveCount(0);
  });
});
