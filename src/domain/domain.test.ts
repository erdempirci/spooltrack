import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readSheet } from './excel';
import {
  canCommit,
  previewIsometrics,
  previewMaterials,
  previewSpoolMaterials,
  previewSpools,
  type ImportPreview,
} from './importers';
import { computeMaterialRows } from './materials';
import { normalizeLocationType, normalizeStatus, parseQuantity } from './normalize';
import { countSpools, isoProgress, locationOptions, systemOptions } from './progress';
import { EMPTY_PROJECT_DATA, type ProjectData, type SpoolStatus } from './types';

const NOW = '2026-10-25T00:00:00Z';

/** Builds a real .xlsx in memory and parses it back, exactly like a user upload. */
function xlsx(rows: unknown[][], name = 'test.xlsx') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sayfa1');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return readSheet(buf, name);
}

function apply(data: ProjectData, p: ImportPreview<any>): ProjectData {
  const key = ({ isometric: 'isometrics', spool: 'spools', material: 'materials', spoolMaterial: 'spoolMaterials' } as const)[p.kind];
  const map = new Map<string, any>((data[key] as any[]).map((x) => [x.id, x]));
  for (const x of [...p.create, ...p.update]) map.set(x.id, x);
  return { ...data, [key]: [...map.values()] };
}

const ISO_ROWS = [
  ['izometri_no', 'revizyon', 'sistem', 'konum_turu', 'konum_adi'],
  ['FO-120-001', 'A', 'Fuel Oil', 'Zone', 'Z01'],
  ['FO-120-002', 'B', 'Fuel Oil', 'Block', 'B12'],
  ['CHW-340-021', 0, 'Chilled Water', 'Zone', 'Z03'],
];
const SPOOL_ROWS = [
  ['spool_no', 'izometri_no', 'revizyon', 'baslangic_durumu'],
  ['FO-120-001-SP01', 'FO-120-001', 'A', 'Başlamadı'],
  ['FO-120-001-SP02', 'FO-120-001', 'A', 'Başlamadı'],
  ['FO-120-002-SP01', 'FO-120-002', 'B', 'Devam Ediyor'],
];
const MAT_ROWS = [
  ['malzeme_kodu', 'malzeme_aciklamasi', 'cap_olcu', 'malzeme_kalitesi', 'birim', 'toplam_miktar', 'depo_stogu'],
  ['PIPE-DN50-CS', 'Boru', 'DN50', 'Carbon Steel', 'm', 240, 190],
  ['ELB-DN50-CS', '90 derece dirsek', 'DN50', 'Carbon Steel', 'adet', 48, 20],
  ['FLG-DN50-CS', 'Flanş', 'DN50', 'Carbon Steel', 'adet', 36, 18],
];
const SM_ROWS = [
  ['spool_no', 'izometri_no', 'revizyon', 'malzeme_kodu', 'miktar'],
  ['FO-120-001-SP01', 'FO-120-001', 'A', 'PIPE-DN50-CS', 8],
  ['FO-120-001-SP01', 'FO-120-001', 'A', 'ELB-DN50-CS', 3],
  ['FO-120-001-SP01', 'FO-120-001', 'A', 'FLG-DN50-CS', 2],
];

function fullProject(): ProjectData {
  let d = EMPTY_PROJECT_DATA;
  d = apply(d, previewIsometrics(xlsx(ISO_ROWS), d, NOW));
  d = apply(d, previewSpools(xlsx(SPOOL_ROWS), d, NOW));
  d = apply(d, previewMaterials(xlsx(MAT_ROWS), d, NOW));
  d = apply(d, previewSpoolMaterials(xlsx(SM_ROWS), d));
  return d;
}

function setStatus(d: ProjectData, spoolNo: string, status: SpoolStatus): ProjectData {
  return { ...d, spools: d.spools.map((s) => (s.spoolNo === spoolNo ? { ...s, status } : s)) };
}

describe('normalization (spec §4)', () => {
  it('konum_turu: Zone/Block variants, unknown → null (no silent Zone)', () => {
    for (const v of ['Zone', 'zone', 'ZONE', 'zon']) expect(normalizeLocationType(v)).toBe('Zone');
    for (const v of ['Block', 'block', 'Blok', 'blok', 'BLK']) expect(normalizeLocationType(v)).toBe('Block');
    for (const v of ['Deck', 'xyz', '', 'Z01']) expect(normalizeLocationType(v)).toBeNull();
  });
  it('baslangic_durumu: synonyms, unknown → null, blank → empty', () => {
    expect(normalizeStatus('Bekliyor')).toBe('baslamadi');
    expect(normalizeStatus('Not Started')).toBe('baslamadi');
    expect(normalizeStatus('Üretimde')).toBe('devam');
    expect(normalizeStatus('In Progress')).toBe('devam');
    expect(normalizeStatus('Tamamlandı')).toBe('bitti');
    expect(normalizeStatus('Completed')).toBe('bitti');
    expect(normalizeStatus('Done')).toBe('bitti');
    expect(normalizeStatus('BİTTİ')).toBe('bitti');
    expect(normalizeStatus('yanlış')).toBeNull();
    expect(normalizeStatus('')).toBe('empty');
  });
  it('parses quantities in TR and EN formats', () => {
    expect(parseQuantity(12)).toBe(12);
    expect(parseQuantity('12,5')).toBe(12.5);
    expect(parseQuantity('1.234,5')).toBe(1234.5);
    expect(parseQuantity('1,234.5')).toBe(1234.5);
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity('')).toBeNull();
  });
});

describe('Excel reading', () => {
  it('maps header aliases and Turkish headers, keeps real Excel row numbers', () => {
    const s = xlsx([['İzometri No', 'Rev', 'Sistem', 'Konum Türü', 'Konum Adı', 'Notlar'], ['A-1', 'A', 'FO', 'Zone', 'Z1', 'x'], [], ['A-2', 'A', 'FO', 'Zone', 'Z1', '']]);
    expect(s.columns).toEqual(['izometri_no', 'revizyon', 'sistem', 'konum_turu', 'konum_adi']);
    expect(s.unknownColumns).toEqual(['Notlar']);
    expect(s.rows.map((r) => r.rowNum)).toEqual([2, 4]);
  });
});

describe('Excel 1 — izometri import', () => {
  it('imports the spec example', () => {
    const p = previewIsometrics(xlsx(ISO_ROWS), EMPTY_PROJECT_DATA, NOW);
    expect(p.missingColumns).toEqual([]);
    expect(p.create).toHaveLength(3);
    expect(p.create[2]).toMatchObject({ isoNo: 'CHW-340-021', revision: '0', system: 'Chilled Water', locationType: 'Zone', locationName: 'Z03' });
  });
  it('reports missing columns and blocks commit', () => {
    const p = previewIsometrics(xlsx([['izometri_no', 'sistem'], ['A', 'FO']]), EMPTY_PROJECT_DATA, NOW);
    expect(p.missingColumns).toEqual(['revizyon', 'konum_turu', 'konum_adi']);
    expect(canCommit(p)).toBe(false);
  });
  it('rejects unknown konum_turu with an error instead of defaulting to Zone', () => {
    const p = previewIsometrics(xlsx([ISO_ROWS[0], ['X-1', 'A', 'FO', 'Deck', 'D1']]), EMPTY_PROJECT_DATA, NOW);
    expect(p.create).toHaveLength(0);
    expect(p.issues[0]).toMatchObject({ kind: 'invalid', rowNum: 2 });
  });
  it('flags in-file duplicates and does not re-create on re-upload', () => {
    const rows = [...ISO_ROWS, ['FO-120-001', 'A', 'Fuel Oil', 'Zone', 'Z01']];
    const p1 = previewIsometrics(xlsx(rows), EMPTY_PROJECT_DATA, NOW);
    expect(p1.create).toHaveLength(3);
    expect(p1.issues.filter((i) => i.kind === 'duplicate')).toHaveLength(1);
    const d = apply(EMPTY_PROJECT_DATA, p1);
    const p2 = previewIsometrics(xlsx(ISO_ROWS), d, NOW);
    expect(p2.create).toHaveLength(0);
    expect(p2.unchanged).toBe(3);
    expect(canCommit(p2)).toBe(false);
  });
  it('treats a new revision as a separate isometric and warns', () => {
    const d = apply(EMPTY_PROJECT_DATA, previewIsometrics(xlsx(ISO_ROWS), EMPTY_PROJECT_DATA, NOW));
    const p = previewIsometrics(xlsx([ISO_ROWS[0], ['FO-120-001', 'B', 'Fuel Oil', 'Zone', 'Z01']]), d, NOW);
    expect(p.create).toHaveLength(1);
    expect(p.issues[0].kind).toBe('warning');
  });
  it('reports a conflict when an existing iso+rev comes with a different location', () => {
    const d = apply(EMPTY_PROJECT_DATA, previewIsometrics(xlsx(ISO_ROWS), EMPTY_PROJECT_DATA, NOW));
    const p = previewIsometrics(xlsx([ISO_ROWS[0], ['FO-120-001', 'A', 'Fuel Oil', 'Zone', 'Z09']]), d, NOW);
    expect(p.create).toHaveLength(0);
    expect(p.issues[0].kind).toBe('conflict');
  });
  it('matches system names case-insensitively (no "fuel oil" second system)', () => {
    const p = previewIsometrics(xlsx([ISO_ROWS[0], ['A-1', 'A', 'Fuel Oil', 'Zone', 'Z1'], ['A-2', 'A', 'FUEL OIL', 'Zone', 'Z1']]), EMPTY_PROJECT_DATA, NOW);
    expect(new Set(p.create.map((i) => i.system))).toEqual(new Set(['Fuel Oil']));
  });
});

describe('Excel 2 — spool import', () => {
  const isoData = () => apply(EMPTY_PROJECT_DATA, previewIsometrics(xlsx(ISO_ROWS), EMPTY_PROJECT_DATA, NOW));

  it('links spools to iso by project + iso no + revision', () => {
    const p = previewSpools(xlsx(SPOOL_ROWS), isoData(), NOW);
    expect(p.create).toHaveLength(3);
    expect(p.create[2]).toMatchObject({ system: 'Fuel Oil', locationType: 'Block', locationName: 'B12', status: 'devam' });
  });
  it('does NOT attach a spool to another revision', () => {
    const p = previewSpools(xlsx([SPOOL_ROWS[0], ['FO-120-001-SP09', 'FO-120-001', 'C', 'Başlamadı']]), isoData(), NOW);
    expect(p.create).toHaveLength(0);
    expect(p.issues[0]).toMatchObject({ kind: 'unmatched' });
    expect(p.issues[0].message).toContain('rev C');
  });
  it('rejects unknown status, defaults blank status with a warning', () => {
    const p = previewSpools(
      xlsx([SPOOL_ROWS[0], ['S1', 'FO-120-001', 'A', 'belki'], ['S2', 'FO-120-001', 'A', '']]),
      isoData(),
      NOW,
    );
    expect(p.issues.map((i) => i.kind)).toEqual(['invalid', 'warning']);
    expect(p.create.map((s) => s.status)).toEqual(['baslamadi']);
  });
  it('re-upload keeps the production status set on the phone', () => {
    let d = apply(isoData(), previewSpools(xlsx(SPOOL_ROWS), isoData(), NOW));
    d = setStatus(d, 'FO-120-001-SP01', 'bitti');
    const p = previewSpools(xlsx(SPOOL_ROWS), d, NOW);
    expect(p.create).toHaveLength(0);
    expect(p.unchanged).toBe(3);
    expect(apply(d, p).spools.find((s) => s.spoolNo === 'FO-120-001-SP01')!.status).toBe('bitti');
  });
});

describe('Excel 3/4 — malzeme import', () => {
  it('updates stock on re-upload instead of duplicating', () => {
    let d = fullProject();
    const p = previewMaterials(xlsx([MAT_ROWS[0], ['PIPE-DN50-CS', 'Boru', 'DN50', 'Carbon Steel', 'm', 240, 150]]), d, NOW);
    expect(p.create).toHaveLength(0);
    expect(p.update).toHaveLength(1);
    d = apply(d, p);
    expect(d.materials).toHaveLength(3);
    expect(d.materials.find((m) => m.code === 'PIPE-DN50-CS')!.stockQty).toBe(150);
  });
  it('validates spool, iso, revision and material code before creating lines', () => {
    const d = fullProject();
    const p = previewSpoolMaterials(
      xlsx([
        SM_ROWS[0],
        ['FO-120-001-SP99', 'FO-120-001', 'A', 'PIPE-DN50-CS', 1], // unknown spool
        ['FO-120-001-SP01', 'FO-120-001', 'B', 'PIPE-DN50-CS', 1], // wrong revision
        ['FO-120-001-SP01', 'FO-120-001', 'A', 'XXX', 1], // unknown material
        ['FO-120-001-SP02', 'FO-120-001', 'A', 'PIPE-DN50-CS', 0], // zero qty
        ['FO-120-001-SP02', 'FO-120-001', 'A', 'PIPE-DN50-CS', '6,5'], // ok
      ]),
      d,
    );
    expect(p.issues.map((i) => i.kind)).toEqual(['unmatched', 'unmatched', 'unmatched', 'invalid']);
    expect(p.create).toEqual([expect.objectContaining({ materialCode: 'PIPE-DN50-CS', qty: 6.5 })]);
  });
});

describe('progress (spec §3)', () => {
  it('10 spools, 6 done → 60 %; all done → Bitti; none → Spool Tanımlanmamış', () => {
    const d = fullProject();
    const iso = d.isometrics[0];
    const spools = Array.from({ length: 10 }, (_, i) => ({
      ...d.spools[0],
      id: `s${i}`,
      isoId: iso.id,
      status: (i < 6 ? 'bitti' : 'baslamadi') as SpoolStatus,
    }));
    const [p] = isoProgress([iso], spools);
    expect(p.pct).toBe(60);
    expect(p.status).toBe('devam');
    const [p2] = isoProgress([iso], spools.map((s) => ({ ...s, status: 'bitti' as SpoolStatus })));
    expect(p2.status).toBe('bitti');
    const chw = isoProgress(d.isometrics, d.spools).find((x) => x.iso.isoNo === 'CHW-340-021')!;
    expect(chw.status).toBe('tanimsiz');
    expect(chw.total).toBe(0);
  });
  it('Zone → systems → spools cascade only shows related items', () => {
    const d = fullProject();
    const locs = locationOptions(d.isometrics);
    expect(locs.map((l) => `${l.locationType} ${l.locationName}`)).toEqual(['Block B12', 'Zone Z01', 'Zone Z03']);
    expect(systemOptions(d.isometrics, { locationType: 'Zone', locationName: 'Z03' })).toEqual(['Chilled Water']);
    expect(countSpools(d.spools)).toMatchObject({ total: 3, baslamadi: 2, devam: 1, bitti: 0 });
  });
});

describe('material calculation (spec §5)', () => {
  it('spec example: 240 total, 8 used, 190 stock → remaining 232, shortage 42', () => {
    const d = setStatus(fullProject(), 'FO-120-001-SP01', 'bitti');
    const pipe = computeMaterialRows(d).find((r) => r.material.code === 'PIPE-DN50-CS')!;
    expect(pipe).toMatchObject({ totalNeed: 240, usedDone: 8, remainingNeed: 232, stock: 190, shortage: 42 });
  });
  it('in-progress spools are reserved, not consumed', () => {
    const d = setStatus(fullProject(), 'FO-120-001-SP01', 'devam');
    const elb = computeMaterialRows(d).find((r) => r.material.code === 'ELB-DN50-CS')!;
    expect(elb).toMatchObject({ usedDone: 0, reservedInProgress: 3, remainingNeed: 48, shortage: 28 });
  });
  it('Bitti → Başlamadı gives the material back (no double deduction)', () => {
    let d = setStatus(fullProject(), 'FO-120-001-SP01', 'bitti');
    d = setStatus(d, 'FO-120-001-SP01', 'bitti'); // tapping Bitti twice
    expect(computeMaterialRows(d).find((r) => r.material.code === 'PIPE-DN50-CS')!.usedDone).toBe(8);
    d = setStatus(d, 'FO-120-001-SP01', 'baslamadi');
    const pipe = computeMaterialRows(d).find((r) => r.material.code === 'PIPE-DN50-CS')!;
    expect(pipe).toMatchObject({ usedDone: 0, notStartedNeed: 8, remainingNeed: 240, shortage: 50 });
    expect(d.materials.find((m) => m.code === 'PIPE-DN50-CS')!.totalQty).toBe(240); // stored data untouched
  });
  it('system/zone scope uses the spool BOM as total and hides stock', () => {
    const d = setStatus(fullProject(), 'FO-120-001-SP01', 'bitti');
    const rows = computeMaterialRows(d, { locationType: 'Zone', locationName: 'Z01', system: 'Fuel Oil' });
    const pipe = rows.find((r) => r.material.code === 'PIPE-DN50-CS')!;
    expect(pipe).toMatchObject({ totalNeed: 8, usedDone: 8, remainingNeed: 0, stock: null, shortage: null });
    expect(computeMaterialRows(d, { system: 'Chilled Water' })).toHaveLength(0);
  });
});
