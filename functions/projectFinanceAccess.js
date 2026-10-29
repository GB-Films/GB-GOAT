const { HttpsError } = require('firebase-functions/v2/https');
const { hasTeamWorkAccess } = require('./teamWorkAccess');
const list = value => Array.isArray(value) ? value : [];
const deny = () => { throw new HttpsError('permission-denied', 'No tenés acceso a los comprobantes de este proyecto.'); };

async function projectFinanceAccess({ db, transaction, actor, projectId }) {
  const read = path => transaction ? transaction.get(db.doc(path)) : db.doc(path).get();
  const [projectSnap, userSnap, collaboratorSnap, gateSnap] = await Promise.all([
    read(`projects/${projectId}`), read(`users/${actor.uid}`),
    read(`projects/${projectId}/collaborators/${actor.email}`), read(`teamAccessEmails/${actor.email}`),
  ]);
  const project = projectSnap.data(), user = userSnap.data(), collaborator = collaboratorSnap.data();
  const globalAdmin = actor.email === 'info@granbertafilms.com' || user?.role === 'admin';
  if (!project || (actor.email !== 'info@granbertafilms.com' && (!hasTeamWorkAccess(user) || gateSnap.data()?.status === 'pending'))
    || list(project.teamOnboardingBlockedEmails).includes(actor.email)
    || collaborator?.teamOnboardingBlockedEmail === actor.email
    || !(globalAdmin || project.createdBy === actor.uid || collaboratorSnap.exists || list(project.collaboratorEmails).includes(actor.email))) deny();
  return { project, user, collaborator, admin: globalAdmin || project.createdBy === actor.uid || collaborator?.role === 'admin' };
}

function linkedAllocation(record, projectId, itemId, collectionName, expense) {
  if (!expense || expense.providerId !== record.providerId || !list(record.allocations).some(row =>
    row.projectId === projectId && row.collectionName === collectionName && row.itemId === itemId)) return false;
  if (record.kind === 'payment') return list(expense.paymentHistory).some(payment => payment.sharedRecordId === record.id);
  return list(expense[record.kind === 'invoice' ? 'sharedInvoices' : 'sharedReceipts']).some(ref => ref.id === record.id);
}

module.exports = { projectFinanceAccess, linkedAllocation };
