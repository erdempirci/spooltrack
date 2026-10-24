// Excel import validation. Every function here is pure: it takes the parsed sheet and the
// current project data and returns a preview describing exactly what will be written.
// Nothing is saved until the user confirms the preview.

import type { ParsedSheet, SheetRow } from './excel';
import { isoKey, materialKey, spoolKey, spoolMaterialKey } from './keys';
import {
  cellText,
  fold,
  identifier,
  normalizeLocationType,
  normalizeStatus,
  parseQuantity,
  round3,
} from './normalize';
import type { Isometric, Material, ProjectData, Spool, SpoolMaterial } from './types';
import { STATUS_LABEL } from './types';

export type ImportKind = 'isometric' | 'spool' | 'material' | 'spoolMaterial';

export type IssueKind = 'invalid' | 'duplicate' | 'exists' | 'conflict' | 'unmatched' | 'skipped' | 'warning';

export const ISSUE_LABEL: Record<IssueKind, string> = {
  invalid: 'Geçersiz satır',
  duplicate: 'Dosyada mükerrer',
  exists: 'Zaten kayıtlı',
  conflict: 'Kayıtlı veriyle çelişiyor',
  unmatched: 'Eşleşmedi',
  skipped: 'Bilerek alınmadı',
  warning: 'Uyarı',
};

/** Issue kinds that mean the row is NOT imported. 'warning' rows are still imported. */
export const BLOCKING_ISSUES: IssueKind[] = ['invalid', 'duplicate', 'exists', 'conflict', 'unmatched', 'skipped'];

export interface RowIssue {
  rowNum: number;
  kind: IssueKind;
  ref: string;
  message: string;
}

export interface ImportPreview<T> {
  kind: ImportKind;
  fileName: string;
  sheetName: string;
  totalRows: number;
  missingColumns: string[];
  unknownColumns: string[];
  create: T[];
  update: T[];
  unchanged: number;
  issues: RowIssue[];
}

export const REQUIRED_COLUMNS: Record<ImportKind, string[]> = {
  isometric: ['izometri_no', 'revizyon', 'sistem', 'konum_turu', 'konum_adi'],
  spool: ['spool_no', 'izometri_no', 'revizyon', 'baslangic_durumu'],
  material: [
    'malzeme_kodu',
    'malzeme_aciklamasi',
    'cap_olcu',
    'malzeme_kalitesi',
    'birim',
    'toplam_miktar',
    'depo_stogu',
  ],
  spoolMaterial: ['spool_no', 'izometri_no', 'revizyon', 'malzeme_kodu', 'miktar'],
};

export function canCommit(p: ImportPreview<unknown>): boolean {
  return p.missingColumns.length === 0 && p.create.length + p.update.length > 0;
}

function basePreview<T>(kind: ImportKind, sheet: ParsedSheet): ImportPreview<T> {
  return {
    kind,
    fileName: sheet.fileName,
    sheetName: sheet.sheetName,
    totalRows: sheet.rows.length,
    missingColumns: REQUIRED_COLUMNS[kind].filter((c) => !sheet.columns.includes(c)),
    unknownColumns: sheet.unknownColumns,
    create: [],
    update: [],
    unchanged: 0,
    issues: [],
  };
}

function missingFields(row: SheetRow, fields: string[]): string[] {
  return fields.filter((f) => cellText(row.values[f]) === '');
}

const isoRef = (isoNo: string, rev: string) => `${isoNo || '?'} rev ${rev || '?'}`;

export function locLabel(x: { zone: string; block: string }): string {
  return [x.zone && `Zone ${x.zone}`, x.block && `Block ${x.block}`].filter(Boolean).join(' / ') || 'konumsuz';
}

// ───────────────────────────── Excel 1 — İzometri ─────────────────────────────

export function previewIsometrics(sheet: ParsedSheet, data: ProjectData, now: string): ImportPreview<Isometric> {
  const p = basePreview<Isometric>('isometric', sheet);
  if (p.missingColumns.length) return p;

  const existing = new Map(data.isometrics.map((i) => [i.id, i]));
  // System names are matched case-insensitively; the first spelling seen in the project wins.
  const systemSpelling = new Map<string, string>();
  for (const i of data.isometrics) if (!systemSpelling.has(fold(i.system))) systemSpelling.set(fold(i.system), i.system);
  const seen = new Map<string, number>();
  const revisionsByIso = new Map<string, Set<string>>();
  for (const i of data.isometrics) {
    if (!revisionsByIso.has(i.isoNo)) revisionsByIso.set(i.isoNo, new Set());
    revisionsByIso.get(i.isoNo)!.add(i.revision);
  }

  for (const row of sheet.rows) {
    const isoNo = identifier(row.values.izometri_no);
    const revision = identifier(row.values.revizyon);
    const ref = isoRef(isoNo, revision);

    const empty = missingFields(row, ['izometri_no', 'revizyon', 'sistem', 'konum_turu', 'konum_adi']);
    if (empty.length) {
      p.issues.push({ rowNum: row.rowNum, kind: 'invalid', ref, message: `Boş alan: ${empty.join(', ')}` });
      continue;
    }
    const locationType = normalizeLocationType(row.values.konum_turu);
    if (!locationType) {
      p.issues.push({
        rowNum: row.rowNum,
        kind: 'invalid',
        ref,
        message: `konum_turu "${cellText(row.values.konum_turu)}" tanınmadı. Zone veya Block yazın.`,
      });
      continue;
    }
    const rawSystem = cellText(row.values.sistem);
    const system = systemSpelling.get(fold(rawSystem)) ?? rawSystem;
    systemSpelling.set(fold(rawSystem), system);
    const locationName = identifier(row.values.konum_adi);
    const zone = locationType === 'Zone' ? locationName : '';
    const block = locationType === 'Block' ? locationName : '';
    const id = isoKey(isoNo, revision);

    const firstRow = seen.get(id);
    if (firstRow !== undefined) {
      p.issues.push({ rowNum: row.rowNum, kind: 'duplicate', ref, message: `Aynı izometri ve revizyon ${firstRow}. satırda da var; bu satır alınmadı.` });
      continue;
    }
    seen.set(id, row.rowNum);

    const old = existing.get(id);
    if (old) {
      if (fold(old.system) !== fold(system) || old.zone !== zone || old.block !== block) {
        p.issues.push({
          rowNum: row.rowNum,
          kind: 'conflict',
          ref,
          message: `Sistemde ${old.system} / ${locLabel(old)} olarak kayıtlı. Dosyadaki ${system} / ${locationType} ${locationName} uygulanmadı.`,
        });
      } else {
        p.unchanged++;
        p.issues.push({ rowNum: row.rowNum, kind: 'exists', ref, message: 'Bu izometri ve revizyon zaten kayıtlı; tekrar oluşturulmadı.' });
      }
      continue;
    }

    const otherRevs = [...(revisionsByIso.get(isoNo) ?? [])].filter((r) => r !== revision);
    if (otherRevs.length) {
      p.issues.push({
        rowNum: row.rowNum,
        kind: 'warning',
        ref,
        message: `Yeni revizyon. Rev ${otherRevs.join(', ')} ayrı kayıt olarak kalır; spoollar revizyonlar arasında taşınmaz.`,
      });
    }

    p.create.push({ id, isoNo, revision, system, zone, block, createdAt: now });
  }
  return p;
}

// ───────────────────────────── Excel 2 — Spool ─────────────────────────────

export function previewSpools(sheet: ParsedSheet, data: ProjectData, now: string): ImportPreview<Spool> {
  const p = basePreview<Spool>('spool', sheet);
  if (p.missingColumns.length) return p;

  const isos = new Map(data.isometrics.map((i) => [i.id, i]));
  const isoNos = new Set(data.isometrics.map((i) => i.isoNo));
  const existing = new Map(data.spools.map((s) => [s.id, s]));
  const seen = new Map<string, number>();

  for (const row of sheet.rows) {
    const spoolNo = identifier(row.values.spool_no);
    const isoNo = identifier(row.values.izometri_no);
    const revision = identifier(row.values.revizyon);
    const ref = `${spoolNo || '?'} (${isoRef(isoNo, revision)})`;

    const empty = missingFields(row, ['spool_no', 'izometri_no', 'revizyon']);
    if (empty.length) {
      p.issues.push({ rowNum: row.rowNum, kind: 'invalid', ref, message: `Boş alan: ${empty.join(', ')}` });
      continue;
    }
    const st = normalizeStatus(row.values.baslangic_durumu);
    if (st === null) {
      p.issues.push({
        rowNum: row.rowNum,
        kind: 'invalid',
        ref,
        message: `baslangic_durumu "${cellText(row.values.baslangic_durumu)}" tanınmadı. Başlamadı, Devam Ediyor veya Bitti yazın.`,
      });
      continue;
    }

    const isoId = isoKey(isoNo, revision);
    const iso = isos.get(isoId);
    if (!iso) {
      p.issues.push({
        rowNum: row.rowNum,
        kind: 'unmatched',
        ref,
        message: isoNos.has(isoNo)
          ? `${isoNo} var ama rev ${revision} kayıtlı değil. Spool başka revizyona bağlanmadı.`
          : `${isoNo} rev ${revision} izometri listesinde yok. Önce izometri Excel'ini yükleyin.`,
      });
      continue;
    }

    const id = spoolKey(isoId, spoolNo);
    const firstRow = seen.get(id);
    if (firstRow !== undefined) {
      p.issues.push({ rowNum: row.rowNum, kind: 'duplicate', ref, message: `Aynı spool ${firstRow}. satırda da var; bu satır alınmadı.` });
      continue;
    }
    seen.set(id, row.rowNum);

    const old = existing.get(id);
    if (old) {
      p.unchanged++;
      p.issues.push({
        rowNum: row.rowNum,
        kind: 'exists',
        ref,
        message: `Zaten kayıtlı. Mevcut durum (${STATUS_LABEL[old.status]}) korunur, Excel'deki durum uygulanmaz.`,
      });
      continue;
    }

    const status = st === 'empty' ? 'baslamadi' : st;
    if (st === 'empty') {
      p.issues.push({ rowNum: row.rowNum, kind: 'warning', ref, message: 'baslangic_durumu boş; Başlamadı olarak alınacak.' });
    }
    p.create.push({
      id,
      isoId,
      spoolNo,
      isoNo: iso.isoNo,
      revision: iso.revision,
      system: iso.system,
      zone: iso.zone,
      block: iso.block,
      status,
      updatedAt: now,
    });
  }
  return p;
}

// ───────────────────────────── Excel 3 — Toplam malzeme ─────────────────────────────

export function previewMaterials(sheet: ParsedSheet, data: ProjectData, now: string): ImportPreview<Material> {
  const p = basePreview<Material>('material', sheet);
  if (p.missingColumns.length) return p;

  const existing = new Map(data.materials.map((m) => [m.id, m]));
  const seen = new Map<string, number>();

  for (const row of sheet.rows) {
    const code = identifier(row.values.malzeme_kodu);
    const ref = code || '?';
    const empty = missingFields(row, ['malzeme_kodu', 'malzeme_aciklamasi', 'birim', 'toplam_miktar']);
    if (empty.length) {
      p.issues.push({ rowNum: row.rowNum, kind: 'invalid', ref, message: `Boş alan: ${empty.join(', ')}` });
      continue;
    }
    const total = parseQuantity(row.values.toplam_miktar);
    if (total === null || total < 0) {
      p.issues.push({ rowNum: row.rowNum, kind: 'invalid', ref, message: `toplam_miktar "${cellText(row.values.toplam_miktar)}" geçerli bir sayı değil.` });
      continue;
    }
    let stock = parseQuantity(row.values.depo_stogu);
    if (cellText(row.values.depo_stogu) === '') {
      stock = 0;
      p.issues.push({ rowNum: row.rowNum, kind: 'warning', ref, message: 'depo_stogu boş; 0 olarak alınacak.' });
    } else if (stock === null || stock < 0) {
      p.issues.push({ rowNum: row.rowNum, kind: 'invalid', ref, message: `depo_stogu "${cellText(row.values.depo_stogu)}" geçerli bir sayı değil.` });
      continue;
    }

    const id = materialKey(code);
    const firstRow = seen.get(id);
    if (firstRow !== undefined) {
      p.issues.push({ rowNum: row.rowNum, kind: 'duplicate', ref, message: `Aynı malzeme kodu ${firstRow}. satırda da var; bu satır alınmadı.` });
      continue;
    }
    seen.set(id, row.rowNum);

    const m: Material = {
      id,
      code,
      description: cellText(row.values.malzeme_aciklamasi),
      size: cellText(row.values.cap_olcu),
      grade: cellText(row.values.malzeme_kalitesi),
      unit: cellText(row.values.birim),
      totalQty: round3(total),
      stockQty: round3(stock!),
      updatedAt: now,
    };
    const old = existing.get(id);
    if (!old) {
      p.create.push(m);
    } else if (
      old.description !== m.description ||
      old.size !== m.size ||
      old.grade !== m.grade ||
      old.unit !== m.unit ||
      old.totalQty !== m.totalQty ||
      old.stockQty !== m.stockQty
    ) {
      // Material master data (stock in particular) is expected to be re-uploaded: update in place.
      p.update.push(m);
      const changes: string[] = [];
      if (old.totalQty !== m.totalQty) changes.push(`toplam ${old.totalQty} → ${m.totalQty}`);
      if (old.stockQty !== m.stockQty) changes.push(`stok ${old.stockQty} → ${m.stockQty}`);
      if (old.description !== m.description || old.size !== m.size || old.grade !== m.grade || old.unit !== m.unit)
        changes.push('tanım bilgileri');
      p.issues.push({ rowNum: row.rowNum, kind: 'warning', ref, message: `Mevcut kayıt güncellenecek: ${changes.join(', ')}.` });
    } else {
      p.unchanged++;
    }
  }
  return p;
}

// ───────────────────────────── Excel 4 — Spool malzeme ─────────────────────────────

export function previewSpoolMaterials(
  sheet: ParsedSheet,
  data: ProjectData,
): ImportPreview<SpoolMaterial> {
  const p = basePreview<SpoolMaterial>('spoolMaterial', sheet);
  if (p.missingColumns.length) return p;

  const isos = new Map(data.isometrics.map((i) => [i.id, i]));
  const spools = new Map(data.spools.map((s) => [s.id, s]));
  const materials = new Map(data.materials.map((m) => [m.code, m]));
  const existing = new Map(data.spoolMaterials.map((sm) => [sm.id, sm]));
  const seen = new Map<string, number>();

  for (const row of sheet.rows) {
    const spoolNo = identifier(row.values.spool_no);
    const isoNo = identifier(row.values.izometri_no);
    const revision = identifier(row.values.revizyon);
    const code = identifier(row.values.malzeme_kodu);
    const ref = `${spoolNo || '?'} / ${code || '?'}`;

    const empty = missingFields(row, REQUIRED_COLUMNS.spoolMaterial);
    if (empty.length) {
      p.issues.push({ rowNum: row.rowNum, kind: 'invalid', ref, message: `Boş alan: ${empty.join(', ')}` });
      continue;
    }
    const qty = parseQuantity(row.values.miktar);
    if (qty === null || qty <= 0) {
      p.issues.push({ rowNum: row.rowNum, kind: 'invalid', ref, message: `miktar "${cellText(row.values.miktar)}" sıfırdan büyük bir sayı olmalı.` });
      continue;
    }
    const isoId = isoKey(isoNo, revision);
    if (!isos.has(isoId)) {
      p.issues.push({ rowNum: row.rowNum, kind: 'unmatched', ref, message: `${isoRef(isoNo, revision)} izometri listesinde yok.` });
      continue;
    }
    const spoolId = spoolKey(isoId, spoolNo);
    if (!spools.has(spoolId)) {
      p.issues.push({ rowNum: row.rowNum, kind: 'unmatched', ref, message: `${spoolNo} spoolu ${isoRef(isoNo, revision)} altında kayıtlı değil.` });
      continue;
    }
    if (!materials.has(code)) {
      p.issues.push({ rowNum: row.rowNum, kind: 'unmatched', ref, message: `${code} toplam malzeme listesinde yok. Önce toplam malzeme listesini yükleyin.` });
      continue;
    }
    const id = spoolMaterialKey(spoolId, code);
    const firstRow = seen.get(id);
    if (firstRow !== undefined) {
      p.issues.push({
        rowNum: row.rowNum,
        kind: 'duplicate',
        ref,
        message: `Aynı spool ve malzeme ${firstRow}. satırda da var; bu satır alınmadı. Miktarları tek satırda toplayın.`,
      });
      continue;
    }
    seen.set(id, row.rowNum);

    const sm: SpoolMaterial = { id, spoolId, materialCode: code, qty: round3(qty) };
    const old = existing.get(id);
    if (!old) p.create.push(sm);
    else if (old.qty !== sm.qty) {
      p.update.push(sm);
      p.issues.push({ rowNum: row.rowNum, kind: 'warning', ref, message: `Kayıtlı miktar ${old.qty} → ${sm.qty} olarak güncellenecek.` });
    } else p.unchanged++;
  }

  // After the import, does the spool BOM exceed the total material list?
  const after = new Map(data.spoolMaterials.map((sm) => [sm.id, sm]));
  for (const sm of [...p.create, ...p.update]) after.set(sm.id, sm);
  const sums = new Map<string, number>();
  for (const sm of after.values()) sums.set(sm.materialCode, (sums.get(sm.materialCode) ?? 0) + sm.qty);
  for (const [code, sum] of sums) {
    const m = materials.get(code);
    if (m && round3(sum) > m.totalQty) {
      p.issues.push({
        rowNum: 0,
        kind: 'warning',
        ref: code,
        message: `Spool listelerindeki toplam ${round3(sum)} ${m.unit}, toplam ihtiyaçtan (${m.totalQty} ${m.unit}) fazla. Toplam malzeme listesini kontrol edin.`,
      });
    }
  }
  return p;
}
