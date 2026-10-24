import type { IsoStatus, Isometric, LocationType, Spool } from './types';

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

export function matchesSelection(x: { locationType: LocationType; locationName: string; system: string }, sel: Selection): boolean {
  if (sel.locationType && x.locationType !== sel.locationType) return false;
  if (sel.locationName && x.locationName !== sel.locationName) return false;
  if (sel.system && x.system !== sel.system) return false;
  return true;
}

export interface LocationOption {
  locationType: LocationType;
  locationName: string;
}

/** Zone/Block options that actually have isometrics in the project. */
export function locationOptions(isometrics: Isometric[]): LocationOption[] {
  const map = new Map<string, LocationOption>();
  for (const i of isometrics) map.set(`${i.locationType}|${i.locationName}`, { locationType: i.locationType, locationName: i.locationName });
  return [...map.values()].sort(
    (a, b) => a.locationType.localeCompare(b.locationType) || a.locationName.localeCompare(b.locationName, 'tr', { numeric: true }),
  );
}

/** Systems that exist in the chosen Zone/Block only. */
export function systemOptions(isometrics: Isometric[], loc: LocationOption | null): string[] {
  const set = new Set<string>();
  for (const i of isometrics) {
    if (loc && (i.locationType !== loc.locationType || i.locationName !== loc.locationName)) continue;
    set.add(i.system);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'tr'));
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
