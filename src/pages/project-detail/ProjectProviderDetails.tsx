import { formatIdentifier, inferLegacyIdentifiers, providerDisplayName } from '../../lib/providerConstants';
import { ProjectDialog } from './ProjectDialog';

export function ProjectProviderDetails({ provider, canSeeBankDetails, onClose }: { provider: any; canSeeBankDetails: boolean; onClose: () => void }) {
  const identifiers = inferLegacyIdentifiers(provider);
  const fields = [
    ['Tipo', provider.type === 'empresa' ? 'Empresa' : 'Persona'],
    ['Nombre / razón social', providerDisplayName(provider)],
    ['Nombre', provider.name], ['Apellido', provider.lastName], ['Razón social', provider.businessName],
    ['DNI', formatIdentifier(provider.dni || identifiers.dniNormalized)],
    ['CUIT / CUIL', formatIdentifier(provider.cuit || identifiers.cuitNormalized)],
    ['Email', provider.email || provider.adminEmail], ['Teléfono', provider.phone], ['Domicilio', provider.address],
    ['Fecha de nacimiento', provider.birthDate],
    ['Categoría', provider.category === 'Otra' ? `Otra: ${provider.categoryOther || '—'}` : provider.category],
    ['Restricción alimentaria', provider.dietaryRestriction],
    ...(canSeeBankDetails ? [
      ['CBU', provider.bankAccount_cbu || provider.bankAccount], ['Alias', provider.bankAccount_alias],
    ] : []),
  ];
  return <ProjectDialog title={providerDisplayName(provider)} onClose={onClose}>
    <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
      {fields.map(([label, value]) => <div key={label} className="min-w-0 border-b border-slate-100 py-3">
        <dt className="text-xs font-medium text-slate-500">{label}</dt>
        <dd className="mt-1 break-words text-sm text-slate-900">{value || '—'}</dd>
      </div>)}
    </dl>
  </ProjectDialog>;
}
