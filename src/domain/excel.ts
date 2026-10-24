import * as XLSX from 'xlsx';
import { fold } from './normalize';

export interface SheetRow {
  /** Row number as the user sees it in Excel (1-based, header is usually row 1). */
  rowNum: number;
  values: Record<string, unknown>;
}

export interface ParsedSheet {
  fileName: string;
  sheetName: string;
  /** Canonical column names found in the header. */
  columns: string[];
  /** Header cells that did not map to any known column (shown to the user, not an error). */
  unknownColumns: string[];
  rows: SheetRow[];
  /** Excel row number of the header (1 for templates; shipyard reports have a title block above it). */
  headerRow: number;
  /** Title-block values found above the header, e.g. HULL NO, REVISION NO, DATE. */
  meta: Record<string, string>;
}

/** Canonical column → accepted header spellings (compared after folding, spaces/dashes → _). */
export const COLUMN_ALIASES: Record<string, string[]> = {
  izometri_no: ['izometri_no', 'izometri', 'izometri_numarasi', 'iso_no', 'iso', 'isometric_no', 'drawing_no', 'pipeline', 'pipeline_no', 'line_no'],
  revizyon: ['revizyon', 'rev', 'revision', 'rev_no'],
  sistem: ['sistem', 'system', 'system_name', 'sistem_adi'],
  konum_turu: ['konum_turu', 'location_type', 'zone_block', 'konum_tipi'],
  konum_adi: ['konum_adi', 'location_name', 'konum', 'zone_block_adi'],
  zone: ['zone', 'zon', 'zone_no'],
  block: ['block', 'blok', 'blk', 'block_no', 'blok_no'],
  not: ['production_note', 'uretim_notu', 'note', 'not', 'notes'],
  spool_no: ['spool_no', 'spool', 'spool_number', 'spool_numarasi'],
  baslangic_durumu: ['baslangic_durumu', 'durum', 'status', 'initial_status', 'uretim_durumu'],
  malzeme_kodu: ['malzeme_kodu', 'material_code', 'kod', 'malzeme_kod'],
  malzeme_aciklamasi: ['malzeme_aciklamasi', 'aciklama', 'description', 'malzeme_adi'],
  cap_olcu: ['cap_olcu', 'cap', 'olcu', 'size', 'cap_ve_olcu', 'size / dimensions', 'dimensions'],
  malzeme_kalitesi: ['malzeme_kalitesi', 'kalite', 'grade', 'material_grade', 'material'],
  rating: ['rating', 'basinc_sinifi', 'pn'],
  class_cert: ['class cert.', 'class_cert', 'class', 'klas'],
  angle: ['angle', 'aci'],
  standard: ['standard', 'standart'],
  birim: ['birim', 'unit'],
  toplam_miktar: ['toplam_miktar', 'toplam', 'total_qty', 'total_quantity', 'quantity(pcs/m)', 'quantity_pcs_m'],
  depo_stogu: ['depo_stogu', 'stok', 'depo', 'stock', 'stock_qty'],
  miktar: ['miktar', 'qty', 'quantity', 'adet'],
};

function headerKey(header: unknown): string {
  return fold(String(header ?? ''))
    .replace(/[\s\-/]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

const ALIAS_LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const a of aliases) m.set(headerKey(a), canonical);
  }
  return m;
})();

export function canonicalColumn(header: unknown): string | null {
  return ALIAS_LOOKUP.get(headerKey(header)) ?? null;
}

function openWorkbook(data: ArrayBuffer, fileName: string): XLSX.WorkBook {
  try {
    return XLSX.read(new Uint8Array(data), { type: 'array', codepage: 65001, cellDates: false });
  } catch {
    throw new Error(`"${fileName}" okunamadı. Dosya bozuk veya desteklenmeyen bir formatta olabilir.`);
  }
}

const META_LABELS: Record<string, string> = { hull_no: 'hullNo', tekne_no: 'hullNo', revision_no: 'revisionNo', date: 'date', tarih: 'date' };

/**
 * Parses one worksheet. The header is the first row (within the first 30) where at least two
 * cells are known column names, so title blocks above the table (HULL NO, DATE…) are skipped
 * and read into `meta`.
 */
function parseWorksheet(ws: XLSX.WorkSheet, sheetName: string, fileName: string): ParsedSheet | null {
  if (!ws || !ws['!ref']) return null;
  const startRow = XLSX.utils.decode_range(ws['!ref']).s.r; // 0-based
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '', blankrows: true });
  if (matrix.length === 0) return null;

  let headerIdx = 0;
  let best = 0;
  for (let i = 0; i < Math.min(30, matrix.length); i++) {
    const known = new Set((matrix[i] as unknown[]).map(canonicalColumn).filter(Boolean)).size;
    if (known >= 2 && known > best) {
      headerIdx = i;
      best = known;
      if (known >= 3) break;
    }
  }

  const meta: Record<string, string> = {};
  for (let i = 0; i < headerIdx; i++) {
    const r = matrix[i] as unknown[];
    r.forEach((cell, c) => {
      const key = META_LABELS[headerKey(cell)];
      if (!key || meta[key]) return;
      const next = r.slice(c + 1).find((v) => v !== '' && v !== null && v !== undefined);
      if (next === undefined) return;
      meta[key] = typeof next === 'number' && key === 'date' ? XLSX.SSF.format('yyyy-mm-dd', next) : String(next).trim();
    });
  }

  const header = matrix[headerIdx] as unknown[];
  const colMap: (string | null)[] = [];
  const columns: string[] = [];
  const unknownColumns: string[] = [];
  header.forEach((h) => {
    const c = canonicalColumn(h);
    // First occurrence wins; a repeated header is ignored.
    if (c && !columns.includes(c)) {
      colMap.push(c);
      columns.push(c);
    } else {
      colMap.push(null);
      const txt = String(h ?? '').trim();
      if (txt) unknownColumns.push(txt);
    }
  });

  const rows: SheetRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const arr = matrix[i] as unknown[];
    const values: Record<string, unknown> = {};
    let blank = true;
    colMap.forEach((c, idx) => {
      if (!c) return;
      const v = arr[idx];
      values[c] = v;
      if (v !== '' && v !== null && v !== undefined) blank = false;
    });
    if (blank) continue;
    rows.push({ rowNum: startRow + i + 1, values });
  }
  return { fileName, sheetName, columns, unknownColumns, rows, headerRow: startRow + headerIdx + 1, meta };
}

/** Reads the first sheet of an .xlsx / .xls / .csv file. Throws a user-readable Error on failure. */
export function readSheet(data: ArrayBuffer, fileName: string): ParsedSheet {
  const wb = openWorkbook(data, fileName);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error(`"${fileName}" içinde sayfa bulunamadı.`);
  const parsed = parseWorksheet(wb.Sheets[sheetName], sheetName, fileName);
  if (!parsed) throw new Error(`"${fileName}" dosyasının ilk sayfası boş.`);
  return parsed;
}

/** Reads every non-empty sheet (shipyard reports keep spools and materials in separate sheets). */
export function readWorkbook(data: ArrayBuffer, fileName: string): ParsedSheet[] {
  const wb = openWorkbook(data, fileName);
  const sheets = wb.SheetNames.map((n) => parseWorksheet(wb.Sheets[n], n, fileName)).filter((x): x is ParsedSheet => !!x);
  if (!sheets.length) throw new Error(`"${fileName}" içinde dolu sayfa bulunamadı.`);
  return sheets;
}

/** Builds an .xlsx file from rows of plain objects (one sheet per entry). */
export function buildWorkbook(sheets: { name: string; rows: Record<string, unknown>[]; header?: string[] }[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows, s.header ? { header: s.header } : undefined);
    const cols = (s.header ?? Object.keys(s.rows[0] ?? {})).map((h) => ({
      wch: Math.min(40, Math.max(10, h.length + 2, ...s.rows.map((r) => String(r[h] ?? '').length + 1))),
    }));
    ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
