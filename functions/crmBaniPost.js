'use strict';
const { createHash } = require('node:crypto');
const { convertUsd } = require('./bnaQuote');
const BANI_PROVIDER_ID = 'MuwmMfDvOBC3tQkZLzvz';
const BANI_PROVIDER_NAME = 'BANI VFX LLC';
const BUDGET_ITEM_ID = 'crm-bani-post-v1';
const ROW_KEYS = 'siglas,numero,proyecto,cliente,codigo,codigo_empresa,codigo_n,codigo_discord,empresa,tipo_cliente,venta_id,fecha_carga,fecha_entrega,precio_final,moneda,origen,reparto,para_revisar'.split(',');
const GROUP_FIELDS = ['codigo_n', 'codigo', 'codigo_discord', 'proyecto', 'cliente', 'fecha_carga', 'venta_id', 'origen'];
const labels = {
  missing_pair: 'No hay una pareja B acreditada.', ambiguous_pair: 'La pareja B es ambigua.',
  invalid_source: 'La evidencia del código B requiere revisión.', pair_mismatch: 'Los códigos G y B no pertenecen al mismo grupo canónico.',
  unconfirmed_amount: 'Falta confirmar importe y moneda del código B.', invalid_amount: 'El importe o la moneda B requieren revisión.',
  provider_unavailable: 'La referencia única de BANI requiere revisión.', quote_unavailable: 'Falta una cotización BNA del día para la asignación B.',
};
const pending = (reason, source = {}) => ({ state: 'pending', reason, message: `Presupuesto interno BANI pendiente: ${labels[reason]}`, source });
const rowValid = row => row && typeof row === 'object' && !Array.isArray(row)
  && Object.keys(row).every(key => ROW_KEYS.includes(key) && typeof row[key] === 'string' && row[key].length <= 1000);
const rowHash = row => createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])))).digest('hex');

function prepareBaniPost(data) {
  const input = data.baniPost;
  if (!input) return pending('missing_pair');
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'bRow,candidateCount,gRow' || !rowValid(input.gRow)
    || !Number.isSafeInteger(input.candidateCount) || input.candidateCount < 0 || input.candidateCount > 2000) return pending('invalid_source');
  const g = input.gRow, b = input.bRow;
  const source = { registrySha256: data.sourceEvidence?.registrySha256 || '', gRowSha256: rowHash(g), operationKey: g.codigo_n || '',
    ...(rowValid(b) ? { bRowSha256: rowHash(b), sourceProjectId: b.codigo_empresa || '', originalAmount: b.precio_final || '', originalCurrency: b.moneda || '' } : {}) };
  if (data.schemaVersion !== 2 || source.gRowSha256 !== data.sourceEvidence.rowSha256 || g.codigo_empresa !== data.sourceProjectId
    || g.proyecto !== data.name || g.cliente !== data.clientName || (g.venta_id || '') !== data.saleId) return pending('invalid_source', source);
  if (input.candidateCount === 0 && b === null) return pending('missing_pair', source);
  if (input.candidateCount > 1 && b === null) return pending('ambiguous_pair', source);
  if (input.candidateCount !== 1 || !rowValid(b)) return pending('invalid_source', source);
  if (!g.codigo_n || !g.codigo || !g.fecha_carga || g.empresa !== 'Gran Berta' || g.tipo_cliente !== 'Externo'
    || b.empresa !== 'Bani VFX' || b.tipo_cliente !== 'Interno'
    || GROUP_FIELDS.some(key => (g[key] || '') !== (b[key] || ''))
    || !/^B [A-Z0-9_-]{1,20} \d{4,8} .+$/.test(b.codigo_empresa || '')
    || b.codigo_empresa !== `B ${b.codigo}`) return pending('pair_mismatch', source);
  if (!b.precio_final || !b.moneda || b.origen !== 'v3-form') return pending('unconfirmed_amount', source);
  const amount = /^\d+(?:[.,]\d{1,2})?$/.test(b.precio_final) ? Number(b.precio_final.replace(',', '.')) : NaN;
  if (!['ARS', 'USD'].includes(b.moneda) || !Number.isFinite(amount) || amount < 0 || amount > 1e12
    || !Number.isSafeInteger(Math.round(amount * 100))) return pending('invalid_amount', source);
  return { state: 'ready', amount, currency: b.moneda, source };
}

function validBaniProvider(provider) {
  return provider && provider.type === 'empresa' && (provider.name === BANI_PROVIDER_NAME || provider.businessName === BANI_PROVIDER_NAME);
}

function makeBaniBudget(post, projectId, timestamp, quote, now) {
  const amountArs = post.currency === 'USD' ? convertUsd(post.amount, quote, now) : post.amount;
  const audit = { state: 'created', budgetItemId: BUDGET_ITEM_ID, providerId: BANI_PROVIDER_ID,
    originalAmount: post.amount, originalCurrency: post.currency, amountArs, source: post.source,
    ...(post.currency === 'USD' ? { conversion: quote } : {}) };
  return { audit, row: { id: BUDGET_ITEM_ID, projectId, area: 'Post Producción', subcategory: '',
    providerId: BANI_PROVIDER_ID, providerName: BANI_PROVIDER_NAME, description: 'Toda la Post', unit: 'Unidad',
    quantity: 1, unitPrice: amountArs, total: amountArs, order: 1, economicNature: 'internal_estimate',
    crmBaniPost: audit, createdBy: 'crm-code-generator', createdByEmail: '', createdAt: timestamp, updatedAt: timestamp } };
}
module.exports = { BANI_PROVIDER_ID, BANI_PROVIDER_NAME, BUDGET_ITEM_ID, prepareBaniPost, validBaniProvider, makeBaniBudget, pending, rowHash };
