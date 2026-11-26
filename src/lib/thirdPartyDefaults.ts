export type ThirdPartyDetails = { name?: string; cuit?: string; cbu?: string; alias?: string };
export type ThirdPartyChoice = { source: 'signed' | 'saved'; party: ThirdPartyDetails };

export function thirdPartyPartyFields(details?: ThirdPartyDetails | null) {
  return { name: details?.name || '', cuit: details?.cuit || '', account: details?.cbu || details?.alias || '' };
}

export function thirdPartyFormDefaults(view: any) {
  const preferred = view?.thirdPartyChoices?.[0]?.party || view?.thirdPartyLastSigned?.party
    || view?.thirdPartyDefaults || view?.thirdPartyIntake?.party;
  return { ...thirdPartyPartyFields(preferred), responsibilityConfirmed: false, workKeys: [] as string[] };
}
