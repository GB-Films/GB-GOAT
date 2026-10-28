export function thirdPartyFormDefaults(view: any) {
  const saved = view?.thirdPartyDefaults;
  const legacy = view?.thirdPartyIntake;
  const details = saved || legacy?.party || {};
  return { name: details.name || '', cuit: details.cuit || '', account: details.cbu || details.alias || '',
    roles: ['invoice', 'payment'], responsibilityConfirmed: false,
    workKeys: saved ? [] : legacy?.workKeys || [] };
}
