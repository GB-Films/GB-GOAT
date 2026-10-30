'use strict';
const { rowHash, rowValid, GROUP_FIELDS } = require('./crmBaniPost');

// The authenticated CRM caller re-reads the complete registry. The receipt keeps
// its hash and the complete candidate set; number/name alone are never a link.
function validateIndependentB(data, proof, reject) {
  const fail = message => reject(400, message);
  const conflict = message => reject(409, message);
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)
    || JSON.stringify(proof).length > 16000
    || Object.keys(proof).sort().join(',') !== 'bCodeCount,bRow,gCandidateCount,gRows'
    || !rowValid(proof.bRow) || !Array.isArray(proof.gRows) || proof.gRows.length > 10
    || proof.gCandidateCount !== proof.gRows.length || !Number.isSafeInteger(proof.gCandidateCount)
    || !Number.isSafeInteger(proof.bCodeCount)) fail('Falta la comprobación completa de independencia del código B.');
  if (proof.bCodeCount !== 1) conflict('El código B está duplicado o no se verificó como único en el registro.');
  const b = proof.bRow;
  if (!b.codigo_n || !b.codigo || (!b.fecha_carga && data.importMode !== 'historical') || b.empresa !== 'Bani VFX'
    || b.codigo_empresa !== data.sourceProjectId || `B ${b.codigo}` !== data.sourceProjectId
    || b.proyecto !== data.name || (b.venta_id || '') !== data.saleId || rowHash(b) !== data.sourceEvidence.rowSha256) fail('La fila B no coincide con la identidad y la evidencia del registro.');
  if (!['Externo', 'Interno'].includes(b.tipo_cliente) || data.condition !== b.tipo_cliente
    || data.ownerUnit !== 'BANI' || data.internalProviderUnit !== (b.tipo_cliente === 'Interno' ? 'BANI' : '')
    || data.clientName !== (b.tipo_cliente === 'Interno' ? 'Gran Berta' : b.cliente)) fail('La unidad BANI y el cliente deben conservar el mapeo de la fila B.');
  for (const g of proof.gRows) {
    if (!rowValid(g) || !/^G [A-Z0-9_-]{1,20} \d{4,8} .+$/.test(g.codigo_empresa || '') || g.codigo_empresa !== `G ${g.codigo}`) fail('La evidencia de candidatos G no es válida.');
    const related = g.codigo_n === b.codigo_n || Boolean(b.codigo_discord && g.codigo_discord === b.codigo_discord);
    if (!related) continue;
    if (g.empresa === 'Gran Berta' && g.tipo_cliente === 'Externo' && GROUP_FIELDS.every(key => (g[key] || '') === (b[key] || ''))) conflict('El código B tiene un G asociado; corresponde la asignación BANI en G, no otro proyecto.');
    conflict('La relación de operación entre B y G es ambigua. Requiere revisión antes de crear.');
  }
  if (b.moneda !== data.contractCurrency || (data.contractAmount === null ? b.precio_final !== '' : !/^\d+(?:[.,]\d{1,2})?$/.test(b.precio_final || '')
    || Number(b.precio_final.replace(',', '.')) !== data.contractAmount || data.contractAmount > 1e12 || !Number.isSafeInteger(Math.round(data.contractAmount * 100)))) fail('El precio confirmado debe ser el de esta fila B, no el presupuesto general de la venta.');
  if (data.importMode === 'new' && data.contractAmount !== null && (b.origen !== 'v3-form' || /precio a definir/i.test(b.para_revisar || ''))) fail('El importe B nuevo requiere confirmación canónica del código.');
  return { bRow: { ...b }, gRows: proof.gRows.map(g => ({ ...g })), gCandidateCount: proof.gCandidateCount, bCodeCount: proof.bCodeCount };
}
module.exports = { validateIndependentB };
