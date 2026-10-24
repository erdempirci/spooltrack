import type { IsoStatus, Isometric, Located, LocationType, Spool } from './types';

export interface Counts {
  total: number;
  baslamadi: number;
  devam: number;
  bitti: number;
  /** % of spools finished, one decimal. */
  pct: number;
}

export function countSpools(spools: Spool[]): Counts {
  const c: Counts = { total: spools.length, baslamadi: 0, devam: 0, bitti: 0, pct: 0 };
  for (const s of spools) c[s.status]++;
  c.pct = c.total ? Math.round((c.bitti / c.total) * 1000) / 10 : 0;
  return c;
}

/** ISO status is never set by hand; it is derived from its spools. */
export function isoStatus(c: Counts): IsoStatus {
  if (c.total === 0) return 'tanimsiz';
  if (c.bitti === c.total) return 'bitti';
  if (c.bitti > 0 || c.devam > 0) return 'devam';
  return 'baslamadi';
}

export interface IsoProgress extends Counts {
  iso: Isometric;
  status: IsoStatus;
}

export function isoProgress(isometrics: Isometric[], spools: Spool[]): IsoProgress[] {
  const byIso = new Map<string, Spool[]>();
  for (const s of spools) {
    if (!byIso.has(s.isoId)) byIso.set(s.isoId, []);
    byIso.get(s.isoId)!.push(s);
  }
  return isometrics
    .map((iso) => {
      const c = countSpools(byIso.get(iso.id) ?? []);
      return { iso, ...c, status: isoStatus(c) };
    })
    .sort((a, b) => a.iso.isoNo.localeCompare(b.iso.isoNo, 'tr') || a.iso.revision.localeCompare(b.iso.revision, 'tr'));
}

export interface Selection {
  locationType?: LocationType | null;
  locationName?: string | null;
  system?: string | null;
}

export function matchesLocation(x: Located, locationType: LocationType, locationName: string): boolean {
  return locationType === 'Zone' ? x.zone === locationName : x.block === locationName;
}

export function matchesSelection(x: Located, sel: Selection): boolean {
  if (sel.locationType && sel.locationName && !matchesLocation(x, sel.locationType, sel.locationName)) return false;
  if (sel.system && x.system !== sel.system) return false;
  return true;
}

export interface LocationOption {
  locationType: LocationType;
  locationName: string;
}

/** Zone and Block options that actually exist in the project (from spools and isometrics). */
export function locationOptions(items: Located[]): LocationOption[] {
  const map = new Map<string, LocationOption>();
  for (const i of items) {
    if (i.zone) map.set(`Zone|${i.zone}`, { locationType: 'Zone', locationName: i.zone });
    if (i.block) map.set(`Block|${i.block}`, { locationType: 'Block', locationName: i.block });
  }
  return [...map.values()].sort(
    (a, b) =>
      (a.locationType === b.locationType ? 0 : a.locationType === 'Zone' ? -1 : 1) ||
      a.locationName.localeCompare(b.locationName, 'tr', { numeric: true }),
  );
}

/** Systems that exist in the chosen Zone/Block only. */
export function systemOptions(items: Located[], loc: LocationOption | null): string[] {
  const set = new Set<string>();
  for (const i of items) {
    if (loc && !matchesLocation(i, loc.locationType, loc.locationName)) continue;
    if (i.system) set.add(i.system);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true }));
}

/**
 * Isometrics to show for a selection: those with at least one spool in it, plus spool-less
 * isometrics whose own location/system matches (so "Spool Tanımlanmamış" stays visible).
 * Progress is always computed over ALL spools of the isometric — a pipeline split across
 * blocks is only Bitti when every spool is finished.
 */
export function isosInSelection(isometrics: Isometric[], allSpools: Spool[], sel: Selection): IsoProgress[] {
  const inScope = new Set(allSpools.filter((s) => matchesSelection(s, sel)).map((s) => s.isoId));
  const hasSpools = new Set(allSpools.map((s) => s.isoId));
  const isos = isometrics.filter((i) => inScope.has(i.id) || (!hasSpools.has(i.id) && matchesSelection(i, sel)));
  const ids = new Set(isos.map((i) => i.id));
  return isoProgress(isos, allSpools.filter((s) => ids.has(s.isoId)));
}

export interface GroupProgress extends Counts {
  key: string;
  label: string;
}

export function groupProgress(spools: Spool[], keyOf: (s: Spool) => string, labelOf: (s: Spool) => string): GroupProgress[] {
  const groups = new Map<string, Spool[]>();
  const labels = new Map<string, string>();
  for (const s of spools) {
    const k = keyOf(s);
    if (!groups.has(k)) {
      groups.set(k, []);
      labels.set(k, labelOf(s));
    }
    groups.get(k)!.push(s);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, label: labels.get(key)!, ...countSpools(list) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr', { numeric: true }));
}
