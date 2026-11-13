const { HttpsError } = require('firebase-functions/v2/https');
const { createHash } = require('node:crypto');
const { projectFinanceAccess } = require('./projectFinanceAccess');
const { hasTeamWorkAccess } = require('./teamWorkAccess');
const { isInternalBudgetEstimate } = require('./internalBudgetEstimate');
const { activeRecordAllocations } = require('./providerFinanceAllocations');
const list = value => Array.isArray(value) ? value : [];
const clean = value => String(value || '').trim() === 'Sin subcategoria' ? '' : String(value || '').trim();
const groupKey = (area, subcategory) => `${area}||${clean(subcategory)}`;
const fail = (message, code = 'failed-precondition') => { throw new HttpsError(code, message); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tuple = row => `${row.projectId}/${row.collectionName}/${row.itemId}`;
const cents = amount => Math.round((Number(amount) || 0) * 100);
const budgetVersion = entry => JSON.stringify(entry === undefined ? null : [
  typeof entry === 'number' ? true : entry?.budgetAssigned !== false,
  typeof entry === 'number' ? entry : Number(entry?.budget) || 0,
  typeof entry === 'number' ? '' : entry?.notes || '',
]);
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const name = (value, allowEmpty = false) => {
  if (typeof value !== 'string' || value.length > 160 || value.includes('||') || ['__proto__', 'constructor', 'prototype'].includes(value.trim()) || (!allowEmpty && !value.trim())) fail('Revisá el nombre del área o subcategoría.', 'invalid-argument');
  return clean(value);
};
const id = value => {
  if (typeof value !== 'string' || !/^[\w-]{1,160}$/.test(value)) fail('Identificador inválido.', 'invalid-argument');
  return value;
};
function canEdit(access, area, subcategory) {
  const c = access.collaborator || {};
  return access.admin || c.canEditBudgetAreas === true && list(c.allowedTabs).includes('areas')
    && !list(c.excludedSubcategories).includes(groupKey(area, subcategory))
    && (list(c.allowedCategories).includes(area) || !!subcategory && list(c.allowedSubcategories).includes(groupKey(area, subcategory)));
}
function groupNames(project, expenses, area) {
  const budgetNames = Object.entries(object(project.areaExpenseSubcategoryBudgets))
    .filter(([key, value]) => (value?.area || key.split('||')[0]) === area)
    .map(([key, value]) => clean(value?.subcategory || key.split('||')[1]));
  return [...new Set([...list(project.areaExpenseSubcategories?.[area]).map(clean), ...expenses.filter(row => row.area === area).map(row => clean(row.subcategory)), ...budgetNames])];
}
function categoryBudget(project, items, area) {
  const direct = project.categoryBudgets?.[area];
  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) return cents(direct);
  const rows = items.filter(row => row.area === area), estimates = rows.filter(isInternalBudgetEstimate);
  return (estimates.length ? estimates : rows).reduce((sum, row) => sum + cents(row.total), 0);
}
function checkBudget(project, items, budgets, area, ownKey, amount) {
  const other = Object.entries(budgets).reduce((sum, [key, entry]) => {
    if (key === ownKey || (entry?.area || key.split('||')[0]) !== area || entry?.budgetAssigned === false) return sum;
    return sum + cents(typeof entry === 'number' ? entry : entry?.budget);
  }, 0);
  if (other + cents(amount) > categoryBudget(project, items, area)) fail(`El presupuesto de la subcategoría supera lo disponible en ${area}. Revisá la asignación.`);
}
function createAreaStructureChange({ db, timestamp }) {
  return async (actor, input) => {
    const keys = ['action', 'operationId', 'projectId', 'kind', 'fromArea', 'fromSubcategory', 'targetArea', 'targetSubcategory', 'itemId', 'beforeExpenseId', 'beforeSubcategory', 'budget', 'expectedRevision'];
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.action !== 'reclassifyAreaExpenses' || Object.keys(input).some(key => !keys.includes(key)) || !['expense', 'subcategory'].includes(input.kind)
      || typeof input.operationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.operationId)
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('La solicitud de movimiento no es válida.', 'invalid-argument');
    const projectId = id(input.projectId), fromArea = name(input.fromArea), targetArea = name(input.targetArea);
    const fromSubcategory = name(input.fromSubcategory, true), targetSubcategory = name(input.targetSubcategory, true);
    const expenseMode = input.kind === 'expense', itemId = expenseMode ? id(input.itemId) : '';
    if (input.beforeExpenseId !== undefined) id(input.beforeExpenseId);
    if (input.beforeSubcategory !== undefined && input.beforeSubcategory !== null) name(input.beforeSubcategory, true);
    if (expenseMode && (input.budget !== undefined || input.beforeSubcategory !== undefined)
      || !expenseMode && (input.itemId !== undefined || input.beforeExpenseId !== undefined
        || fromArea !== targetArea && fromSubcategory !== targetSubcategory
        || fromSubcategory !== targetSubcategory && !targetSubcategory)) fail('Destino inválido.', 'invalid-argument');
    if (input.budget !== undefined && (expenseMode || fromArea !== targetArea || fromSubcategory === targetSubcategory
      || !input.budget || typeof input.budget !== 'object' || Array.isArray(input.budget)
      || Object.keys(input.budget).some(key => !['assigned', 'amount', 'notes', 'expected'].includes(key))
      || typeof input.budget.expected !== 'string' || input.budget.expected.length > 5000
      || typeof input.budget.assigned !== 'boolean' || typeof input.budget.amount !== 'number' || !Number.isFinite(input.budget.amount)
      || input.budget.amount < 0 || input.budget.amount > 1e12 || Math.abs(input.budget.amount * 100 - cents(input.budget.amount)) > 0.0001
      || typeof input.budget.notes !== 'string' || input.budget.notes.length > 2000)) fail('Presupuesto de subcategoría inválido.', 'invalid-argument');
    const root = db.doc(`projects/${projectId}`), audit = root.collection('activityLog').doc(`area-structure-${input.operationId}`);
    const fingerprint = hash({ actor, ...input });
    return db.runTransaction(async tx => {
      const access = await projectFinanceAccess({ db, transaction: tx, actor, projectId });
      if (!access.user || access.user.email?.trim().toLowerCase() !== actor.email || !hasTeamWorkAccess(access.user)
        || !canEdit(access, fromArea, fromSubcategory) || !canEdit(access, targetArea, targetSubcategory)) fail('Necesitás permiso de edición en el origen y el destino.', 'permission-denied');
      const project = access.project, revision = Number(project.budgetRevision) || 0;
      if (!list(project.activeAreas).includes(fromArea) || !list(project.activeAreas).includes(targetArea)) fail('El origen y el destino deben tener gestión de área activa.');
      if (!expenseMode && !access.admin && ![fromArea, targetArea].every(area => list(access.collaborator?.allowedCategories).includes(area))) {
        fail('Necesitás permiso de edición en las categorías de origen y destino para organizar subcategorías.', 'permission-denied');
      }
      const canManageBudget = access.admin || access.collaborator?.role === 'jefe_produccion'
        && list(access.collaborator.allowedCategories).includes(fromArea)
        && !list(access.collaborator.excludedSubcategories).some(key => key.startsWith(`${fromArea}||`));
      if (input.budget && !canManageBudget) fail('Podés renombrar o mover la subcategoría conservando su presupuesto. No tenés permiso para modificar la asignación.', 'permission-denied');
      const prior = await tx.get(audit);
      if (prior.exists) {
        if (prior.data().fingerprint !== fingerprint) fail('Este intento ya corresponde a otro cambio.');
        const ids = list(prior.data().changes).map(change => change.id);
        const currentRows = ids.length ? await tx.getAll(...ids.map(value => root.collection('areaExpenses').doc(id(value)))) : [];
        return { repeated: true, revision: prior.data().revision, view: {
          project: { budgetRevision: revision, areaExpenseSubcategories: project.areaExpenseSubcategories || {}, areaExpenseSubcategoryBudgets: project.areaExpenseSubcategoryBudgets || {} },
          expenses: currentRows.map(row => ({ id: row.id, after: row.exists ? { area: row.data().area, subcategory: clean(row.data().subcategory), order: Number(row.data().order) || 0, areaStructureRevision: Number(row.data().areaStructureRevision) || 0 } : null })),
        } };
      }
      if (revision !== input.expectedRevision) fail('La estructura del proyecto cambió. Actualizá la página y volvé a intentar.');
      const areaRows = await tx.get(root.collection('areaExpenses').limit(2001));
      if (areaRows.size > 2000) fail('Hay demasiados gastos para este cambio. Pedí a administración que revise el proyecto.');
      const expenses = areaRows.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      const rowsById = new Map(expenses.map(row => [row.id, row]));
      const patches = new Map(), nextLists = { ...object(project.areaExpenseSubcategories) }, nextBudgets = { ...object(project.areaExpenseSubcategoryBudgets) };
      const oldKey = groupKey(fromArea, fromSubcategory), newKey = groupKey(targetArea, targetSubcategory);
      if (input.budget && input.budget.expected !== budgetVersion(nextBudgets[oldKey])) fail('El presupuesto de la subcategoría cambió. Actualizá la página antes de renombrarla.');
      const sameGroup = oldKey === newKey;
      const time = value => value?.toMillis?.() || Date.parse(value || '') || 0;
      const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)
        || time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id);
      if (expenseMode) {
        const expense = rowsById.get(itemId);
        if (!expense || expense.area !== fromArea || clean(expense.subcategory) !== fromSubcategory) fail('El gasto cambió de ubicación. Actualizá la página antes de moverlo.');
        if (targetSubcategory && !groupNames(project, expenses, targetArea).includes(targetSubcategory)) fail('La subcategoría de destino ya no existe. Actualizá la página.');
        const group = (area, subcategory) => expenses.filter(row => row.id !== itemId && row.area === area && clean(row.subcategory) === subcategory).sort(byOrder);
        const source = group(fromArea, fromSubcategory), target = sameGroup ? source : group(targetArea, targetSubcategory);
        const index = input.beforeExpenseId ? target.findIndex(row => row.id === input.beforeExpenseId) : target.length;
        if (index < 0) fail('La posición de destino cambió. Actualizá la página.');
        target.splice(index, 0, expense);
        if (!sameGroup) source.forEach((row, order) => patches.set(row.id, { area: fromArea, subcategory: fromSubcategory, order }));
        target.forEach((row, order) => patches.set(row.id, { area: targetArea, subcategory: targetSubcategory, order }));
      } else {
        const source = groupNames(project, expenses, fromArea), target = fromArea === targetArea ? source : groupNames(project, expenses, targetArea);
        const sourceIndex = source.indexOf(fromSubcategory);
        if (sourceIndex < 0) fail('La subcategoría ya no existe. Actualizá la página.');
        if (!sameGroup && target.some(value => value.toLowerCase() === targetSubcategory.toLowerCase() && !(fromArea === targetArea && value === fromSubcategory))) fail('Ya existe esa subcategoría en el destino. Elegí otro nombre.');
        source.splice(sourceIndex, 1);
        let index = fromArea === targetArea ? Math.min(sourceIndex, target.length) : target.length;
        if (Object.hasOwn(input, 'beforeSubcategory')) index = input.beforeSubcategory === null ? target.length : target.indexOf(clean(input.beforeSubcategory));
        if (index < 0) fail('La posición de destino cambió. Actualizá la página.');
        target.splice(index, 0, targetSubcategory);
        nextLists[fromArea] = source.map(value => value || 'Sin subcategoria');
        nextLists[targetArea] = target.map(value => value || 'Sin subcategoria');
        if (!sameGroup) {
          expenses.filter(row => row.area === fromArea && clean(row.subcategory) === fromSubcategory)
            .forEach(row => patches.set(row.id, { area: targetArea, subcategory: targetSubcategory }));
          const entry = nextBudgets[oldKey]; delete nextBudgets[oldKey];
          if (input.budget !== undefined) nextBudgets[newKey] = { area: targetArea, subcategory: targetSubcategory, budget: input.budget.assigned ? input.budget.amount : 0,
            budgetAssigned: input.budget.assigned, notes: input.budget.notes.trim(), updatedByEmail: actor.email };
          else if (entry !== undefined) nextBudgets[newKey] = typeof entry === 'number' ? entry : { ...entry, area: targetArea, subcategory: targetSubcategory };
          const movedBudget = nextBudgets[newKey], amount = movedBudget?.budgetAssigned === false ? 0 : typeof movedBudget === 'number' ? movedBudget : movedBudget?.budget || 0;
          if (amount > 0) {
            const items = await tx.get(root.collection('budgetItems').limit(2001));
            if (items.size > 2000) fail('El presupuesto requiere revisión antes de mover la subcategoría.');
            checkBudget(project, items.docs.map(doc => doc.data()), nextBudgets, targetArea, newKey, amount);
          }
        }
      }
      for (const [id, patch] of patches) {
        const old = rowsById.get(id);
        if (old.area === patch.area && clean(old.subcategory) === patch.subcategory
          && (patch.order === undefined || Number(old.order || 0) === patch.order)) patches.delete(id);
      }
      const relocated = new Map([...patches].filter(([id, patch]) => {
        const old = rowsById.get(id); return old.area !== patch.area || clean(old.subcategory) !== patch.subcategory;
      }));
      const collaborators = !expenseMode && !sameGroup ? await tx.get(root.collection('collaborators').limit(301)) : null;
      if (collaborators?.size > 300) fail('Hay demasiados permisos para este cambio.');
      const cash = relocated.size ? await tx.get(root.collection('cashMovements').limit(2001)) : null;
      if (cash?.size > 2000) fail('Hay demasiados movimientos vinculados para este cambio.');
      const recordIds = new Set(), recordExpenses = new Map();
      const linkRecord = (value, expenseId) => {
        const recordId = idValue(value); recordIds.add(recordId);
        if (!recordExpenses.has(recordId)) recordExpenses.set(recordId, new Set());
        recordExpenses.get(recordId).add(expenseId);
      };
      for (const [id] of relocated) {
        const row = rowsById.get(id);
        for (const ref of [...list(row.sharedInvoices), ...list(row.sharedReceipts)]) if (ref.id) linkRecord(ref.id, id);
        for (const payment of [...list(row.paymentHistory), ...list(row.sharedPaymentRecords)]) if (payment.sharedRecordId) linkRecord(payment.sharedRecordId, id);
        for (const value of list(row.sharedPaymentIds)) linkRecord(value, id);
      }
      function idValue(value) { return id(value); }
      if (recordIds.size > 150) fail('Hay demasiados comprobantes compartidos para mover este grupo de una vez.');
      const recordSnapshots = await Promise.all([...recordIds].map(value => tx.get(db.doc(`providerFinancialRecords/${value}`))));
      for (const snapshot of recordSnapshots) {
        if (!snapshot.exists) fail('Un comprobante vinculado ya no existe. Pedí a administración que revise el gasto.');
        if (snapshot.data().status !== 'active') continue;
        for (const expenseId of recordExpenses.get(snapshot.id)) if (rowsById.get(expenseId).providerId !== snapshot.data().providerId
          || !list(snapshot.data().allocations).some(a => a.projectId === projectId && a.collectionName === 'areaExpenses' && a.itemId === expenseId)) fail('El comprobante vinculado no corresponde a este gasto.');
      }
      const activeRecords = recordSnapshots.filter(s => s.data().status === 'active');
      const indexRef = db.doc(`providerFinanceProjectIndex/${projectId}`), indexSnapshot = activeRecords.length ? await tx.get(indexRef) : null;
      const providerIds = [...new Set(activeRecords.map(s => s.data().providerId).filter(Boolean))];
      const providerRefs = providerIds.map(value => db.doc(`providerFinanceProviderIndex/${idValue(value)}`));
      await Promise.all(providerRefs.map(ref => tx.get(ref)));
      const patchAllocation = allocation => allocation.projectId === projectId && allocation.collectionName === 'areaExpenses' && relocated.has(allocation.itemId)
        ? { ...allocation, area: relocated.get(allocation.itemId).area, ...(Object.hasOwn(allocation, 'subcategory') ? { subcategory: relocated.get(allocation.itemId).subcategory } : {}) } : allocation;
      const writes = [], now = timestamp(), enqueue = (ref, data, merge = false) => writes.push({ ref, data, merge });
      for (const [id, patch] of patches) enqueue(root.collection('areaExpenses').doc(id), { ...patch, areaStructureRevision: revision + 1, updatedAt: now });
      const records = { ...object(indexSnapshot?.data()?.records) };
      for (const snapshot of activeRecords) {
        const record = snapshot.data();
        for (const a of list(record.allocations)) if (a.projectId === projectId && a.collectionName === 'areaExpenses' && relocated.has(a.itemId)
          && rowsById.get(a.itemId).providerId !== record.providerId) fail('El proveedor del comprobante no coincide con el gasto.');
        const allocations = list(record.allocations).map(patchAllocation);
        const settlements = Object.fromEntries(Object.entries(object(record.settlements)).map(([key, rows]) => [key, list(rows).map(patchAllocation)]));
        enqueue(snapshot.ref, { allocations, ...(record.settlements ? { settlements } : {}), updatedAt: now });
        Object.defineProperty(records, snapshot.id, { value: activeRecordAllocations({ ...record, allocations }).filter(row => row.projectId === projectId).map(row => ({ area: row.area, collectionName: row.collectionName })), enumerable: true, configurable: true, writable: true });
      }
      if (activeRecords.length) {
        enqueue(indexRef, { records, managedAreas: [...new Set(Object.values(records).flat().filter(row => row.collectionName === 'areaExpenses').map(row => row.area))],
          budgetAreas: [...new Set(Object.values(records).flat().filter(row => row.collectionName === 'budgetItems').map(row => row.area))], updatedAt: now }, true);
        for (const ref of providerRefs) enqueue(ref, { updatedAt: now }, true);
      }
      for (const snapshot of cash?.docs || []) {
        const data = snapshot.data(), patch = data.collectionName === 'areaExpenses' ? relocated.get(data.itemId) : null;
        if (patch) enqueue(snapshot.ref, { area: patch.area, subcategory: patch.subcategory, updatedAt: now });
      }
      for (const snapshot of collaborators?.docs || []) {
        const c = snapshot.data(), change = values => [...new Set(list(values).map(value => value === oldKey ? newKey : value))];
        if (list(c.allowedSubcategories).includes(oldKey) || list(c.excludedSubcategories).includes(oldKey)) enqueue(snapshot.ref, {
          allowedSubcategories: change(c.allowedSubcategories), excludedSubcategories: change(c.excludedSubcategories), updatedAt: now,
        });
      }
      enqueue(root, { ...(!expenseMode ? { areaExpenseSubcategories: nextLists, areaExpenseSubcategoryBudgets: nextBudgets } : {}), budgetRevision: revision + 1, updatedAt: now });
      if (writes.length > 449 || !Number.isSafeInteger(revision + 1)) fail('El grupo es demasiado grande para moverlo de una vez. Pedí a administración que lo revise.');
      const changes = [...patches].map(([id, after]) => ({ id, before: { area: rowsById.get(id).area, subcategory: clean(rowsById.get(id).subcategory), order: Number(rowsById.get(id).order) || 0 }, after }));
      if (JSON.stringify(changes).length > 400000) fail('El grupo es demasiado grande para guardar el historial del cambio.');
      for (const write of writes) write.merge ? tx.set(write.ref, write.data, { merge: true }) : tx.update(write.ref, write.data);
      tx.create(audit, { action: 'area_structure_changed', kind: input.kind, actor, fingerprint, revision: revision + 1,
        fromArea, fromSubcategory, targetArea, targetSubcategory, changes, relatedMetadataPaths: writes.filter(w => !w.ref.path.includes('/areaExpenses/')).map(w => w.ref.path), createdAt: now });
      return { repeated: false, revision: revision + 1, affectedExpenses: patches.size, view: {
        project: { budgetRevision: revision + 1, areaExpenseSubcategories: nextLists, areaExpenseSubcategoryBudgets: nextBudgets },
        expenses: [...patches].map(([id, patch]) => ({ id, after: { area: patch.area, subcategory: patch.subcategory,
          order: Number(patch.order ?? rowsById.get(id).order) || 0, areaStructureRevision: revision + 1 } })),
      } };
    });
  };
}
module.exports = { createAreaStructureChange, groupNames, clean };
