import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readSheet } from '../domain/excel';
import { previewIsometrics, previewMaterials, previewSpoolMaterials, previewSpools } from '../domain/importers';
import { computeMaterialRows } from '../domain/materials';
import { isoProgress } from '../domain/progress';
import type { ProjectData } from '../domain/types';
import { LocalRepo } from './localRepo';

function xlsx(rows: unknown[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'S');
  return readSheet(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 't.xlsx');
}

function snapshot(repo: LocalRepo, pid: string): Promise<ProjectData> {
  return new Promise((resolve, reject) => {
    const un = repo.subscribeProjectData(pid, (d) => { un(); resolve(d); }, reject);
  });
}

describe('LocalRepo end-to-end flow (IndexedDB)', () => {
  it('import → status change → ISO + material recalculation → re-import without duplicates → persists across reopen', async () => {
    const dbName = `test-${Math.random()}`;
    const repo = new LocalRepo(dbName);
    const user = { uid: 'local', email: '', name: 'test', role: 'engineer' as const };
    const now = new Date().toISOString();

    const project = await repo.createProject('YACHT 126');
    await expect(repo.createProject('yacht  126')).rejects.toThrow('zaten var');
    const pid = project.id;

    let d = await snapshot(repo, pid);
    await repo.commitImport(pid, 'isometric', previewIsometrics(xlsx([
      ['izometri_no', 'revizyon', 'sistem', 'konum_turu', 'konum_adi'],
      ['FO-120-001', 'A', 'Fuel Oil', 'Zone', 'Z01'],
      ['FO-120-002', 'B', 'Fuel Oil', 'Block', 'B12'],
    ]), d, now));
    d = await snapshot(repo, pid);
    await repo.commitImport(pid, 'spool', previewSpools(xlsx([
      ['spool_no', 'izometri_no', 'revizyon', 'baslangic_durumu'],
      ['FO-120-001-SP01', 'FO-120-001', 'A', 'Başlamadı'],
      ['FO-120-001-SP02', 'FO-120-001', 'A', 'Başlamadı'],
    ]), d, now));
    d = await snapshot(repo, pid);
    await repo.commitImport(pid, 'material', previewMaterials(xlsx([
      ['malzeme_kodu', 'malzeme_aciklamasi', 'cap_olcu', 'malzeme_kalitesi', 'birim', 'toplam_miktar', 'depo_stogu'],
      ['PIPE-DN50-CS', 'Boru', 'DN50', 'Carbon Steel', 'm', 240, 190],
    ]), d, now));
    d = await snapshot(repo, pid);
    await repo.commitImport(pid, 'spoolMaterial', previewSpoolMaterials(xlsx([
      ['spool_no', 'izometri_no', 'revizyon', 'malzeme_kodu', 'miktar'],
      ['FO-120-001-SP01', 'FO-120-001', 'A', 'PIPE-DN50-CS', 8],
    ]), d));

    d = await snapshot(repo, pid);
    expect(d.isometrics).toHaveLength(2);
    expect(d.spools).toHaveLength(2);

    const sp01 = d.spools.find((s) => s.spoolNo === 'FO-120-001-SP01')!;
    await repo.setSpoolStatus(pid, sp01.id, 'bitti', user);
    d = await snapshot(repo, pid);
    expect(isoProgress(d.isometrics, d.spools).find((x) => x.iso.isoNo === 'FO-120-001')).toMatchObject({ pct: 50, status: 'devam' });
    expect(computeMaterialRows(d)[0]).toMatchObject({ remainingNeed: 232, shortage: 42 });

    // Re-upload the same spool Excel: nothing new, status preserved.
    const again = previewSpools(xlsx([
      ['spool_no', 'izometri_no', 'revizyon', 'baslangic_durumu'],
      ['FO-120-001-SP01', 'FO-120-001', 'A', 'Başlamadı'],
    ]), d, now);
    expect(again.create).toHaveLength(0);
    // Even a stale preview that tries to create it again must not overwrite.
    await repo.commitImport(pid, 'spool', { ...again, create: [{ ...sp01, status: 'baslamadi' }] } as any);

    // Reopen the database (= page reload).
    const reopened = new LocalRepo(dbName);
    const d2 = await snapshot(reopened, pid);
    expect(d2.spools).toHaveLength(2);
    expect(d2.spools.find((s) => s.id === sp01.id)!.status).toBe('bitti');
    expect(computeMaterialRows(d2)[0].usedDone).toBe(8);

    // Back to Devam Ediyor: material goes back to "reserved".
    await reopened.setSpoolStatus(pid, sp01.id, 'devam', user);
    const d3 = await snapshot(reopened, pid);
    expect(computeMaterialRows(d3)[0]).toMatchObject({ usedDone: 0, reservedInProgress: 8, remainingNeed: 240, shortage: 50 });
  });
});
