// IndexedDB backend: data survives page reloads and browser restarts on ONE device.
// Used when no Firebase configuration is provided (and in automated tests).

import { openDB, type IDBPDatabase } from 'idb';
import type { ImportKind, ImportPreview } from '../domain/importers';
import { newProjectId } from '../domain/keys';
import { fold } from '../domain/normalize';
import type { Project, ProjectData, Role, SpoolStatus } from '../domain/types';
import { COLLECTION, type AppUser, type Repo, type Unsubscribe } from './repo';

const DB_NAME = 'spooltrack';
const STORES = ['isometrics', 'spools', 'materials', 'spoolMaterials'] as const;
type Store = (typeof STORES)[number];
const ROLE_KEY = 'spooltrack.localRole';

interface Stored {
  key: string; // `${projectId}/${id}`
  projectId: string;
  [k: string]: unknown;
}

function strip(rec: Stored): any {
  const { key: _k, projectId: _p, ...rest } = rec;
  return rest;
}

export class LocalRepo implements Repo {
  readonly mode = 'local' as const;
  private dbp: Promise<IDBPDatabase>;
  private listeners = new Set<() => void>();
  private authListeners = new Set<(u: AppUser | null) => void>();
  private channel: BroadcastChannel | null = null;

  constructor(dbName = DB_NAME) {
    this.dbp = openDB(dbName, 1, {
      upgrade(db) {
        db.createObjectStore('projects', { keyPath: 'id' });
        for (const s of STORES) {
          const os = db.createObjectStore(s, { keyPath: 'key' });
          os.createIndex('projectId', 'projectId');
        }
      },
    });
    if (typeof BroadcastChannel !== 'undefined') {
      // Keeps several open tabs on the same device in sync.
      this.channel = new BroadcastChannel(`${dbName}-changes`);
      this.channel.onmessage = () => this.listeners.forEach((l) => l());
    }
  }

  private changed() {
    this.listeners.forEach((l) => l());
    this.channel?.postMessage('changed');
  }

  private watch(load: () => Promise<void>, onError: (e: Error) => void): Unsubscribe {
    const run = () => load().catch((e) => onError(e instanceof Error ? e : new Error(String(e))));
    this.listeners.add(run);
    run();
    return () => this.listeners.delete(run);
  }

  private currentUser(): AppUser {
    let role: Role = 'admin';
    try {
      const r = localStorage.getItem(ROLE_KEY);
      if (r === 'engineer') role = 'engineer';
    } catch {
      /* storage unavailable: default admin */
    }
    return { uid: 'local', email: '', name: 'Bu cihaz', role };
  }

  onAuth(cb: (user: AppUser | null) => void): Unsubscribe {
    this.authListeners.add(cb);
    cb(this.currentUser());
    return () => this.authListeners.delete(cb);
  }
  async signIn() {}
  async signUp() {}
  async signOut() {}

  setLocalRole(role: Role) {
    try {
      localStorage.setItem(ROLE_KEY, role);
    } catch {
      /* ignore */
    }
    const u = this.currentUser();
    this.authListeners.forEach((l) => l(u));
  }

  subscribeProjects(cb: (projects: Project[]) => void, onError: (e: Error) => void): Unsubscribe {
    return this.watch(async () => {
      const db = await this.dbp;
      const all = (await db.getAll('projects')) as Project[];
      cb(all.sort((a, b) => a.name.localeCompare(b.name, 'tr')));
    }, onError);
  }

  async createProject(name: string): Promise<Project> {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) throw new Error('Proje adı girin.');
    const db = await this.dbp;
    const all = (await db.getAll('projects')) as Project[];
    if (all.some((p) => fold(p.name) === fold(clean))) throw new Error(`"${clean}" adında bir proje zaten var.`);
    const project: Project = { id: newProjectId(), name: clean, createdAt: new Date().toISOString() };
    await db.put('projects', project);
    this.changed();
    return project;
  }

  subscribeProjectData(projectId: string, cb: (data: ProjectData) => void, onError: (e: Error) => void): Unsubscribe {
    return this.watch(async () => {
      const db = await this.dbp;
      const tx = db.transaction([...STORES], 'readonly');
      const [isometrics, spools, materials, spoolMaterials] = await Promise.all(
        STORES.map(async (s) => ((await tx.objectStore(s).index('projectId').getAll(projectId)) as Stored[]).map(strip)),
      );
      await tx.done;
      cb({ isometrics, spools, materials, spoolMaterials });
    }, onError);
  }

  async setSpoolStatus(projectId: string, spoolId: string, status: SpoolStatus, user: AppUser): Promise<void> {
    const db = await this.dbp;
    const tx = db.transaction('spools', 'readwrite');
    const key = `${projectId}/${spoolId}`;
    const rec = (await tx.store.get(key)) as Stored | undefined;
    if (!rec) throw new Error('Spool bulunamadı. Liste güncel olmayabilir; sayfayı yenileyin.');
    rec.status = status;
    rec.updatedAt = new Date().toISOString();
    rec.updatedBy = user.uid;
    await tx.store.put(rec);
    await tx.done;
    this.changed();
  }

  async commitImport(projectId: string, kind: ImportKind, preview: ImportPreview<{ id: string }>): Promise<number> {
    const store: Store = COLLECTION[kind];
    const db = await this.dbp;
    const tx = db.transaction(store, 'readwrite');
    let n = 0;
    for (const item of preview.create) {
      const key = `${projectId}/${item.id}`;
      // Never overwrite an existing document on "create" (protects spool statuses).
      if (await tx.store.get(key)) continue;
      await tx.store.put({ ...item, key, projectId });
      n++;
    }
    for (const item of preview.update) {
      const key = `${projectId}/${item.id}`;
      const old = ((await tx.store.get(key)) as Stored | undefined) ?? {};
      await tx.store.put({ ...old, ...item, key, projectId });
      n++;
    }
    await tx.done; // all-or-nothing: IndexedDB rolls back the whole import on failure
    this.changed();
    return n;
  }
}
