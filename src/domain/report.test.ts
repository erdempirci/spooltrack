import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { LocalRepo } from '../data/localRepo';
import { readWorkbook } from './excel';
import { computeMaterialRows } from './materials';
import { isosInSelection, locationOptions, systemOptions } from './progress';
import { pipelineKey, previewReport, reportCanCommit } from './report';
import { EMPTY_PROJECT_DATA, type ProjectData } from './types';

const NOW = '2026-10-25T00:00:00Z';
const TITLE = [
  [null, null, null, 'HULL NO', 'NB012', null, 'DATE', 46260],
  [],
  [null, null, null, null, null, null, 'REVISION NO', 'A0'],
  [],
  ['SPOOL LIST'],
  [],
  [],
];
const SPOOL_HEAD = ['Zone', 'Block', 'System Name', 'Pipeline', 'Spool No', 'Revision', 'Production Note'];
const MAT_HEAD = ['Description', 'Size / Dimensions', 'Rating', 'Class Cert.', 'Angle ', 'Material', 'Standard', 'Quantity(Pcs/m)'];

/** Same layout as NB012-ZC1-GENERAL_REPORTS.xlsx: title block, header on row 8, two sheets. */
function report(spoolRows: unknown[][], matRows: unknown[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...TITLE, SPOOL_HEAD, ...spoolRows]), 'Spool List');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...TITLE, MAT_HEAD, ...matRows]), 'Material List');
  return readWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'NB012-ZC1-GENERAL_REPORTS.xlsx');
}

const SPOOLS = [
  ['C1', 107, '103 Fuel Oil TK', '5211-P1013', 'S01', 'A1', null],
  ['C1', 107, '103 Fuel Oil TK', '5211-P4013', 'S01', 'A1', null],
  ['C1', 107, '103 Fuel Oil TK', '5211-P4013', 'S02', 'A3', 'SLEEVE IS ADDED.'],
  ['C1', 207, '5211-C1_Fuel Transfer Sytem_ST', '5211-1015', 'S01', 'A0', 'DO NOT WELD!! WILL BE ADJUSTED ON BOARD!!'],
  ['C1', '208', '5211-C1_Fuel Transfer Sytem_ST', '5211-1015', 'S02', 'A1', null], // block as text, other block
  ['C1', 108, '802 Ballast Water TK_SS', '5351-SO2052', 'S01', 'A3', null],
  ['C1', 208, '802 Ballast Water TK_SS', '5351-SO2052', 'S01', 'A3', null], // duplicate in another block
  ['C1', 208, '5291-C1_Deck Scupper System_SS', '5291-2064', 'S01', 'A1', 'DELETE SPOOL'],
  [],
];
const MATS = [
  ['HYDRAULIC PIPE, STAINLESS STEEL, S', '38x3.0', 'PN10/16', 'ClassII', null, '316L', 'ASTM A269', 84808],
  ['Elbow 1.5D', '88.9x2.0', 'PN10/16', 'Class-III', 90, 'CuNi10Fe1.6Mn', 'DIN 86090', 4],
  ['Elbow 1.5D', '88.9x2.0', 'PN10/16', 'Class-III', 90, 'CuNi10Fe1.6Mn', 'DIN 86090', 6], // same item listed twice
  ['Elbow 1.5D', '88.9x2.0', 'PN10/16', 'Class-III', 45, 'CuNi10Fe1.6Mn', 'DIN 86090', 2], // different angle
  [null, null, null, null, null, null, null, 2044693], // totals row
];

function apply(d: ProjectData, r: ReturnType<typeof previewReport>): ProjectData {
  const up = <T extends { id: string }>(list: T[], p: { create: T[]; update: T[] } | null) => {
    const m = new Map(list.map((x) => [x.id, x]));
    for (const x of [...(p?.create ?? []), ...(p?.update ?? [])]) m.set(x.id, { ...m.get(x.id), ...x });
    return [...m.values()];
  };
  return { ...d, isometrics: up(d.isometrics, r.isometrics), spools: up(d.spools, r.spools), materials: up(d.materials, r.materials) };
}

describe('Shipyard GENERAL_REPORTS workbook', () => {
  it('finds the header below the title block and reads HULL NO', () => {
    const sheets = report(SPOOLS, MATS);
    expect(sheets[0].headerRow).toBe(8);
    expect(sheets[0].meta).toMatchObject({ hullNo: 'NB012', revisionNo: 'A0' });
    expect(sheets[0].columns).toEqual(['zone', 'block', 'sistem', 'izometri_no', 'spool_no', 'revizyon', 'not']);
    expect(sheets[1].columns).toEqual(['malzeme_aciklamasi', 'cap_olcu', 'rating', 'class_cert', 'angle', 'malzeme_kalitesi', 'standard', 'toplam_miktar']);
  });

  it('builds pipelines as isometrics and keeps zone, block, revision and note per spool', () => {
    const r = previewReport(report(SPOOLS, MATS), EMPTY_PROJECT_DATA, NOW);
    expect(r.spoolSheet).toBe('Spool List');
    expect(r.materialSheet).toBe('Material List');
    expect(r.spools!.create).toHaveLength(6);
    expect(r.isometrics!.create.map((i) => `${i.isoNo}@${i.revision}`).sort()).toEqual([
      '5211-1015@A1', '5211-P1013@A1', '5211-P4013@A3', '5351-SO2052@A3',
    ]);
    const s02 = r.spools!.create.find((s) => s.isoNo === '5211-1015' && s.spoolNo === 'S02')!;
    expect(s02).toMatchObject({ zone: 'C1', block: '208', revision: 'A1', status: 'baslamadi', isoId: pipelineKey('5211-1015') });
    expect(r.spools!.create.find((s) => s.spoolNo === 'S01' && s.isoNo === '5211-1015')!.note).toContain('DO NOT WELD');
    const kinds = r.spools!.issues.map((i) => i.kind);
    expect(kinds).toContain('duplicate'); // 5351-SO2052 S01 twice
    expect(kinds).toContain('skipped'); // DELETE SPOOL
    expect(reportCanCommit(r)).toBe(true);
  });

  it('Zone/Block cascade: Block 207 shows only its systems; a split pipeline is listed in both blocks with full progress', () => {
    const d = apply(EMPTY_PROJECT_DATA, previewReport(report(SPOOLS, MATS), EMPTY_PROJECT_DATA, NOW));
    expect(locationOptions([...d.spools, ...d.isometrics]).map((l) => `${l.locationType} ${l.locationName}`)).toEqual([
      'Zone C1', 'Block 107', 'Block 108', 'Block 207', 'Block 208',
    ]);
    expect(systemOptions(d.spools, { locationType: 'Block', locationName: '207' })).toEqual(['5211-C1_Fuel Transfer Sytem_ST']);
    const done = { ...d, spools: d.spools.map((s) => (s.isoNo === '5211-1015' && s.spoolNo === 'S01' ? { ...s, status: 'bitti' as const } : s)) };
    const in207 = isosInSelection(done.isometrics, done.spools, { locationType: 'Block', locationName: '207', system: '5211-C1_Fuel Transfer Sytem_ST' });
    expect(in207).toHaveLength(1);
    expect(in207[0]).toMatchObject({ total: 2, bitti: 1, pct: 50, status: 'devam' }); // counts the spool in Block 208 too
  });

  it('material summary: generated codes, duplicates summed, totals row skipped, units mm/adet, stock 0', () => {
    const r = previewReport(report(SPOOLS, MATS), EMPTY_PROJECT_DATA, NOW);
    const m = r.materials!;
    expect(m.create).toHaveLength(3);
    const pipe = m.create.find((x) => x.description.startsWith('HYDRAULIC'))!;
    expect(pipe).toMatchObject({ unit: 'mm', totalQty: 84808, stockQty: 0, grade: '316L', spec: 'PN10/16 · ClassII · ASTM A269' });
    const elb90 = m.create.find((x) => x.spec?.includes('90°'))!;
    expect(elb90).toMatchObject({ unit: 'adet', totalQty: 10 });
    expect(m.create.find((x) => x.spec?.includes('45°'))!.totalQty).toBe(2);
    expect(m.issues.find((i) => i.kind === 'skipped')!.message).toContain('2044693');
    // Same input → same code (re-upload safe)
    const again = previewReport(report(SPOOLS, MATS), EMPTY_PROJECT_DATA, NOW).materials!;
    expect(again.create.map((x) => x.code).sort()).toEqual(m.create.map((x) => x.code).sort());
    const rows = computeMaterialRows(apply(EMPTY_PROJECT_DATA, r));
    expect(rows.find((x) => x.material.id === pipe.id)).toMatchObject({ remainingNeed: 84808, shortage: 84808 });
  });

  it('re-upload of a newer report: no duplicates, revision/note updated, phone status kept', async () => {
    const repo = new LocalRepo(`rep-${Math.random()}`);
    const p = await repo.createProject('NB012');
    const snap = () => new Promise<ProjectData>((res, rej) => { const u = repo.subscribeProjectData(p.id, (d) => { u(); res(d); }, rej); });
    const commit = async (r: ReturnType<typeof previewReport>) => {
      await repo.commitImport(p.id, 'isometric', r.isometrics!);
      await repo.commitImport(p.id, 'spool', r.spools!);
      await repo.commitImport(p.id, 'material', r.materials!);
    };
    await commit(previewReport(report(SPOOLS, MATS), await snap(), NOW));
    let d = await snap();
    expect(d.spools).toHaveLength(6);
    const target = d.spools.find((s) => s.isoNo === '5211-P1013')!;
    await repo.setSpoolStatus(p.id, target.id, 'bitti', { uid: 'u', email: '', name: '', role: 'engineer' });

    const newer = SPOOLS.map((r) => (r[3] === '5211-P1013' ? ['C1', 107, '103 Fuel Oil TK', '5211-P1013', 'S01', 'A2', 'SPOOL DIMENSIONS UPDATED'] : r));
    const r2 = previewReport(report(newer, MATS), await snap(), NOW);
    expect(r2.spools!.create).toHaveLength(0);
    expect(r2.spools!.update).toHaveLength(1);
    expect(r2.spools!.issues.find((i) => i.kind === 'warning' && i.ref.includes('5211-P1013'))!.message).toContain('A1 → A2');
    expect(r2.materials!.create).toHaveLength(0);
    expect(r2.materials!.unchanged).toBe(3);
    await commit(r2);
    d = await snap();
    expect(d.spools).toHaveLength(6);
    expect(d.isometrics).toHaveLength(4);
    expect(d.materials).toHaveLength(3);
    expect(d.spools.find((s) => s.id === target.id)).toMatchObject({ revision: 'A2', note: 'SPOOL DIMENSIONS UPDATED', status: 'bitti' });
    expect(d.isometrics.find((i) => i.isoNo === '5211-P1013')!.revision).toBe('A2');
  });
});
