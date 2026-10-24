import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DATA = path.resolve(import.meta.dirname, '..', 'test-data');
const SHOTS = process.env.SHOTS_DIR ?? path.resolve(import.meta.dirname, '..', 'test-results', 'shots');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true });

async function upload(page: Page, kind: string, file: string) {
  await page.getByTestId(`file-${kind}`).setInputFiles(path.join(DATA, file));
  await expect(page.getByTestId(`preview-${kind}`)).toBeVisible();
}
const step = (page: Page, kind: string) => page.locator(`[data-step="${kind}"]`);
const nav = (page: Page, label: string) => page.getByRole('navigation').getByRole('button', { name: label });
const spoolCard = (page: Page, no: string) => page.locator(`[data-spool="${no}"]`);

test('admin uploads Excel files, engineer updates spools on a phone, ISO + materials recalculate', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Yerel mod')).toBeVisible();
  await expect(page.getByText('Henüz proje yok.')).toBeVisible();

  // ── 1. Project ───────────────────────────
  await nav(page, 'Veri Yükleme').click();
  await page.getByLabel('Yeni proje adı').fill('YACHT 126');
  await page.getByRole('button', { name: 'Projeyi oluştur' }).click();
  await expect(page.getByTestId('project-counts')).toContainText('YACHT 126: 0 izometri');
  await page.getByLabel('Yeni proje adı').fill('yacht 126');
  await page.getByRole('button', { name: 'Projeyi oluştur' }).click();
  await expect(page.getByText('adında bir proje zaten var')).toBeVisible();

  // ── 2. Missing columns are reported, nothing can be imported ──
  await upload(page, 'isometric', 'eksik_sutun_test.xlsx');
  await expect(page.getByTestId('missing-columns')).toContainText('revizyon, konum_turu, konum_adi');
  await expect(step(page, 'isometric').getByTestId('commit')).toBeDisabled();

  // ── 3. Isometrics with deliberate errors ──
  await upload(page, 'isometric', '1_izometri_test.xlsx');
  const isoStep = step(page, 'isometric');
  await expect(isoStep.getByTestId('count-create')).toHaveText('28');
  await expect(isoStep.getByTestId('count-errors')).toHaveText('3');
  await expect(isoStep.getByTestId('issues')).toContainText('"Deck" tanınmadı');
  await expect(isoStep.getByTestId('issues')).toContainText('Boş alan: izometri_no');
  await expect(isoStep.getByTestId('issues')).toContainText('Dosyada mükerrer');
  await page.screenshot({ path: `${SHOTS}/01-iso-preview.png`, fullPage: true });
  await isoStep.getByTestId('commit').click();
  await expect(isoStep.getByTestId('result-isometric')).toContainText('28 kayıt kaydedildi');

  // Re-upload → no duplicates
  await upload(page, 'isometric', '1_izometri_test.xlsx');
  await expect(isoStep.getByTestId('count-create')).toHaveText('0');
  await expect(isoStep.getByTestId('count-unchanged')).toHaveText('28');
  await expect(isoStep.getByTestId('commit')).toBeDisabled();
  await isoStep.getByRole('button', { name: 'Vazgeç' }).click();

  // ── 4. Spools ───────────────────────────
  await upload(page, 'spool', '2_spool_test.xlsx');
  const spStep = step(page, 'spool');
  await expect(spStep.getByTestId('count-create')).toHaveText('81');
  await expect(spStep.getByTestId('count-errors')).toHaveText('3');
  await expect(spStep.getByTestId('issues')).toContainText('rev B kayıtlı değil');
  await expect(spStep.getByTestId('issues')).toContainText('NOPE-001 rev A izometri listesinde yok');
  await expect(spStep.getByTestId('issues')).toContainText('"belki" tanınmadı');
  await spStep.getByTestId('commit').click();
  await expect(spStep.getByTestId('result-spool')).toContainText('81 kayıt kaydedildi');

  // ── 5. Materials ────────────────────────
  await upload(page, 'material', '3_malzeme_test.xlsx');
  await expect(step(page, 'material').getByTestId('count-create')).toHaveText('3');
  await step(page, 'material').getByTestId('commit').click();
  await expect(step(page, 'material').getByTestId('result-material')).toBeVisible();

  await upload(page, 'spoolMaterial', '4_spool_malzeme_test.xlsx');
  const smStep = step(page, 'spoolMaterial');
  await expect(smStep.getByTestId('count-create')).toHaveText('162');
  await expect(smStep.getByTestId('count-errors')).toHaveText('1');
  await expect(smStep.getByTestId('issues')).toContainText('UNKNOWN-CODE toplam malzeme listesinde yok');
  await smStep.getByTestId('commit').click();
  await expect(smStep.getByTestId('result-spoolMaterial')).toContainText('162 kayıt');
  await expect(page.getByTestId('project-counts')).toContainText('28 izometri · 81 spool · 3 malzeme · 162 spool malzeme satırı');

  // ── 6. Production screen: Project → Zone → System cascade ──
  await nav(page, 'Üretim').click();
  await expect(page.getByText('Spoolları görmek için Zone / Block ve sistem seçin.')).toBeVisible();
  const locOptions = await page.getByTestId('sel-location').locator('option').allTextContents();
  expect(locOptions).toEqual(['— Zone / Block seçin —', 'Zone Z01', 'Zone Z02', 'Block B12']);
  await expect(page.getByTestId('sel-system')).toBeDisabled();
  await page.getByTestId('sel-location').selectOption('Zone|Z01');
  const sysOptions = await page.getByTestId('sel-system').locator('option').allTextContents();
  expect(sysOptions).toEqual(['— Sistem seçin —', 'Chilled Water', 'Fuel Oil', 'Sea Water']);
  await page.getByTestId('sel-system').selectOption('Fuel Oil');

  const stats = page.getByTestId('stats');
  await expect(stats).toContainText('9Toplam spool');
  await expect(stats).toContainText('7Başlamadı');
  await expect(stats).toContainText('1Devam Ediyor');
  await expect(stats).toContainText('1Bitti');
  await expect(page.getByTestId('overall-pct')).toHaveText('%11,1');
  // Only Zone Z01 / Fuel Oil spools are listed
  const listed = await page.getByTestId('spool-list').locator('[data-spool]').evaluateAll((els) => els.map((e) => e.getAttribute('data-spool')));
  expect(listed).toHaveLength(9);
  expect(listed.every((n) => n!.startsWith('FO-'))).toBe(true);
  await page.screenshot({ path: `${SHOTS}/02-production-phone.png`, fullPage: false });

  // ── 7. One-tap status changes → ISO progress ──
  await spoolCard(page, 'FO-101-001-SP01').getByRole('button', { name: 'Bitti' }).click();
  await spoolCard(page, 'FO-101-001-SP02').getByRole('button', { name: 'Bitti' }).click();
  await expect(spoolCard(page, 'FO-101-001-SP02').getByRole('button', { name: 'Bitti' })).toHaveAttribute('aria-pressed', 'true');
  await expect(stats).toContainText('3Bitti');
  await expect(page.getByTestId('overall-pct')).toHaveText('%33,3');

  await page.getByRole('tab', { name: /ISO/ }).click();
  const iso1 = page.locator('[data-iso="FO-101-001"]');
  await expect(iso1).toContainText('%100');
  await expect(iso1).toContainText('Bitti');
  await expect(page.locator('[data-iso="FO-999-001"]')).toContainText('Spool Tanımlanmamış');
  await expect(page.locator('[data-iso="FO-102-002"]')).toContainText('Başlamadı');
  await page.screenshot({ path: `${SHOTS}/03-iso-phone.png`, fullPage: true });

  // ── 8. Materials recalculate from statuses ──
  // 3 finished spools × 2.5 m = 7.5 m → remaining 232.5, stock 190 → shortage 42.5
  await nav(page, 'Malzeme').click();
  const pipe = page.locator('[data-material="PIPE-DN50-CS"]');
  await expect(pipe.locator('[data-col="used"]')).toHaveText('7,5');
  await expect(pipe.locator('[data-col="remaining"]')).toHaveText('232,5');
  await expect(pipe.locator('[data-col="shortage"]')).toHaveText('42,5');
  await page.screenshot({ path: `${SHOTS}/04-materials-phone.png`, fullPage: true });

  // Bitti → Başlamadı returns the material
  await nav(page, 'Üretim').click();
  await page.getByRole('tab', { name: /SPOOL/ }).click();
  await spoolCard(page, 'FO-101-001-SP01').getByRole('button', { name: 'Başlamadı' }).click();
  await expect(stats).toContainText('2Bitti');
  await nav(page, 'Malzeme').click();
  await expect(pipe.locator('[data-col="used"]')).toHaveText('5');
  await expect(pipe.locator('[data-col="shortage"]')).toHaveText('45');

  // Excel export of the material report
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-materials').click();
  const file = await (await dl).path();
  const wb = XLSX.read(readFileSync(file));
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
  const pipeRow = rows.find((r) => r['Malzeme kodu'] === 'PIPE-DN50-CS')!;
  expect(pipeRow['Biten spoollarda kullanılan']).toBe(5);
  expect(pipeRow['Kalan üretim ihtiyacı']).toBe(235);
  expect(pipeRow['Eksik satın alma']).toBe(45);

  // ── 9. Reload: data persists ──
  await page.reload();
  await nav(page, 'Üretim').click();
  await expect(page.getByTestId('sel-system')).toHaveValue('Fuel Oil');
  await expect(spoolCard(page, 'FO-101-001-SP02').getByRole('button', { name: 'Bitti' })).toHaveAttribute('aria-pressed', 'true');
  await expect(spoolCard(page, 'FO-101-001-SP01').getByRole('button', { name: 'Başlamadı' })).toHaveAttribute('aria-pressed', 'true');

  // ── 10. Filters and search ──
  await page.getByRole('button', { name: /^Bitti\s*2$/ }).click();
  await expect(page.getByTestId('spool-list').locator('[data-spool]')).toHaveCount(2);
  await page.getByRole('button', { name: /^Tümü/ }).click();
  await page.getByPlaceholder('Spool veya izometri no').fill('sp03');
  await expect(page.getByTestId('spool-list').locator('[data-spool]')).toHaveCount(3);
  await page.getByPlaceholder('Spool veya izometri no').fill('');

  // ── 11. Reports export ──
  await nav(page, 'Raporlar').click();
  const dl2 = page.waitForEvent('download');
  await page.getByTestId('export-report').click();
  const rep = XLSX.read(readFileSync(await (await dl2).path()));
  expect(rep.SheetNames).toEqual([
    'Proje ilerlemesi', 'Zone-Block ilerlemesi', 'Sistem ilerlemesi', 'ISO ilerlemesi',
    'Biten spoollar', 'Üretimdeki spoollar', 'Başlamayan spoollar', 'Kalan malzeme ihtiyacı', 'Eksik satın alma',
  ]);
  expect(XLSX.utils.sheet_to_json(rep.Sheets['Biten spoollar'])).toHaveLength(2);

  // ── 12. Engineer view hides admin screens ──
  await nav(page, 'Hesap').click();
  await page.getByTestId('local-role').selectOption('engineer');
  await expect(nav(page, 'Veri Yükleme')).toHaveCount(0);
  await expect(nav(page, 'Raporlar')).toHaveCount(0);
  await nav(page, 'Üretim').click();
  await expect(page.getByTestId('spool-list')).toBeVisible();

  // ── 13. Dark theme screenshot ──
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: `${SHOTS}/05-production-dark.png` });

  // ── 14. Desktop: table layout ──
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${SHOTS}/06-production-desktop.png` });
  await nav(page, 'Malzeme').click();
  await expect(page.getByTestId('material-table').locator('thead')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-materials-desktop.png` });
});

test('PWA manifest and service worker are served', async ({ page, request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toContain('512x512');
  await page.goto('/');
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(sw).toBe(true);
  for (const t of ['IZOMETRI_SABLONU', 'SPOOL_SABLONU', 'TOPLAM_MALZEME_SABLONU', 'SPOOL_MALZEME_SABLONU']) {
    expect((await request.get(`/templates/${t}.xlsx`)).ok()).toBe(true);
  }
});
