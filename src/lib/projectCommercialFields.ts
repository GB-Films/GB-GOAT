export const COMMERCIAL_FIELDS = [
  'budgetTotal', 'clientName', 'brandName', 'companyName', 'serviceName',
  'controlTotalProjectId', 'controlTotalUrl', 'controlTotalSourceRowAtImport',
  'controlTotalStatusAtImport', 'controlTotalOwnerUnit', 'controlTotalInternalProviderUnit',
  'controlTotalCondition', 'controlTotalConfirmationDate', 'controlTotalDeliveryDate',
  'controlTotalContractCurrency', 'controlTotalContractAmount', 'controlTotalContractArs',
  'controlTotalContractUsd', 'controlTotalSourceWarning', 'controlTotalImportedAt',
  'crmSaleId', 'crmSaleUrl',
] as const;

export function splitProjectCommercial(data: Record<string, any>) {
  const publicData: Record<string, any> = {}, commercial: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    ((COMMERCIAL_FIELDS as readonly string[]).includes(key) ? commercial : publicData)[key] = value;
  }
  return { publicData, commercial };
}

export function mergeProjectCommercial(publicData: Record<string, any>, commercial: Record<string, any>) {
  return { ...splitProjectCommercial(publicData).publicData, ...splitProjectCommercial(commercial).commercial };
}
