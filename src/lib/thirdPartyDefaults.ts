export type ThirdPartyDetails = { name?: string; cuit?: string; cbu?: string; alias?: string };

export function thirdPartyPartyFields(details?: ThirdPartyDetails | null) {
  return { name: details?.name || '', cuit: details?.cuit || '', account: details?.cbu || details?.alias || '' };
}

export function thirdPartyFormDefaults(view: any) {
  const saved = view?.thirdPartyLastSigned?.party || view?.thirdPartyDefaults;
  const legacy = view?.thirdPartyIntake;
  return { ...thirdPartyPartyFields(saved || legacy?.party),
    roles: ['invoice', 'payment'], responsibilityConfirmed: false,
    workKeys: saved ? [] : legacy?.workKeys || [] };
}
