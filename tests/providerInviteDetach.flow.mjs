import assert from 'node:assert/strict';

export async function testDetachProviderInvite({ db, finance, portal, seed, input, submit }) {
  const projectId = 'invite-detach-project';
  const otherProjectId = 'invite-other-project';
  const admin = 'invite-admin';
  const producer = 'invite-producer';
  const request = (data, uid = admin, verified = true) => ({
    auth: { uid, token: { email: uid + '@example.test', email_verified: verified } }, data,
  });
  const root = db.doc('projects/' + projectId);
  await Promise.all([
    root.set({ createdBy: admin, collaboratorEmails: [producer + '@example.test'] }),
    db.doc('projects/' + otherProjectId).set({ createdBy: admin }),
    db.doc('users/' + admin).set({ role: 'colaborador', email: admin + '@example.test' }),
    db.doc('users/' + producer).set({ role: 'jefe_produccion', email: producer + '@example.test' }),
    root.collection('collaborators').doc(producer + '@example.test').set({
      role: 'jefe_produccion', allowedCategories: ['Campo'], allowedTabs: ['areas'], canEditBudgetAreas: true,
    }),
  ]);
  const read = async ref => (await ref.get()).data();
  const prepare = async (token, { collectionName = 'areaExpenses', row = {}, invite = {}, link = true } = {}) => {
    const itemId = token + '-work';
    const rowRef = root.collection(collectionName).doc(itemId);
    const inviteRef = db.doc('providerInvites/' + token);
    const action = { action: 'detachProviderInvite', projectId, collectionName, itemId, inviteToken: token };
    const rowData = { area: 'Campo', providerId: '', providerName: '', total: 55, paymentHistory: [],
      ...(link ? { providerInviteLink: { token, status: 'pending', createdBy: admin } } : {}), ...row };
    await rowRef.set(rowData);
    await seed(token, { mode: 'single_use', projectId, collectionName, expenseId: itemId, area: 'Campo',
      projectName: 'Proyecto ficticio', subcategory: 'Locaciones', description: 'Adjunto de prueba', ...invite });
    const audit = async () => {
      const { docs } = await root.collection('activityLog').where('itemId', '==', itemId).get();
      assert.equal(docs.length, 1);
      return docs[0].data();
    };
    return { rowRef, inviteRef, rowData, action, audit, detach: () => finance(request(action)) };
  };
  const without = (value, ...keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  const canonicalFields = ['projectId', 'collectionName', 'expenseId', 'projectName', 'area', 'subcategory', 'description', 'provisionalProviderId', 'updatedAt'];

  // A paid expense continues to have every financial field and the original assignment history.
  const otherSupplierRef = db.doc('providers/detach-original-supplier');
  const otherSupplier = { name: 'Proveedor original ficticio', registration: { status: 'complete' } };
  await otherSupplierRef.set(otherSupplier);
  const used = await prepare('detach-used', {
    row: { paid: true, paymentLocked: true, paymentAuthorIds: [admin], paymentHistory: [{ id: 'pay', amount: 55, createdBy: admin }],
      invoice: { path: 'fictitious/invoice.pdf' }, otherReceipts: [{ path: 'fictitious/receipt.pdf' }],
      providerInviteAssignment: { token: 'detach-used', providerId: otherSupplierRef.id } },
    invite: { status: 'used', used: true, usedAt: new Date(1000), providerId: otherSupplierRef.id, providerType: 'persona' },
  });
  const usedBefore = await read(used.inviteRef);
  await assert.rejects(finance(request(used.action, producer)), error => error.code === 'permission-denied');
  await assert.rejects(finance(request(used.action, admin, false)), error => error.code === 'permission-denied');
  await assert.rejects(finance({ data: used.action }), error => error.code === 'unauthenticated');
  await db.doc(`projects/${otherProjectId}/areaExpenses/${used.action.itemId}`).set(used.rowData);
  await assert.rejects(finance(request({ ...used.action, projectId: otherProjectId })), /no corresponde/);
  assert.deepEqual(await read(used.inviteRef), usedBefore);
  assert.deepEqual(await read(used.rowRef), used.rowData);

  const replies = await Promise.all([used.detach(), used.detach()]);
  assert.deepEqual(replies, [{ status: 'detached' }, { status: 'detached' }]);
  assert.deepEqual(without(await read(used.rowRef), 'updatedAt'), { ...used.rowData, providerInviteLink: null });
  assert.deepEqual(without(await read(used.inviteRef), 'updatedAt'), without(usedBefore, ...canonicalFields));
  assert.deepEqual(await read(otherSupplierRef), otherSupplier);
  assert.equal((await used.audit()).previousInviteProviderId, otherSupplierRef.id);
  assert.equal((await used.audit()).previousScope.expenseId, used.action.itemId);
  assert(!JSON.stringify(await used.audit()).includes('"token"'), 'never log the usable invitation token');
  await assert.rejects(submit(input('detach-used')), /ya fue utilizado/);

  const pending = await prepare('detach-pending', { collectionName: 'budgetItems' });
  const pendingBefore = await read(pending.inviteRef);
  await pending.detach();
  assert.deepEqual(without(await read(pending.inviteRef), 'updatedAt'), without(pendingBefore, ...canonicalFields));
  assert.deepEqual(await portal({ data: { action: 'linkedInviteTargetStatus', inviteToken: 'detach-pending' } }), { issue: null });
  const originalRowAfterDetach = await read(pending.rowRef);
  const registration = await submit(input('detach-pending'));
  assert.equal((await read(pending.inviteRef)).providerId, registration.providerId);
  assert.deepEqual(await read(pending.rowRef), originalRowAfterDetach, 'the same link registers normally without assigning the old row');

  const provisional = await prepare('detach-provisional', {
    link: false,
    row: { providerId: otherSupplierRef.id, providerName: otherSupplier.name },
    invite: { provisionalProviderId: otherSupplierRef.id },
  });
  await provisional.detach();
  assert.equal(Object.hasOwn(await read(provisional.inviteRef), 'provisionalProviderId'), false);
  const unrelated = await submit(input('detach-provisional'));
  assert.notEqual(unrelated.providerId, otherSupplierRef.id);
  assert.deepEqual(await read(provisional.rowRef), provisional.rowData);
  assert.deepEqual(await read(otherSupplierRef), otherSupplier);

  const changed = await prepare('detach-replaced', { row: { providerInviteLink: { token: 'replacement', status: 'pending' } } });
  const changedBefore = await read(changed.inviteRef);
  await assert.rejects(changed.detach(), /otro enlace/);
  assert.deepEqual(await read(changed.inviteRef), changedBefore);
  assert.deepEqual(await read(changed.rowRef), changed.rowData);

  const race = await prepare('detach-registration-race');
  const [, registered] = await Promise.all([race.detach(), submit(input('detach-registration-race'))]);
  const raceAudit = await race.audit();
  const raceRow = await read(race.rowRef);
  assert.equal(raceRow.providerInviteLink, null);
  // If registration committed first its existing assignment stays. If detach
  // committed first, registration read the unlinked invite and made no assignment.
  assert.equal(raceRow.providerId, raceAudit.previousInviteStatus === 'used' ? registered.providerId : '');
  assert.equal(Object.hasOwn(await read(race.inviteRef), 'expenseId'), false);
  assert.equal((await read(race.inviteRef)).providerId, registered.providerId);
  console.log('PASS provider invite detach: admin and scope, paid history, used and active links, budget rows, provisional rows and concurrent signup');
}
