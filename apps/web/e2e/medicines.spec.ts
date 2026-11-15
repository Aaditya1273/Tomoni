import { expect, test, type Page } from '@playwright/test';
import { closePools, hashFor, ownerDb, sql } from '@tomoni/db';
import { expectAccessible, expectSandboxBadge, passMfa, signIn, snap } from './helpers';

/** Phase 2 Definition of Done: seeded households show correct, sourced warnings. */
process.env.TOMONI_DB_NAME = 'tomoni_e2e';
test.afterAll(closePools);

const raj = (page: Page) => page.locator('section[data-patient="Raj-bhai"]');
const kokila = (page: Page) => page.locator('section[data-patient="Kokila Patel"]');

test.describe('family card', () => {
  test('Asha sees every medicine and each scripted warning, worst first, with its source', async ({
    page,
  }, info) => {
    await signIn(page, 'asha@demo.tomoni.test');
    await expect(page.getByText('2 things need you soon')).toBeVisible();

    const r = raj(page);
    await expect(r.getByRole('heading', { name: 'Raj-bhai' })).toBeVisible();
    const w = (type: string) => r.locator(`li[data-warning="${type}"]`);
    // The most urgent comes first.
    await expect(r.locator('li[data-warning]').first()).toHaveAttribute('data-warning', 'run_out');
    await expect(w('run_out')).toContainText(
      'Clopidogrel 75 mg tablet runs out in 9 days and has no refills left.',
    );
    await expect(w('run_out')).toContainText('From sandbox pharmacy claims, filled Oct 25');
    await expect(w('premium_jump')).toContainText(
      'The Sample Basic PDP premium goes from $38.00 to $61.00 a month on Jan 1, 2027.',
    );
    await expect(w('premium_jump')).toContainText('From Synthetic sample in CMS Part D file format, 2027');
    await expect(w('tier_change')).toContainText(
      'Sitagliptin 100 mg tablet moves from tier 3 to tier 4 on Sample Basic PDP',
    );
    await expect(r.locator('li[data-warning="run_out"] [data-status="act"]')).toHaveText('In 9 days');
    await expect(
      r.getByRole('listitem').filter({ hasText: 'Metformin hydrochloride 500 mg tablet' }),
    ).toContainText('Covered');

    const k = kokila(page);
    await expect(k.locator('li[data-warning="late_refill"]')).toContainText(
      "Losartan potassium 50 mg tablet ran out 5 days ago and hasn't been refilled.",
    );
    await expect(k.locator('li[data-warning="pharmacy_closure"]')).toContainText(
      'Oak Tree Drugs closes on Dec 12. 2 medicines are filled there.',
    );

    await expectSandboxBadge(page);
    await expectAccessible(page);
    await snap(page, info, 'family-card');
  });

  test('every warning links to its evidence: the claim, or both file versions', async ({ page }, info) => {
    await signIn(page, 'asha@demo.tomoni.test');
    await raj(page)
      .locator('li[data-warning="run_out"]')
      .getByRole('link', { name: 'See where this comes from' })
      .click();
    await expect(page.getByRole('heading', { name: 'Where this comes from' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pharmacy claims this is based on' })).toBeVisible();
    await expect(page.getByText('Oct 25, 2026')).toBeVisible();
    await expectAccessible(page);
    await snap(page, info, 'evidence-fill');

    await page.getByRole('link', { name: 'Back to today' }).click();
    await raj(page).locator('li[data-warning="tier_change"]').getByRole('link').click();
    await expect(page.getByRole('heading', { name: 'Files this is based on' })).toBeVisible();
    await expect(page.getByText('Synthetic sample in CMS Part D file format, 2026')).toBeVisible();
    await expect(page.getByText(/^[0-9a-f]{64}$/).first()).toBeVisible();
    await expectAccessible(page);
    await snap(page, info, 'evidence-file');
  });

  test('the card reads in Hindi', async ({ page }) => {
    await signIn(page, 'asha@demo.tomoni.test');
    await page.context().addCookies([{ name: 'tomoni_locale', value: 'hi', url: 'http://localhost:3001' }]);
    await page.reload();
    await expect(raj(page).locator('li[data-warning="run_out"]')).toContainText('कोई रीफ़िल बाकी नहीं है');
    await expect(raj(page).getByRole('heading', { name: 'दवाइयाँ' })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe.serial('Medicare and PBM changes', () => {
  test('connecting Medicare (sandbox) links the patient and returns to the card', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'one connection is enough');
    const kokilaMbiHash = hashFor.mbi('0EG4TE5MK74'); // KOKILA_MBI in @tomoni/medicines
    await ownerDb().execute(
      sql`DELETE FROM care.bluebutton_link WHERE patient_id = (SELECT id FROM care.patient WHERE mbi_hash = ${kokilaMbiHash})`,
    );
    await signIn(page, 'asha@demo.tomoni.test');
    const k = kokila(page);
    await k.getByRole('button', { name: 'Connect Medicare (sandbox)' }).click();
    await expect(page).toHaveURL(/\/family\?medicare=connected$/);
    await expect(page.getByText('Medicare is connected.')).toBeVisible();
    await expect(kokila(page).getByText('Medicare connected (sandbox data)')).toBeVisible();
  });

  test('an admin maps a PBM CSV; the engine puts the change on Raj’s card', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'one upload is enough');
    await signIn(page, 'admin@demo.tomoni.test');
    await passMfa(page, 'admin@demo.tomoni.test');
    await expect(page).toHaveURL(/\/admin\/data$/);
    await expect(page.getByRole('heading', { name: 'Upload a PBM change list' })).toBeVisible();
    await page.getByLabel('CSV file').setInputFiles({
      name: 'acme-pbm-dec-2026.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Formulary ID,Drug RXCUI,Action,New Tier,Effective Date\n00090001,197361,Removed from formulary,,12/01/2026\n00090001,bad,Removed,,12/01/2026\n',
      ),
    });
    await expect(page.getByText('2 rows in the file')).toBeVisible();
    await expect(page.getByLabel('Change (removal or tier change)')).toHaveValue('Action');
    await expectAccessible(page);
    await snap(page, info, 'admin-pbm-mapping');
    await page.getByRole('button', { name: 'Upload and check patients' }).click();
    await expect(page.getByText('Saved 1 change. 1 row set aside.')).toBeVisible();
    await expect(page.getByText('Line 3: rxcui')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'acme-pbm-dec-2026' })).toBeVisible();

    await page.context().clearCookies();
    await signIn(page, 'asha@demo.tomoni.test');
    await expect(async () => {
      await page.reload();
      await expect(raj(page).locator('li[data-warning="formulary_removal"]')).toContainText(
        'Sample Basic PDP stops covering Amlodipine 5 mg tablet from Dec 1.',
      );
    }).toPass({ timeout: 30_000 });
  });
});
