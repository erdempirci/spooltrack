// Shipyard "GENERAL_REPORTS" workbook (e.g. NB012-ZC1-GENERAL_REPORTS.xlsx):
//   Sheet "Spool List":    Zone | Block | System Name | Pipeline | Spool No | Revision | Production Note
//   Sheet "Material List": Description | Size / Dimensions | Rating | Class Cert. | Angle | Material | Standard | Quantity(Pcs/m)
// Both sheets have a title block (HULL NO, DATE, REVISION NO) above the header row.
//
// Differences from the plain templates, handled here:
//   • Revision is given PER SPOOL (one pipeline can have S01 at A1 and S02 at A3). The pipeline is
//     the isometric; each spool keeps its own revision; the isometric shows the highest one.
//   • Every spool has both a Zone and a Block, and one pipeline's spools can be in different blocks.
//   • The material list is a summary: no material code, no stock, no per-spool breakdown.

import type { ParsedSheet } from './excel';
import { BLOCKING_ISSUES, type ImportPreview } from './importers';
import { isoKey, materialKey, spoolKey } from './keys';
import { cellText, fold, identifier, normalizeStatus, parseQuantity, round3 } from './normalize';
import { STATUS_LABEL, type Isometric, type Material, type ProjectData, type Spool } from './types';

export interface ReportMeta {
  hullNo?: string;
  revisionNo?: string;
  date?: string;
}

export interface ReportPreview {
  fileName: string;
  meta: ReportMeta;
  spoolSheet: string | null;
  materialSheet: string | null;
  ignoredSheets: string[];
  isometrics: ImportPreview<Isometric> | null;
  spools: ImportPreview<Spool> | null;
  materials: ImportPreview<Material> | null;
}

const isSpoolList = (s: ParsedSheet) =>
  s.columns.includes('izometri_no') && s.columns.includes('spool_no') && (s.columns.includes('zone') || s.columns.includes('block'));
const isMaterialSummary = (s: ParsedSheet) =>
  s.columns.includes('malzeme_aciklamasi') && s.columns.includes('toplam_miktar') && !s.columns.includes('malzeme_kodu');

/** True when the workbook looks like a shipyard report rather than a single-template file. */
export function isShipyardReport(sheets: ParsedSheet[]): boolean {
  return sheets.some(isSpoolList) || sheets.some(isMaterialSummary);
}

export function previewReport(sheets: ParsedSheet[], data: ProjectData, now: string): ReportPreview {
  const spoolSheet = sheets.find(isSpoolList) ?? null;
  const materialSheet = sheets.find(isMaterialSummary) ?? null;
  const meta: ReportMeta = { ...(materialSheet?.meta ?? {}), ...(spoolSheet?.meta ?? {}) };
  const sl = spoolSheet ? previewSpoolList(spoolSheet, data, now) : null;
  return {
    fileName: sheets[0]?.fileName ?? '',
    meta,
    spoolSheet: spoolSheet?.sheetName ?? null,
    materialSheet: materialSheet?.sheetName ?? null,
    ignoredSheets: sheets.filter((s) => s !== spoolSheet && s !== materialSheet).map((s) => s.sheetName),
    isometrics: sl?.isometrics ?? null,
    spools: sl?.spools ?? null,
    materials: materialSheet ? previewMaterialSummary(materialSheet, data, now) : null,
  };
}

/** Revision order: A0 < A1 < A3 < A10 < B0 (numeric-aware). */
function maxRevision(revs: Iterable<string>): string {
  let best = '';
  for (const r of revs) if (!best || r.localeCompare(best, 'en', { numeric: true }) > 0) best = r;
  return best;
}

/** The isometric key for report data: the pipeline alone (revisions live on the spools). */
export function pipelineKey(pipeline: string): string {
  return isoKey(pipeline, '');
}

function isDeleteNote(note: string): boolean {
  const n = fold(note);
  return /\bdelete\b/.test(n) || n.includes('spool sil') || n.includes('iptal');
}

function empty<T>(kind: ImportPreview<T>['kind'], sheet: ParsedSheet, required: string[]): ImportPreview<T> {
  return {
    kind,
    fileName: sheet.fileName,
    sheetName: sheet.sheetName,
    totalRows: sheet.rows.length,
    missingColumns: required.filter((c) => !sheet.columns.includes(c)),
    unknownColumns: sheet.unknownColumns,
    create: [],
    update: [],
    unchanged: 0,
    issues: [],
  };
}

// ───────────────────────────── Spool List ─────────────────────────────

export function previewSpoolList(sheet: ParsedSheet, data: ProjectData, now: string) {
  const spools = empty<Spool>('spool', sheet, ['izometri_no', 'spool_no', 'revizyon', 'sistem']);
  const isometrics = empty<Isometric>('isometric', sheet, []);
  isometrics.totalRows = 0;
  if (spools.missingColumns.length) return { isometrics, spools };

  const existingSpools = new Map(data.spools.map((s) => [s.id, s]));
  const existingIsos = new Map(data.isometrics.map((i) => [i.id, i]));
  const systemSpelling = new Map<string, string>();
  for (const x of [...data.isometrics, ...data.spools]) if (!systemSpelling.has(fold(x.system))) systemSpelling.set(fold(x.system), x.system);

  const seen = new Map<string, { rowNum: number; where: string }>();
  // pipeline → accepted rows (to build the isometric afterwards)
  const pipelines = new Map<string, { system: string; zone: string; block: string; revs: string[]; firstRow: number }>();

  for (const row of sheet.rows) {
    const pipeline = identifier(row.values.izometri_no);
    const spoolNo = identifier(row.values.spool_no);
    const revision = identifier(row.values.revizyon);
    const zone = identifier(row.values.zone);
    const block = identifier(row.values.block);
    const note = cellText(row.values.not);
    const where = [zone && `Zone ${zone}`, block && `Block ${block}`].filter(Boolean).join(' / ');
    const ref = `${pipeline || '?'} ${spoolNo || '?'}`;

    const missing = ['izometri_no', 'spool_no', 'revizyon', 'sistem'].filter((f) => cellText(row.values[f]) === '');
    if (missing.length) {
      spools.issues.push({ rowNum: row.rowNum, kind: 'invalid', ref, message: `Boş alan: ${missing.join(', ')}` });
      continue;
    }
    if (!zone && !block) {
      spools.issues.push({ rowNum: row.rowNum, kind: 'invalid', ref, message: 'Zone ve Block ikisi de boş.' });
      continue;
    }
    let status: Spool['status'] = 'baslamadi';
    if (sheet.columns.includes('baslangic_durumu')) {
      const st = normalizeStatus(row.values.baslangic_durumu);
      if (st === null) {
        spools.issues.push({ rowNum: row.rowNum, kind: 'invalid', ref, message: `Durum "${cellText(row.values.baslangic_durumu)}" tanınmadı.` });
        continue;
      }
      if (st !== 'empty') status = st;
    }

    const rawSystem = cellText(row.values.sistem);
    const system = systemSpelling.get(fold(rawSystem)) ?? rawSystem;
    systemSpelling.set(fold(rawSystem), system);

    const isoId = pipelineKey(pipeline);
    const id = spoolKey(isoId, spoolNo);
    const first = seen.get(id);
    if (first) {
      spools.issues.push({
        rowNum: row.rowNum,
        kind: 'duplicate',
        ref,
        message: `Aynı pipeline + spool ${first.rowNum}. satırda da var (${first.where}); bu satır (${where}) alınmadı. Raporda kontrol edin.`,
      });
      continue;
    }
    seen.set(id, { rowNum: row.rowNum, where });

    const old = existingSpools.get(id);
    if (note && isDeleteNote(note)) {
      spools.issues.push({
        rowNum: row.rowNum,
        kind: 'skipped',
        ref,
        message: old
          ? `Raporda "${note}" yazıyor ama spool sistemde kayıtlı (durum: ${STATUS_LABEL[old.status]}). Uygulamada silinmedi; kontrol edin.`
          : `Raporda "${note}" yazıyor; spool olarak alınmadı.`,
      });
      continue;
    }

    const p = pipelines.get(pipeline) ?? { system, zone, block, revs: [], firstRow: row.rowNum };
    p.revs.push(revision);
    pipelines.set(pipeline, p);

    const fields = { revision, system, zone, block, note: note || undefined };
    if (!old) {
      spools.create.push({ id, isoId, spoolNo, isoNo: pipeline, ...fields, status, updatedAt: now });
      continue;
    }
    const changes: string[] = [];
    if (old.revision !== revision) changes.push(`revizyon ${old.revision} → ${revision}`);
    if ((old.note ?? '') !== note) changes.push('üretim notu');
    if (old.system !== system) changes.push(`sistem ${old.system} → ${system}`);
    if (old.zone !== zone || old.block !== block) changes.push(`konum ${[old.zone, old.block].filter(Boolean).join('/')} → ${[zone, block].filter(Boolean).join('/')}`);
    if (!changes.length) {
      spools.unchanged++;
      continue;
    }
    // Status is never taken from the report for an existing spool.
    spools.update.push({ ...old, ...fields, note: note || '' });
    const revWarn = old.revision !== revision && old.status !== 'baslamadi'
      ? ` Durum "${STATUS_LABEL[old.status]}" korunur; revizyon değiştiği için sahada kontrol edin.`
      : ` Durum (${STATUS_LABEL[old.status]}) korunur.`;
    spools.issues.push({ rowNum: row.rowNum, kind: 'warning', ref, message: `Güncellenecek: ${changes.join(', ')}.${revWarn}` });
  }

  // Spools in the project that this report no longer lists.
  const reportPipelines = new Set(pipelines.keys());
  for (const s of data.spools) {
    if (reportPipelines.has(s.isoNo) && !seen.has(s.id)) {
      spools.issues.push({ rowNum: 0, kind: 'warning', ref: `${s.isoNo} ${s.spoolNo}`, message: 'Sistemde kayıtlı ama bu raporda yok. Silinmedi; kontrol edin.' });
    }
  }

  // One isometric per pipeline; its revision is the highest spool revision.
  for (const [pipeline, p] of pipelines) {
    const id = pipelineKey(pipeline);
    const revision = maxRevision(p.revs);
    const old = existingIsos.get(id);
    isometrics.totalRows++;
    if (!old) {
      isometrics.create.push({ id, isoNo: pipeline, revision, system: p.system, zone: p.zone, block: p.block, createdAt: now });
    } else if (old.revision !== revision || old.system !== p.system) {
      isometrics.update.push({ ...old, revision, system: p.system });
    } else {
      isometrics.unchanged++;
    }
  }
  const mixed = [...pipelines.entries()].filter(([, p]) => new Set(p.revs).size > 1);
  if (mixed.length) {
    isometrics.issues.push({
      rowNum: 0,
      kind: 'warning',
      ref: `${mixed.length} pipeline`,
      message: `Spoolları farklı revizyonda olan pipeline'lar (${mixed.slice(0, 5).map(([k]) => k).join(', ')}${mixed.length > 5 ? '…' : ''}). Her spool kendi revizyonunu taşır; izometride en yüksek revizyon gösterilir.`,
    });
  }
  return { isometrics, spools };
}

// ───────────────────────────── Material List (summary) ─────────────────────────────

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/** Lengths (pipes, insulation) are given in mm in these reports; fittings are pieces. */
export function reportUnit(description: string): string {
  return /pipe|boru|insulation|izolasyon|hose|tube/i.test(description) ? 'mm' : 'adet';
}

export function previewMaterialSummary(sheet: ParsedSheet, data: ProjectData, now: string): ImportPreview<Material> {
  const p = empty<Material>('material', sheet, ['malzeme_aciklamasi', 'cap_olcu', 'toplam_miktar']);
  if (p.missingColumns.length) return p;
  const existing = new Map(data.materials.map((m) => [m.id, m]));
  const merged = new Map<string, { m: Material; rowNum: number }>();

  for (const row of sheet.rows) {
    const description = cellText(row.values.malzeme_aciklamasi);
    const size = cellText(row.values.cap_olcu);
    const qtyText = cellText(row.values.toplam_miktar);
    if (!description) {
      p.issues.push({
        rowNum: row.rowNum,
        kind: 'skipped',
        ref: '—',
        message: `Açıklaması olmayan satır (toplam satırı olabilir${qtyText ? `, miktar ${qtyText}` : ''}); alınmadı.`,
      });
      continue;
    }
    const qty = parseQuantity(row.values.toplam_miktar);
    const ref = `${description} ${size}`.trim();
    if (qty === null || qty < 0) {
      p.issues.push({ rowNum: row.rowNum, kind: 'invalid', ref, message: `Miktar "${qtyText}" geçerli bir sayı değil.` });
      continue;
    }
    const grade = cellText(row.values.malzeme_kalitesi);
    const angle = cellText(row.values.angle);
    const specParts = [cellText(row.values.rating), cellText(row.values.class_cert), angle && `${angle}°`, cellText(row.values.standard)].filter(Boolean);
    const identity = [description, size, ...specParts, grade].join('|').toLocaleUpperCase('en-US');
    const code = `M-${fnv1a(identity)}`;
    const id = materialKey(code);
    const prev = merged.get(id);
    if (prev) {
      prev.m.totalQty = round3(prev.m.totalQty + qty);
      p.issues.push({ rowNum: row.rowNum, kind: 'warning', ref, message: `Aynı malzeme ${prev.rowNum}. satırda da var; miktarlar toplandı (${prev.m.totalQty}).` });
      continue;
    }
    merged.set(id, {
      rowNum: row.rowNum,
      m: {
        id,
        code,
        description,
        size,
        grade,
        spec: specParts.join(' · ') || undefined,
        unit: reportUnit(description),
        totalQty: round3(qty),
        stockQty: existing.get(id)?.stockQty ?? 0, // the report has no stock; keep what is stored
        updatedAt: now,
      },
    });
  }

  for (const { m } of merged.values()) {
    const old = existing.get(m.id);
    if (!old) p.create.push(m);
    else if (old.totalQty !== m.totalQty || old.unit !== m.unit || (old.spec ?? '') !== (m.spec ?? '')) p.update.push(m);
    else p.unchanged++;
  }
  if (merged.size) {
    p.issues.push({
      rowNum: 0,
      kind: 'warning',
      ref: 'Birimler',
      message: 'Rapor birimi "Pcs/m" yazıyor ama boru ve izolasyon miktarları milimetre büyüklüğünde (ör. 84808). Boru/izolasyon "mm", diğerleri "adet" olarak alındı.',
    });
    p.issues.push({
      rowNum: 0,
      kind: 'warning',
      ref: 'Stok',
      message: 'Raporda depo stoğu yok: yeni malzemelerde stok 0 alındı (eksik satın alma = kalan ihtiyaç). Spool bazında malzeme listesi olmadığı için "kullanılan" miktarlar 0 kalır.',
    });
  }
  return p;
}

export function reportCanCommit(r: ReportPreview): boolean {
  return [r.isometrics, r.spools, r.materials].some((p) => p && !p.missingColumns.length && p.create.length + p.update.length > 0);
}

export function blockingCount(p: ImportPreview<unknown> | null): number {
  return p ? p.issues.filter((i) => BLOCKING_ISSUES.includes(i.kind) && i.kind !== 'exists').length : 0;
}
