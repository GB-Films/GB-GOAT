const { HttpsError } = require('firebase-functions/v2/https');
const { GENERAL_CASH_EMAILS, canAccessGeneralCash } = require('./generalCashAccess');
const { hasTeamWorkAccess } = require('./teamWorkAccess');

const email = value => String(value || '').trim().toLowerCase();
const projectRoles = ['admin', 'jefe_produccion', 'jefe_area'];
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(value);
const members = project => Array.isArray(project.collaboratorEmails) ? project.collaboratorEmails.map(email) : [];
const accountFields = ['email', 'displayName', 'role', 'teamOnboarding'];

function recipientPermissions(project, account, collaborator, gate) {
  const address = email(account?.email);
  if (!validEmail(address) || !hasTeamWorkAccess(account) || gate?.status === 'pending'
    || (Array.isArray(project.teamOnboardingBlockedEmails) && project.teamOnboardingBlockedEmails.map(email).includes(address))
    || email(collaborator?.teamOnboardingBlockedEmail) === address) return null;
  const owner = project.createdBy === account.id;
  const globalAdmin = account.role === 'admin';
  const participant = owner || projectRoles.includes(collaborator?.role) || members(project).includes(address);
  return {
    person: { email: address, displayName: String(account.displayName || collaborator?.displayName || address).slice(0, 200) },
    uid: account.id,
    canReceiveReturn: canAccessGeneralCash(address) && (globalAdmin || owner || collaborator?.role === 'admin'),
    participant,
    globalAdmin,
  };
}

const canReceiveTransfer = (target, senderIsAdmin) => target.participant || target.canReceiveReturn || senderIsAdmin && target.globalAdmin;

async function resolveCashRecipient(db, tx, root, project, toEmail) {
  const [users, collaborator, gate] = await Promise.all([
    tx.get(db.collection('users').where('email', '==', toEmail).select(...accountFields).limit(2)),
    tx.get(root.collection('collaborators').doc(toEmail)),
    tx.get(db.doc(`teamAccessEmails/${toEmail}`)),
  ]);
  if (users.size !== 1) return null;
  const account = { ...users.docs[0].data(), id: users.docs[0].id };
  return recipientPermissions(project, account, collaborator.data(), gate.data());
}

async function listCashRecipients(db, root, access, actorEmail) {
  const project = access.project;
  const [peers, admins, owner] = await Promise.all([
    root.collection('collaborators').limit(301).get(),
    access.admin ? db.collection('users').where('role', '==', 'admin').select('email').limit(101).get() : null,
    project.createdBy && /^[\w-]{1,160}$/.test(project.createdBy) ? db.doc(`users/${project.createdBy}`).get() : null,
  ]);
  const collaborators = new Map(peers.docs.map(doc => [email(doc.id), doc.data()]));
  const addresses = [...new Set([...GENERAL_CASH_EMAILS, ...members(project), ...collaborators.keys(),
    email(owner?.data()?.email), ...(admins?.docs || []).map(doc => email(doc.data().email))])]
    .filter(address => validEmail(address) && address !== actorEmail);
  if (peers.size > 300 || (admins?.size || 0) > 100 || addresses.length > 400)
    throw new HttpsError('failed-precondition', 'La lista de destinatarios requiere revisión del equipo del proyecto.');

  const queries = [];
  for (let index = 0; index < addresses.length; index += 30) {
    queries.push(db.collection('users').where('email', 'in', addresses.slice(index, index + 30)).select(...accountFields).get());
  }
  const accounts = new Map();
  for (const doc of (await Promise.all(queries)).flatMap(snapshot => snapshot.docs)) {
    const data = doc.data(), address = email(data.email);
    // Require an unambiguous destination, just as we do when writing the movement.
    accounts.set(address, accounts.has(address) ? null : { ...data, id: doc.id });
  }
  const candidates = [...accounts.values()].filter(Boolean);
  const gates = candidates.length ? await db.getAll(...candidates.map(user => db.doc(`teamAccessEmails/${email(user.email)}`))) : [];
  const result = { returns: [], transfers: [] };
  candidates.forEach((user, index) => {
    const target = recipientPermissions(project, user, collaborators.get(email(user.email)), gates[index].data());
    if (!target) return;
    if (target.canReceiveReturn) result.returns.push(target.person);
    if (canReceiveTransfer(target, access.admin)) result.transfers.push(target.person);
  });
  for (const people of Object.values(result)) people.sort((left, right) => left.displayName.localeCompare(right.displayName, 'es') || left.email.localeCompare(right.email));
  return result;
}

module.exports = { listCashRecipients, resolveCashRecipient, canReceiveTransfer };
