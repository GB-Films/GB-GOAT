import { normalizeSearchText } from './identity';

export const PRODUCTION_AREA_CATEGORIES = [
  'Producción',
  'Dirección',
  'Asistencia de Dirección',
  'Cámara',
  'Iluminación',
  'Grip',
  'Sonido',
  'Arte',
  'Vestuario',
  'Maquillaje y Peinado',
  'Casting',
  'Actor/Actriz',
  'Locaciones',
  'Transporte',
  'Catering',
  'Postproducción',
  'VFX',
  'Música',
  'Administración',
  'Legales',
  'Otra',
];

export const COMPANY_PROVIDER_CATEGORIES = [
  'Rental de cámara',
  'Rental de luces',
  'Rental de grip',
  'Rental de arte',
  'Estudio / locación',
  'Productora',
  'Postproducción',
  'VFX',
  'Sonido',
  'Música',
  'Catering',
  'Transporte',
  'Hotelería',
  'Seguros',
  'Legales / contables',
  'Otra',
];

export const TAX_CONDITIONS = [
  'IVA Responsable Inscripto',
  'Monotributo',
  'Exento',
  'Consumidor Final',
  'No Responsable',
  'Otra',
];

export const normalizeDigits = (value: unknown) => String(value || '').replace(/\D/g, '');

export const isValidCbu = (value: unknown) => /^\d{22}$/.test(String(value || '').trim());

export const normalizeProviderText = (value: unknown) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

export const formatPersonName = (value: unknown) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (
      word
        .split('-')
        .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
        .join('-')
    ))
    .join(' ')
);

export const formatIdentifier = (value: unknown) => {
  const digits = normalizeDigits(value);
  if (digits.length === 11) return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
  if (digits.length === 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  return String(value || '');
};

export const providerDisplayName = (provider: any) => {
  if (provider?.type === 'empresa') return provider.businessName || provider.name || 'Empresa sin razón social';
  const fullName = `${formatPersonName(provider?.name)} ${formatPersonName(provider?.lastName)}`.trim();
  return fullName || formatPersonName(provider?.fullName) || 'Persona sin nombre';
};

const providerSearchFields = (provider: any) => [
  providerDisplayName(provider),
  provider?.name,
  provider?.lastName,
  provider?.fullName,
  provider?.nickname,
  provider?.apodo,
  provider?.alias,
  provider?.preferredName,
  provider?.businessName,
  provider?.dni,
  provider?.dniNormalized,
  provider?.cuit,
  provider?.cuitNormalized,
  provider?.dni_cuit,
  provider?.email,
  provider?.adminEmail,
  provider?.phone,
  provider?.address,
  provider?.category,
  provider?.categoryOther,
  provider?.bankAccount_cbu,
  provider?.bankAccount_alias,
].filter(Boolean).join(' ');

const matchesProviderTerms = (haystack: string, query: string) =>
  query.split(/\s+/).every((term) => haystack.includes(term));

export const providerSearchText = (provider: any) => normalizeSearchText(providerSearchFields(provider));

export const providerMatchesSearch = (provider: any, search: string) =>
  matchesProviderTerms(providerSearchText(provider), normalizeSearchText(search));

// Keep the existing fallback for financial rows missing a provider ID, where
// the matched record supplies identity and bank information.
export const providerMatchesLegacyReference = (provider: any, reference: string) =>
  matchesProviderTerms(providerSearchFields(provider).toLowerCase(), String(reference || '').trim().toLowerCase());

export const inferLegacyIdentifiers = (provider: any) => {
  const dni = normalizeDigits(provider?.dni);
  const cuit = normalizeDigits(provider?.cuit);
  const legacy = normalizeDigits(provider?.dni_cuit);

  return {
    dniNormalized: provider?.dniNormalized || dni || (legacy.length === 8 ? legacy : ''),
    cuitNormalized: provider?.cuitNormalized || cuit || (legacy.length === 11 ? legacy : ''),
  };
};
