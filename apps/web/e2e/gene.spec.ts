import { expect, test } from '@playwright/test';
import { expectAccessible, passMfa, signIn, snap } from './helpers';

/**
 * Phase 6 Definition of Done (Gene-to-Pill): Raj, a CYP2C19 poor metabolizer on clopidogrel,
 * raises a gene-drug warning for the doctor only. The family never sees it.
 */
test('a CYP2C19 poor metabolizer on clopidogrel: a doctor-only warning, citing CPIC', async ({
  page,
  browser,
  isMobile,
}, info) => {
  test.skip(isMobile, 'desk workflow, run once on desktop');
  await signIn(page, 'dr.rao@demo.tomoni.test');
  await passMfa(page, 'dr.rao@demo.tomoni.test');
  await page.getByRole('link', { name: 'APCM billing' }).click();
  await page.getByRole('button', { name: 'Check this month' }).click();
  await page.locator('tr').filter({ hasText: 'Raj Patel' }).getByRole('link', { name: 'Raj Patel' }).click();
  await page.getByLabel('Gene').selectOption('CYP2C19');
  await page.getByLabel('Diplotype').fill('*2/*2');
  await page.getByLabel('Phenotype').selectOption('Poor Metabolizer');
  await page.getByLabel('Lab', { exact: true }).fill('Demo PGx Lab (synthetic)');
  await page.getByRole('button', { name: 'Save result' }).click();
  await expect(page.getByText('Saved. Medicines are being checked.')).toBeVisible();

  await page.getByRole('link', { name: 'Queue' }).click();
  await expect(page.getByRole('heading', { name: 'Queue' })).toBeVisible();
  const item = page.locator('li[data-gene_drug="CYP2C19"]').filter({ hasText: 'Raj Patel' });
  await expect(async () => {
    await page.reload();
    await expect(item).toBeVisible();
  }).toPass({ timeout: 20_000 });
  await expect(item).toContainText('Gene-drug: Clopidogrel 75 mg tablet with CYP2C19 Poor Metabolizer');
  await item.click({ position: { x: 5, y: 5 } });
  const evidence = page.locator('[data-evidence="gene_drug"]');
  await expect(evidence).toContainText('For the doctor only; the family does not see this.');
  await expect(evidence.getByRole('link', { name: 'Read the CPIC guideline' })).toHaveAttribute(
    'href',
    'https://cpicpgx.org/guidelines/guideline-for-clopidogrel-and-cyp2c19/',
  );
  await expectAccessible(page);
  await snap(page, info, 'desk-gene-drug');

  // The family card never shows it.
  const asha = await (await browser.newContext()).newPage();
  await signIn(asha, 'asha@demo.tomoni.test');
  await expect(asha.locator('section[data-patient="Raj-bhai"]')).toBeVisible();
  await expect(asha.locator('li[data-warning="gene_drug_mismatch"]')).toHaveCount(0);
  await expect(asha.getByText('CYP2C19')).toHaveCount(0);
});
