import type { LocationType, SpoolStatus } from './types';

/** Lowercase + fold Turkish characters to ASCII + collapse whitespace. Used for matching only. */
export function fold(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Any cell value → trimmed text with collapsed whitespace. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Identifiers (iso no, spool no, revision, location, material code) are compared upper-case. */
export function identifier(value: unknown): string {
  return cellText(value).toLocaleUpperCase('en-US');
}

const ZONE_WORDS = new Set(['zone', 'zon']);
const BLOCK_WORDS = new Set(['block', 'blok', 'blk']);

/** Returns null for unknown values — callers must report an error, never default to Zone. */
export function normalizeLocationType(value: unknown): LocationType | null {
  const v = fold(cellText(value));
  if (ZONE_WORDS.has(v)) return 'Zone';
  if (BLOCK_WORDS.has(v)) return 'Block';
  return null;
}

const STATUS_WORDS: Record<SpoolStatus, string[]> = {
  baslamadi: ['baslamadi', 'bekliyor', 'beklemede', 'not started', 'notstarted'],
  devam: ['devam ediyor', 'devam', 'uretimde', 'in progress', 'inprogress', 'started', 'basladi'],
  bitti: ['bitti', 'tamamlandi', 'tamam', 'completed', 'complete', 'done', 'finished'],
};

/**
 * 'empty' when the cell is blank (caller decides the default),
 * null when the value is not recognised (caller must report an error).
 */
export function normalizeStatus(value: unknown): SpoolStatus | 'empty' | null {
  const v = fold(cellText(value));
  if (v === '') return 'empty';
  for (const status of Object.keys(STATUS_WORDS) as SpoolStatus[]) {
    if (STATUS_WORDS[status].includes(v)) return status;
  }
  return null;
}

/**
 * Parses quantities from Excel. Accepts real numbers and text like "12", "12.5", "12,5",
 * "1.234,5" (TR) and "1,234.5" (EN). Returns null when not a number.
 */
export function parseQuantity(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = cellText(value).replace(/\s/g, '');
  if (s === '') return null;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    s = s.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Rounds away floating point noise (0.1 + 0.2). */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
