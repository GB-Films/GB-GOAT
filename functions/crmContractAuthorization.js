'use strict';
const { rowHash } = require('./crmBaniPost');
const { projectIdFor } = require('./crmProjectImport');

function authorizationRecord(input, operatorEmail) {
  const keys = ['approvalId', 'projectCode', 'saleId', 'rowSha256', 'originalAmount', 'originalCurrency', 'amount', 'currency', 'confirmedAt', 'source', 'sourceSha256'];
  const record = Object.fromEntries(keys.map(key => [key, input[key]]));
  if (!/^B [A-Z0-9_-]{1,20} \d{4,8}$/.test(record.projectCode || '') || !/^[A-Za-z0-9_-]{1,200}$/.test(record.approvalId || '')
    || typeof record.saleId !== 'string' || /[\s/]/.test(record.saleId) || !/^[a-f0-9]{64}$/.test(record.rowSha256 || '')
    || rowHash(input.originalRow || {}) !== record.rowSha256 || input.originalRow.codigo_empresa !== `${record.projectCode} ${input.originalRow.proyecto}`
    || input.originalRow.empresa !== 'Bani VFX' || (input.originalRow.venta_id || '') !== record.saleId
    || !['ARS', 'USD'].includes(record.currency) || !Number.isFinite(record.amount) || record.amount < 0 || record.amount > 1e12 || Math.round(record.amount * 100) / 100 !== record.amount
    || record.originalCurrency !== input.originalRow.moneda || record.originalAmount !== (input.originalRow.precio_final === '' ? null : Number(input.originalRow.precio_final.replace(',', '.')))
    || !/^[a-f0-9]{64}$/.test(record.sourceSha256 || '') || typeof record.source !== 'string' || !record.source.trim() || record.source.length > 1000 || !Number.isFinite(Date.parse(record.confirmedAt))) throw Error('La autorización no coincide con la fila original y la confirmación documentada.');
  return { schemaVersion: 1, decision: 'approved', ...record, recordedByEmail: operatorEmail };
}

async function authorizeContract({ db, input, operatorEmail, apply = false }) {
  const record = authorizationRecord(input, operatorEmail), id = projectIdFor(record.projectCode);
  return db.runTransaction(async tx => {
    const users = await tx.get(db.collection('users').where('email', '==', operatorEmail).limit(2));
    if (users.size !== 1 || users.docs[0].data().role !== 'admin') throw Error('Sólo el operador administrativo global puede registrar esta confirmación.');
    const authRef = db.collection('crmProjectImportAuthorizations').doc(id);
    const prior = await tx.get(authRef);
    if (prior.exists) {
      if (Object.keys(record).some(k => JSON.stringify(prior.data()[k]) !== JSON.stringify(record[k]))) throw Error('Ya existe otra autorización: no se sobrescribe.');
      return { outcome: 'already_authorized', authorizationId: id, record };
    }
    const [projects, project, receipt] = await Promise.all([
      tx.get(db.collection('projects').where('projectCode', '==', record.projectCode).limit(2)),
      tx.get(db.collection('projects').doc(id)), tx.get(db.collection('crmProjectImports').doc(id)),
    ]);
    if (projects.size || project.exists || receipt.exists) throw Error('El proyecto o recibo ya existe; su presupuesto queda intacto.');
    if (apply) tx.create(authRef, record);
    return { outcome: apply ? 'authorized' : 'preview', authorizationId: id, record };
  });
}
module.exports = { authorizationRecord, authorizeContract };
