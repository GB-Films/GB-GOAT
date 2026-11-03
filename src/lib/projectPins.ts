import { arrayRemove, arrayUnion, doc, updateDoc, type Firestore } from 'firebase/firestore';

// Account preferences only. Do not include updatedAt: self-service profile
// rules intentionally allow only displayName, photoURL and pinnedProjectIds.
export async function saveProjectPin(db: Firestore, uid: string, projectId: string, pinned: boolean) {
  await updateDoc(doc(db, 'users', uid), {
    pinnedProjectIds: pinned ? arrayUnion(projectId) : arrayRemove(projectId),
  });
}
