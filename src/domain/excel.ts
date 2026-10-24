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
}

/** Canonical column → accepted header spellings (compared after folding, spaces/dashes → _). */
export const COLUMN_ALIASES: Record<string, string[]> = {
  izometri_no: ['izometri_no', 'izometri', 'izometri_numarasi', 'iso_no', 'iso', 'isometric_no', 'drawing_no'],
  revizyon: ['revizyon', 'rev', 'revision', 'rev_no'],
  sistem: ['sistem', 'system', 'system_name', 'sistem_adi'],
  konum_turu: ['konum_turu', 'location_type', 'zone_block', 'konum_tipi'],
  konum_adi: ['konum_adi', 'location_name', 'konum', 'zone_block_adi'],
  spool_no: ['spool_no', 'spool', 'spool_number', 'spool_numarasi'],
  baslangic_durumu: ['baslangic_durumu', 'durum', 'status', 'initial_status', 'uretim_durumu'],
  malzeme_kodu: ['malzeme_kodu', 'material_code', 'kod', 'malzeme_kod'],
  malzeme_aciklamasi: ['malzeme_aciklamasi', 'aciklama', 'description', 'malzeme_adi'],
  cap_olcu: ['cap_olcu', 'cap', 'olcu', 'size', 'cap_ve_olcu'],
  malzeme_kalitesi: ['malzeme_kalitesi', 'kalite', 'grade', 'material_grade'],
  birim: ['birim', 'unit'],
  toplam_miktar: ['toplam_miktar', 'toplam', 'total_qty', 'total_quantity'],
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

/** Reads the first sheet of an .xlsx / .xls / .csv file. Throws a user-readable Error on failure. */
export function readSheet(data: ArrayBuffer, fileName: string): ParsedSheet {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(data), { type: 'array', codepage: 65001, cellDates: false });
  } catch {
    throw new Error(`"${fileName}" okunamadı. Dosya bozuk veya desteklenmeyen bir formatta olabilir.`);
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error(`"${fileName}" içinde sayfa bulunamadı.`);
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) throw new Error(`"${fileName}" dosyasının ilk sayfası boş.`);

  const startRow = XLSX.utils.decode_range(ws['!ref']).s.r; // 0-based
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: true,
  });
  if (matrix.length === 0) throw new Error(`"${fileName}" dosyasının ilk sayfası boş.`);

  const header = matrix[0] as unknown[];
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
  for (let i = 1; i < matrix.length; i++) {
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
  return { fileName, sheetName, columns, unknownColumns, rows };
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
