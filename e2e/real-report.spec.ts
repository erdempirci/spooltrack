// Browser test with a real shipyard report. Runs only when REAL_FILE points at one, e.g.
//   REAL_FILE=/path/NB012-ZC1-GENERAL_REPORTS.xlsx npm run test:e2e
// The file itself is not stored in the repository.
import { expect, test } from '@playwright/test';
import path from 'node:path';

const FILE = process.env.REAL_FILE;
const SHOTS = process.env.SHOTS_DIR ?? path.resolve(import.meta.dirname, '..', 'test-results', 'shots');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.skip(!FILE, 'REAL_FILE not set');

test('real GENERAL_REPORTS workbook: upload, select block + system, update a spool on the phone', async ({ page }) => {
  const nav = (label: string) => page.getByRole('navigation').getByRole('button', { name: label });
  await page.goto('/');
  await nav('Veri Yükleme').click();

  await page.getByTestId('file-report').setInputFiles(FILE!);
  await expect(page.getByTestId('preview-report')).toBeVisible();
  const hull = (await page.getByTestId('report-hull').textContent())!;
  // No project yet → offer to create one named after HULL NO
  await page.getByTestId('create-hull-project').click();
  await expect(page.getByTestId('project-counts')).toContainText(`${hull}: 0 izometri`);
  await expect(page.getByTestId('body-spool').getByTestId('count-create')).not.toHaveText('0');
  await page.screenshot({ path: `${SHOTS}/real-01-preview.png`, fullPage: true });
  const spoolCount = Number(await page.getByTestId('body-spool').getByTestId('count-create').textContent());
  const isoCount = Number(await page.getByTestId('body-isometric').getByTestId('count-create').textContent());
  const matCount = Number(await page.getByTestId('body-material').getByTestId('count-create').textContent());
  await page.getByTestId('commit-report').click();
  await expect(page.getByTestId('result-report')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('project-counts')).toContainText(`${isoCount} izometri · ${spoolCount} spool · ${matCount} malzeme`);

  // Re-upload the same report: nothing new
  await page.getByTestId('file-report').setInputFiles(FILE!);
  await expect(page.getByTestId('body-spool').getByTestId('count-create')).toHaveText('0');
  await expect(page.getByTestId('body-spool').getByTestId('count-unchanged')).toHaveText(String(spoolCount));
  await expect(page.getByTestId('commit-report')).toBeDisabled();

  // Production: Block → system cascade
  await nav('Üretim').click();
  const locs = await page.getByTestId('sel-location').locator('option').allTextContents();
  expect(locs.some((l) => l.startsWith('Block '))).toBe(true);
  const blockValue = await page.getByTestId('sel-location').locator('option', { hasText: /^Block / }).first().getAttribute('value');
  await page.getByTestId('sel-location').selectOption(blockValue!);
  const systems = (await page.getByTestId('sel-system').locator('option').allTextContents()).slice(1);
  expect(systems.length).toBeGreaterThan(0);
  await page.getByTestId('sel-system').selectOption(systems[0]);
  const cards = page.getByTestId('spool-list').locator('[data-spool]');
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  await expect(page.getByTestId('stats')).toContainText(`${n}Toplam spool`);

  // One tap → Bitti, progress moves
  await cards.first().getByRole('button', { name: 'Bitti' }).click();
  await expect(page.getByTestId('stats')).toContainText('1Bitti');
  await page.screenshot({ path: `${SHOTS}/real-02-production.png` });
  await page.getByRole('tab', { name: /ISO/ }).click();
  await expect(page.getByTestId('iso-table').locator('tbody tr').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/real-03-iso.png` });

  await nav('Malzeme').click();
  await expect(page.getByTestId('material-table').locator('tbody tr')).toHaveCount(matCount);
  await page.screenshot({ path: `${SHOTS}/real-04-materials.png` });

  // Reload keeps the status
  await page.reload();
  await nav('Üretim').click();
  await expect(page.getByTestId('stats')).toContainText('1Bitti');
});
