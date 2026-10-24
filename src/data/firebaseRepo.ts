// Firebase backend: Authentication + Cloud Firestore, multi-user, real-time.
// Firestore paths:
//   users/{uid}                           { email, name, role: 'pending' | 'engineer' | 'admin', createdAt }
//   projects/{pid}                        { name, nameKey, createdAt }
//   projects/{pid}/isometrics/{isoId}
//   projects/{pid}/spools/{spoolId}
//   projects/{pid}/materials/{materialId}
//   projects/{pid}/spoolMaterials/{id}
// Document IDs are deterministic (see domain/keys.ts), so re-imports never create duplicates.
// Authorization is enforced by firestore.rules, not only by the UI.

import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type Auth,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { ImportKind, ImportPreview } from '../domain/importers';
import { newProjectId } from '../domain/keys';
import { fold } from '../domain/normalize';
import type { Project, ProjectData, SpoolStatus } from '../domain/types';
import { COLLECTION, importUpdate, upgradeRecord, type AppUser, type Repo, type Unsubscribe, type UserRole } from './repo';

const BATCH_LIMIT = 450; // Firestore allows 500 writes per batch

export class FirebaseRepo implements Repo {
  readonly mode = 'firebase' as const;
  private auth: Auth;
  private db: Firestore;

  constructor(config: FirebaseOptions) {
    const app = initializeApp(config);
    this.auth = getAuth(app);
    // Offline cache: status taps made without signal are queued and synced when back online.
    this.db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    });
  }

  onAuth(cb: (user: AppUser | null) => void): Unsubscribe {
    let unsubUser: Unsubscribe | null = null;
    const unsubAuth = onAuthStateChanged(this.auth, async (fbUser) => {
      unsubUser?.();
      unsubUser = null;
      if (!fbUser) return cb(null);
      const ref = doc(this.db, 'users', fbUser.uid);
      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          // New accounts start as 'pending'; an admin must approve them (rules enforce this).
          await setDoc(ref, {
            email: fbUser.email ?? '',
            name: fbUser.displayName ?? fbUser.email ?? '',
            role: 'pending',
            createdAt: new Date().toISOString(),
          });
        }
      } catch {
        /* the snapshot listener below reports the state */
      }
      unsubUser = onSnapshot(
        ref,
        (s) => {
          const d = s.data();
          cb({
            uid: fbUser.uid,
            email: fbUser.email ?? '',
            name: (d?.name as string) || fbUser.email || '',
            role: ((d?.role as UserRole) ?? 'pending'),
          });
        },
        () => cb({ uid: fbUser.uid, email: fbUser.email ?? '', name: fbUser.email ?? '', role: 'pending' }),
      );
    });
    return () => {
      unsubUser?.();
      unsubAuth();
    };
  }

  async signIn(email: string, password: string) {
    await signInWithEmailAndPassword(this.auth, email.trim(), password);
  }

  async signUp(email: string, password: string, name: string) {
    const cred = await createUserWithEmailAndPassword(this.auth, email.trim(), password);
    if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
  }

  async signOut() {
    await fbSignOut(this.auth);
  }

  subscribeProjects(cb: (projects: Project[]) => void, onError: (e: Error) => void): Unsubscribe {
    return onSnapshot(
      collection(this.db, 'projects'),
      (snap) =>
        cb(
          snap.docs
            .map((d) => ({ id: d.id, name: d.data().name as string, createdAt: d.data().createdAt as string }))
            .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
        ),
      onError,
    );
  }

  async createProject(name: string): Promise<Project> {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) throw new Error('Proje adı girin.');
    const dup = await getDocs(query(collection(this.db, 'projects'), where('nameKey', '==', fold(clean))));
    if (!dup.empty) throw new Error(`"${clean}" adında bir proje zaten var.`);
    const project: Project = { id: newProjectId(), name: clean, createdAt: new Date().toISOString() };
    await setDoc(doc(this.db, 'projects', project.id), { name: clean, nameKey: fold(clean), createdAt: project.createdAt });
    return project;
  }

  subscribeProjectData(projectId: string, cb: (data: ProjectData) => void, onError: (e: Error) => void): Unsubscribe {
    const parts: Partial<Record<keyof ProjectData, unknown[]>> = {};
    const keys: (keyof ProjectData)[] = ['isometrics', 'spools', 'materials', 'spoolMaterials'];
    const unsubs = keys.map((k) =>
      onSnapshot(
        collection(this.db, 'projects', projectId, k),
        (snap) => {
          parts[k] = snap.docs.map((d) => upgradeRecord({ ...d.data(), id: d.id }));
          if (keys.every((x) => parts[x])) cb(parts as unknown as ProjectData);
        },
        onError,
      ),
    );
    return () => unsubs.forEach((u) => u());
  }

  async setSpoolStatus(projectId: string, spoolId: string, status: SpoolStatus, user: AppUser): Promise<void> {
    // Rules allow engineers to change exactly these three fields.
    await updateDoc(doc(this.db, 'projects', projectId, 'spools', spoolId), {
      status,
      updatedAt: new Date().toISOString(),
      updatedBy: user.uid,
    });
  }

  async commitImport(projectId: string, kind: ImportKind, preview: ImportPreview<{ id: string }>): Promise<number> {
    const col = COLLECTION[kind];
    const writes: { id: string; data: Record<string, unknown>; merge: boolean }[] = [
      ...preview.create.map((x) => ({ id: x.id, data: { ...x }, merge: false })),
      ...preview.update.map((x) => ({ id: x.id, data: importUpdate(kind, x), merge: true })),
    ];
    // Note: large imports are split into several batches; a failure part-way leaves earlier
    // batches written. Re-running the same import is safe because IDs are deterministic.
    for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
      const batch = writeBatch(this.db);
      for (const w of writes.slice(i, i + BATCH_LIMIT)) {
        const { id, ...data } = w.data;
        void id;
        batch.set(doc(this.db, 'projects', projectId, col, w.id), data, { merge: w.merge });
      }
      await batch.commit();
    }
    return writes.length;
  }

  subscribeUsers(cb: (users: AppUser[]) => void, onError: (e: Error) => void): Unsubscribe {
    return onSnapshot(
      collection(this.db, 'users'),
      (snap) =>
        cb(
          snap.docs
            .map((d) => ({ uid: d.id, email: d.data().email ?? '', name: d.data().name ?? '', role: d.data().role ?? 'pending' }))
            .sort((a, b) => a.email.localeCompare(b.email)),
        ),
      onError,
    );
  }

  async setUserRole(uid: string, role: UserRole): Promise<void> {
    await updateDoc(doc(this.db, 'users', uid), { role });
  }
}
