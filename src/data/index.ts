import { LocalRepo } from './localRepo';
import type { Repo } from './repo';

const env = import.meta.env;

/** Firebase is used when its config is present in .env; otherwise data stays on this device. */
export const firebaseConfig = env.VITE_FIREBASE_API_KEY
  ? {
      apiKey: env.VITE_FIREBASE_API_KEY as string,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string,
      projectId: env.VITE_FIREBASE_PROJECT_ID as string,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
      appId: env.VITE_FIREBASE_APP_ID as string,
    }
  : null;

export async function createRepo(): Promise<Repo> {
  if (firebaseConfig) {
    // Loaded lazily so local mode does not download the Firebase SDK.
    const { FirebaseRepo } = await import('./firebaseRepo');
    return new FirebaseRepo(firebaseConfig);
  }
  return new LocalRepo();
}
