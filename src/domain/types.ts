// SpoolTrack domain types. Stored values are stable codes; Turkish labels are for display only.

export type SpoolStatus = 'baslamadi' | 'devam' | 'bitti';
export type LocationType = 'Zone' | 'Block';
export type IsoStatus = SpoolStatus | 'tanimsiz';
export type Role = 'admin' | 'engineer';

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
  locationType: LocationType;
  locationName: string;
  createdAt: string;
}

export interface Spool {
  id: string; // deterministic: spoolKey(isoId, spoolNo)
  isoId: string;
  spoolNo: string;
  // Denormalized from the isometric so filters work without joins (Firestore-friendly).
  isoNo: string;
  revision: string;
  system: string;
  locationType: LocationType;
  locationName: string;
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
