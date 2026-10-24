import type { ImportKind, ImportPreview } from '../domain/importers';
import type { Project, ProjectData, Role, SpoolStatus } from '../domain/types';

export type UserRole = Role | 'pending';

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
}

export type Unsubscribe = () => void;

/** Storage backend. Two implementations: IndexedDB (single device) and Firebase (multi-user). */
export interface Repo {
  readonly mode: 'local' | 'firebase';

  onAuth(cb: (user: AppUser | null) => void): Unsubscribe;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, name: string): Promise<void>;
  signOut(): Promise<void>;

  subscribeProjects(cb: (projects: Project[]) => void, onError: (e: Error) => void): Unsubscribe;
  createProject(name: string): Promise<Project>;
  subscribeProjectData(projectId: string, cb: (data: ProjectData) => void, onError: (e: Error) => void): Unsubscribe;

  setSpoolStatus(projectId: string, spoolId: string, status: SpoolStatus, user: AppUser): Promise<void>;
  /** Writes preview.create and preview.update. Returns the number of documents written. */
  commitImport(projectId: string, kind: ImportKind, preview: ImportPreview<{ id: string }>): Promise<number>;

  /** Admin user management (Firebase only). */
  subscribeUsers?(cb: (users: AppUser[]) => void, onError: (e: Error) => void): Unsubscribe;
  setUserRole?(uid: string, role: UserRole): Promise<void>;
  /** Local mode only: lets one device switch between admin and engineer views. */
  setLocalRole?(role: Role): void;
}

export const COLLECTION: Record<ImportKind, 'isometrics' | 'spools' | 'materials' | 'spoolMaterials'> = {
  isometric: 'isometrics',
  spool: 'spools',
  material: 'materials',
  spoolMaterial: 'spoolMaterials',
};

export function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'E-posta veya şifre hatalı.',
    'auth/invalid-email': 'Geçerli bir e-posta adresi girin.',
    'auth/user-not-found': 'Bu e-posta ile kayıtlı kullanıcı yok.',
    'auth/wrong-password': 'E-posta veya şifre hatalı.',
    'auth/email-already-in-use': 'Bu e-posta zaten kayıtlı. Giriş yapın.',
    'auth/weak-password': 'Şifre en az 6 karakter olmalı.',
    'auth/too-many-requests': 'Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.',
    'auth/network-request-failed': 'İnternet bağlantısı yok.',
    'permission-denied': 'Bu işlem için yetkiniz yok.',
    unavailable: 'Sunucuya ulaşılamıyor. Bağlantınızı kontrol edin.',
  };
  if (map[code]) return map[code];
  if (e instanceof Error && e.message) return e.message;
  return 'Beklenmeyen bir hata oluştu.';
}

/**
 * Fields written when an import UPDATES an existing document. For spools the production status
 * (and who/when changed it) is never taken from an import, so a status tapped on a phone while
 * the admin was previewing cannot be overwritten.
 */
export function importUpdate(kind: ImportKind, item: { id: string }): Record<string, unknown> {
  const { id: _id, ...rest } = item as Record<string, unknown> & { id: string };
  if (kind === 'spool') {
    delete rest.status;
    delete rest.updatedAt;
    delete rest.updatedBy;
  }
  return rest;
}

/** Records saved by v0.7.0 had locationType/locationName instead of zone/block. */
export function upgradeRecord<T>(r: T): T {
  const x = r as Record<string, unknown>;
  if (x && x.zone === undefined && x.block === undefined && typeof x.locationType === 'string') {
    const name = String(x.locationName ?? '');
    const { locationType, locationName: _ln, ...rest } = x;
    return { ...rest, zone: locationType === 'Zone' ? name : '', block: locationType === 'Block' ? name : '' } as T;
  }
  return r;
}
