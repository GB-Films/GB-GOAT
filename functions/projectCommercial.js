// Shared policy contract with src/lib/projectCommercialFields.ts (parity-tested).
const COMMERCIAL_FIELDS = [
  'budgetTotal', 'clientName', 'brandName', 'companyName', 'serviceName',
  'controlTotalProjectId', 'controlTotalUrl', 'controlTotalSourceRowAtImport',
  'controlTotalStatusAtImport', 'controlTotalOwnerUnit', 'controlTotalInternalProviderUnit',
  'controlTotalCondition', 'controlTotalConfirmationDate', 'controlTotalDeliveryDate',
  'controlTotalContractCurrency', 'controlTotalContractAmount', 'controlTotalContractArs',
  'controlTotalContractUsd', 'controlTotalSourceWarning', 'controlTotalImportedAt',
  'crmSaleId', 'crmSaleUrl',
];
function splitProjectCommercial(data) {
  const publicData = {}, commercial = {};
  for (const [key, value] of Object.entries(data)) {
    (COMMERCIAL_FIELDS.includes(key) ? commercial : publicData)[key] = value;
  }
  return { publicData, commercial };
}
module.exports = { COMMERCIAL_FIELDS, splitProjectCommercial };
