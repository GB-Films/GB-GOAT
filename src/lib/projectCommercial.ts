import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { normalizeEmail } from './identity';
import { mergeProjectCommercial, splitProjectCommercial } from './projectCommercialFields';

// The caller must determine admin status from authenticated profile/ACL, not a
// user-editable project property. Firestore independently enforces authorization.
export async function readProjectCommercial(db: Firestore, project: Record<string, any>, isAdmin: boolean) {
  const publicData = splitProjectCommercial(project).publicData;
  if (!isAdmin) return publicData;
  const snapshot = await getDoc(doc(db, 'projectCommercial', project.id));
  if (!snapshot.exists()) {
    if (project.commercialDataVersion === 1) throw new Error('COMMERCIAL_UNAVAILABLE');
    return project; // Authorized legacy reads during the bounded rollout only.
  }
  return mergeProjectCommercial(publicData, snapshot.data());
}

export async function readAuthorizedProject(db: Firestore, project: Record<string, any>, actor: { uid: string; email: string; isAppAdmin: boolean }) {
  let isAdmin = actor.isAppAdmin || project.createdBy === actor.uid;
  if (!isAdmin && actor.email) {
    const access = await getDoc(doc(db, 'projects', project.id, 'collaborators', normalizeEmail(actor.email)));
    isAdmin = access.data()?.role === 'admin';
  }
  return readProjectCommercial(db, project, isAdmin);
}
