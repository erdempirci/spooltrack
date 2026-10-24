// Deterministic document IDs. Re-importing the same row produces the same ID,
// so duplicates are impossible at the storage level (both IndexedDB and Firestore).

/** Encodes a value so it is safe inside a Firestore document ID (no '/', '.', '~'). */
function enc(value: string): string {
  return encodeURIComponent(value).replace(
    /[.~!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Unique key: project + izometri_no + revizyon (project is the parent path). */
export function isoKey(isoNo: string, revision: string): string {
  return `I~${enc(isoNo)}~${enc(revision)}`;
}

/** Unique key: isometric_id + spool_no. */
export function spoolKey(isoId: string, spoolNo: string): string {
  return `${isoId}~S~${enc(spoolNo)}`;
}

/** Unique key: project + malzeme_kodu (project is the parent path). */
export function materialKey(code: string): string {
  return `M~${enc(code)}`;
}

export function spoolMaterialKey(spoolId: string, code: string): string {
  return `${spoolId}~M~${enc(code)}`;
}

export function newProjectId(): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return `P${rnd}`;
}
