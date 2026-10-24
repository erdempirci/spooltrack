// Material quantities are NEVER decremented in storage. They are always derived from the
// current spool statuses, so a spool going Bitti → Devam Ediyor automatically gives the
// material back and double deduction is impossible.

import { round3 } from './normalize';
import { matchesSelection, type Selection } from './progress';
import type { Material, ProjectData, Spool } from './types';

export interface MaterialRow {
  material: Material;
  /** Project scope: toplam_miktar from Excel 3. Filtered scope: sum of spool BOM lines in scope. */
  totalNeed: number;
  /** Σ qty of spools in Bitti. */
  usedDone: number;
  /** Σ qty of spools in Devam Ediyor. */
  reservedInProgress: number;
  /** Σ qty of spools in Başlamadı. */
  notStartedNeed: number;
  /** totalNeed − usedDone. */
  remainingNeed: number;
  /** Project scope only (stock is not split by system/zone). */
  stock: number | null;
  /** max(0, remainingNeed − stock). Project scope only. */
  shortage: number | null;
  /** Σ of all spool BOM lines for this material (all statuses) in scope. */
  spoolBomTotal: number;
  /** True when the spool lists reference more than the total material list. */
  bomExceedsTotal: boolean;
}

export function isScoped(scope: Selection | undefined): boolean {
  return !!(scope && (scope.locationType || scope.locationName || scope.system));
}

export function computeMaterialRows(data: ProjectData, scope?: Selection): MaterialRow[] {
  const scoped = isScoped(scope);
  const spoolById = new Map<string, Spool>(data.spools.map((s) => [s.id, s]));

  const acc = new Map<string, { done: number; prog: number; notStarted: number }>();
  for (const sm of data.spoolMaterials) {
    const spool = spoolById.get(sm.spoolId);
    if (!spool) continue; // orphan line (spool deleted) — ignored
    if (scoped && !matchesSelection(spool, scope!)) continue;
    const a = acc.get(sm.materialCode) ?? { done: 0, prog: 0, notStarted: 0 };
    if (spool.status === 'bitti') a.done += sm.qty;
    else if (spool.status === 'devam') a.prog += sm.qty;
    else a.notStarted += sm.qty;
    acc.set(sm.materialCode, a);
  }

  const rows: MaterialRow[] = [];
  for (const m of data.materials) {
    const a = acc.get(m.code) ?? { done: 0, prog: 0, notStarted: 0 };
    const bom = round3(a.done + a.prog + a.notStarted);
    if (scoped && bom === 0) continue; // material not used in this system/zone
    const totalNeed = scoped ? bom : m.totalQty;
    const usedDone = round3(a.done);
    const remainingNeed = round3(totalNeed - usedDone);
    rows.push({
      material: m,
      totalNeed: round3(totalNeed),
      usedDone,
      reservedInProgress: round3(a.prog),
      notStartedNeed: round3(a.notStarted),
      remainingNeed,
      stock: scoped ? null : m.stockQty,
      shortage: scoped ? null : round3(Math.max(0, remainingNeed - m.stockQty)),
      spoolBomTotal: bom,
      bomExceedsTotal: !scoped && bom > m.totalQty,
    });
  }
  return rows.sort((a, b) => a.material.code.localeCompare(b.material.code, 'tr', { numeric: true }));
}

export interface MaterialFilter {
  size?: string;
  text?: string;
}

export function filterMaterialRows(rows: MaterialRow[], f: MaterialFilter): MaterialRow[] {
  const text = (f.text ?? '').trim().toLocaleLowerCase('tr');
  return rows.filter((r) => {
    if (f.size && r.material.size !== f.size) return false;
    if (text) {
      const hay = `${r.material.code} ${r.material.description} ${r.material.grade}`.toLocaleLowerCase('tr');
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}
