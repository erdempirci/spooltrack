// Pipe weight from the material's size text, so the materials screen can show how many
// kilograms of pipe are still to be produced (crane, transport and stock planning).
//
// Pipe dimensions (DN → OD × wall) for ASME B36.10M (Sch 40, 80, STD) and B36.19M (10S, 40S)
// were generated from CalebBell/fluids (MIT), piping.py `schedule_lookup`.
// Weight per metre: π · (OD − t) · t · ρ, OD and t in mm, ρ in kg/m³ → kg/m.

/** DN → [OD mm, wall mm] */
const SCHEDULES: Record<string, Record<number, [number, number]>> = {
  '40': { 15: [21.3, 2.77], 20: [26.7, 2.87], 25: [33.4, 3.38], 32: [42.2, 3.56], 40: [48.3, 3.68], 50: [60.3, 3.91], 65: [73, 5.16], 80: [88.9, 5.49], 100: [114.3, 6.02], 125: [141.3, 6.55], 150: [168.3, 7.11], 200: [219.1, 8.18], 250: [273, 9.27], 300: [323.8, 10.31], 350: [355.6, 11.13], 400: [406.4, 12.7], 450: [457, 14.27], 500: [508, 15.09], 600: [610, 17.48] },
  '80': { 15: [21.3, 3.73], 20: [26.7, 3.91], 25: [33.4, 4.55], 32: [42.2, 4.85], 40: [48.3, 5.08], 50: [60.3, 5.54], 65: [73, 7.01], 80: [88.9, 7.62], 100: [114.3, 8.56], 125: [141.3, 9.53], 150: [168.3, 10.97], 200: [219.1, 12.7], 250: [273, 15.09], 300: [323.8, 17.48] },
  'STD': { 15: [21.3, 2.77], 20: [26.7, 2.87], 25: [33.4, 3.38], 32: [42.2, 3.56], 40: [48.3, 3.68], 50: [60.3, 3.91], 65: [73, 5.16], 80: [88.9, 5.49], 100: [114.3, 6.02], 125: [141.3, 6.55], 150: [168.3, 7.11], 200: [219.1, 8.18], 250: [273, 9.27], 300: [323.8, 9.53], 350: [355.6, 9.53], 400: [406.4, 9.53], 450: [457, 9.53], 500: [508, 9.53], 600: [610, 9.53] },
  '10S': { 15: [21.3, 2.11], 20: [26.7, 2.11], 25: [33.4, 2.77], 32: [42.2, 2.77], 40: [48.3, 2.77], 50: [60.3, 2.77], 65: [73, 3.05], 80: [88.9, 3.05], 100: [114.3, 3.05], 125: [141.3, 3.4], 150: [168.3, 3.4], 200: [219.1, 3.76], 250: [273, 4.19], 300: [323.8, 4.57] },
  '40S': { 15: [21.3, 2.77], 20: [26.7, 2.87], 25: [33.4, 3.38], 32: [42.2, 3.56], 40: [48.3, 3.68], 50: [60.3, 3.91], 65: [73, 5.16], 80: [88.9, 5.49], 100: [114.3, 6.02], 125: [141.3, 6.55], 150: [168.3, 7.11], 200: [219.1, 8.18], 250: [273, 9.27], 300: [323.8, 9.53] },
};

/** Density by material grade, kg/m³. Order matters: the first match wins. */
const DENSITY: [RegExp, number, string][] = [
  [/cu\s*-?\s*ni|90\s*\/\s*10|70\s*\/\s*30|kupronikel|cunifer/i, 8940, 'CuNi'],
  [/\bcu\b|bak[ıi]r|copper/i, 8960, 'Bakır'],
  [/al[uü]min|\bal\s*\d|5083|6061|6082/i, 2700, 'Alüminyum'],
  [/duplex|2205|1\.4462/i, 7800, 'Duplex'],
  [/paslanmaz|stainless|\bss\b|aisi|31[06]l?|304l?|1\.44|1\.43|1\.45/i, 7950, 'Paslanmaz'],
  [/./, 7850, 'Karbon çelik'],
];

/** Plastics and hoses have no meaningful steel-formula weight. */
const NON_METAL = /grp|ctp|frp|pvc|pp-?r|pe-?hd|hdpe|hose|hortum|insulation|izolasyon/i;

export interface PipeSection {
  od: number;
  wall: number;
  /** How the dimensions were found: 'olcu' = read from the size text, 'sch' = DN + schedule table. */
  source: 'olcu' | 'sch';
}

/** Reads OD × wall from texts like "Ø60.3x2.77", "60,3 x 2,77", "DN50 (Ø60.3 x 2.77)", or DN + "SCH 40". */
export function parsePipeSection(size: string, spec = ''): PipeSection | null {
  const text = `${size} ${spec}`.replace(/,/g, '.');
  const m = text.match(/(?:[øØ⌀]|od)?\s*(\d{2,4}(?:\.\d+)?)\s*[x×*]\s*(\d{1,2}(?:\.\d+)?)/i);
  if (m) {
    const od = +m[1], wall = +m[2];
    if (od > 6 && wall > 0.5 && wall < od / 2) return { od, wall, source: 'olcu' };
  }
  const dn = text.match(/\bDN\s*(\d{2,3})\b/i);
  const sch = text.match(/\b(?:SCH(?:EDULE)?\.?\s*)(10S|40S|40|80|STD|XS)\b/i) ?? text.match(/\b(STD|XS|10S|40S)\b/);
  if (dn && sch) {
    const key = sch[1].toUpperCase() === 'XS' ? '80' : sch[1].toUpperCase();
    const row = SCHEDULES[key]?.[+dn[1]];
    if (row) return { od: row[0], wall: row[1], source: 'sch' };
  }
  return null;
}

export function densityFor(grade: string): { rho: number; label: string } {
  const hit = DENSITY.find(([re]) => re.test(grade))!;
  return { rho: hit[1], label: hit[2] };
}

/** kg per metre, or null when the material is not a metal pipe with readable dimensions. */
export function pipeKgPerMetre(m: { description: string; size: string; grade: string; spec?: string; unit: string }): number | null {
  if (!/pipe|boru|tube/i.test(m.description)) return null;
  if (NON_METAL.test(`${m.description} ${m.grade}`)) return null;
  if (!/^(mm|m|metre|meter)$/i.test(m.unit.trim())) return null;
  const s = parsePipeSection(m.size, m.spec);
  if (!s) return null;
  const { rho } = densityFor(m.grade);
  return (Math.PI * (s.od - s.wall) * s.wall * rho) / 1e6;
}

/** Converts a quantity in the material's unit to kilograms. */
export function pipeKg(m: Parameters<typeof pipeKgPerMetre>[0], qty: number): number | null {
  const kgm = pipeKgPerMetre(m);
  if (kgm == null) return null;
  const metres = /^mm$/i.test(m.unit.trim()) ? qty / 1000 : qty;
  return Math.round(kgm * metres * 10) / 10;
}
