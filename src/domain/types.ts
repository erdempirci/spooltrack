// SpoolTrack domain types. Stored values are stable codes; Turkish labels are for display only.

export type SpoolStatus = 'baslamadi' | 'devam' | 'bitti';
export type LocationType = 'Zone' | 'Block';
export type IsoStatus = SpoolStatus | 'tanimsiz';
export type Role = 'admin' | 'engineer';

/** Where a spool or isometric sits; used by selections and filters. */
export interface Located {
  zone: string;
  block: string;
  system: string;
}

export const STATUS_ORDER: SpoolStatus[] = ['baslamadi', 'devam', 'bitti'];

export const STATUS_LABEL: Record<IsoStatus, string> = {
  baslamadi: 'Başlamadı',
  devam: 'Devam Ediyor',
  bitti: 'Bitti',
  tanimsiz: 'Spool Tanımlanmamış',
};

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface Isometric {
  id: string; // deterministic: isoKey(isoNo, revision)
  isoNo: string;
  revision: string;
  system: string;
  /** Zone and/or Block code. Either may be '' when the source only gives one of them. */
  zone: string;
  block: string;
  createdAt: string;
}

export interface Spool {
  id: string; // deterministic: spoolKey(isoId, spoolNo)
  isoId: string;
  spoolNo: string;
  // Filters run on the spool itself (Firestore-friendly, no joins). In shipyard reports a
  // pipeline's spools can sit in different blocks, so location belongs to the spool.
  isoNo: string;
  /** Spool revision. Template uploads copy the isometric revision; shipyard reports give one per spool. */
  revision: string;
  system: string;
  zone: string;
  block: string;
  /** Production note from the report, e.g. "DO NOT WELD!! WILL BE ADJUSTED ON BOARD!!". */
  note?: string;
  status: SpoolStatus;
  updatedAt: string;
  updatedBy?: string;
}

export interface Material {
  id: string; // deterministic: materialKey(code)
  code: string;
  description: string;
  size: string;
  grade: string;
  /** Extra identification from shipyard summaries: rating, class, angle, standard. */
  spec?: string;
  unit: string;
  totalQty: number;
  stockQty: number;
  updatedAt: string;
}

export interface SpoolMaterial {
  id: string; // deterministic: spoolMaterialKey(spoolId, code)
  spoolId: string;
  materialCode: string;
  qty: number;
}

/** Everything the app needs for one project, loaded at once. */
export interface ProjectData {
  isometrics: Isometric[];
  spools: Spool[];
  materials: Material[];
  spoolMaterials: SpoolMaterial[];
}

export const EMPTY_PROJECT_DATA: ProjectData = {
  isometrics: [],
  spools: [],
  materials: [],
  spoolMaterials: [],
};
