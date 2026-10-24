import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readWorkbook } from './excel';
import { computeMaterialRows } from './materials';
import { countSpools, isoProgress, locationOptions, systemOptions } from './progress';
import { previewReport } from './report';
import { EMPTY_PROJECT_DATA } from './types';

const FILE = process.env.REAL_FILE;
describe.skipIf(!FILE)('real report file', () => {
  it('imports', () => {
    const buf = readFileSync(FILE!);
    const sheets = readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, 'real.xlsx');
    const r = previewReport(sheets, EMPTY_PROJECT_DATA, new Date().toISOString());
    const sum = (p: any) => p && { rows: p.totalRows, create: p.create.length, update: p.update.length, unchanged: p.unchanged, missing: p.missingColumns,
      issues: Object.entries(p.issues.reduce((a: any, i: any) => ((a[i.kind] = (a[i.kind] ?? 0) + 1), a), {})) };
    console.log('META', r.meta, 'sheets', r.spoolSheet, r.materialSheet, 'ignored', r.ignoredSheets);
    console.log('ISO', JSON.stringify(sum(r.isometrics)));
    console.log('SPOOL', JSON.stringify(sum(r.spools)));
    console.log('MAT', JSON.stringify(sum(r.materials)));
    for (const i of [...r.spools!.issues, ...r.isometrics!.issues, ...r.materials!.issues].filter((i) => i.kind !== 'warning' || i.rowNum === 0)) console.log('  ', i.kind, i.rowNum, i.ref, '|', i.message);
    const d = { ...EMPTY_PROJECT_DATA, isometrics: r.isometrics!.create, spools: r.spools!.create, materials: r.materials!.create };
    const locs = locationOptions([...d.spools, ...d.isometrics]);
    console.log('LOCATIONS', locs.map((l) => `${l.locationType} ${l.locationName}`).join(', '));
    console.log('SYSTEMS in Block 207:', systemOptions(d.spools, { locationType: 'Block', locationName: '207' }).length);
    console.log('COUNTS', countSpools(d.spools), 'ISOs', isoProgress(d.isometrics, d.spools).length);
    console.log('MAT rows', computeMaterialRows(d).length, 'units', computeMaterialRows(d).reduce((a: any, m) => ((a[m.material.unit] = (a[m.material.unit] ?? 0) + 1), a), {}));
    expect(r.spools!.create.length).toBeGreaterThan(0);
  });
});
