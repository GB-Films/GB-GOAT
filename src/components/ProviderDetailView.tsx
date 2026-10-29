import { useState, type ReactNode } from 'react';
import { Copy, Files } from 'lucide-react';
import { providerDisplayName, inferLegacyIdentifiers, formatIdentifier, normalizeDigits } from '../lib/providerConstants';
import { ProviderProjectList } from './ProviderProjectList';
import { ProviderFinanceWindow } from './ProviderFinanceWindow';
import { ProjectDialog } from '../pages/project-detail/ProjectDialog';
import type { ProjectDocumentScope } from '../lib/providerFinance';
const formatDate = (value: any) => typeof value === 'string' ? value.split('-').reverse().join('/') : value?.seconds ? new Date(value.seconds * 1000).toLocaleDateString('es-AR') : '-';

export function ProviderDetailView({ detail, loading, onClose, financePanel, companyPanel, canSeeBankDetails = true, initialProjectId, onOpenSharedDocument }: {
  detail: any; loading: boolean; onClose: () => void; financePanel?: ReactNode; companyPanel?: ReactNode; canSeeBankDetails?: boolean;
  initialProjectId?: string; onOpenSharedDocument?: (id: string, scope?: ProjectDocumentScope) => Promise<unknown>;
}) {
  const [copiedProviderField, setCopiedProviderField] = useState('');
  const [showFullData, setShowFullData] = useState(false);
  const [showFinance, setShowFinance] = useState(false);
  const provider = detail.provider;
  const inferred = inferLegacyIdentifiers(provider);
  const dni = formatIdentifier(provider.dni || inferred.dniNormalized) || '-';
  const cuitRaw = normalizeDigits(provider.cuit || inferred.cuitNormalized);
  const cuit = formatIdentifier(cuitRaw) || '-';
  const cbu = provider.bankAccount_cbu || provider.bankAccount || '-';
  const alias = provider.bankAccount_alias || '-';
  const category = provider.category === 'Otra' ? `Otra: ${provider.categoryOther || '-'}` : provider.category || '-';
  const totals = detail.totals || { total: 0, paid: 0, debt: 0 };
  const copyValue = async (label: string, value: string) => {
    if (!value || value === '-') return;
    await navigator.clipboard?.writeText(value);
    setCopiedProviderField(label);
    window.setTimeout(() => setCopiedProviderField(''), 1800);
  };
  const fullDataItems = [
    { label: 'Tipo', value: provider.type === 'empresa' ? 'Empresa' : 'Persona' },
    { label: 'Nombre / razon social', value: providerDisplayName(provider) },
    { label: 'Nombre', value: provider.name || '-' },
    { label: 'Apellido', value: provider.lastName || '-' },
    { label: 'Razon social', value: provider.businessName || '-' },
    { label: 'DNI', value: dni, copyValue: normalizeDigits(provider.dni || inferred.dniNormalized) || dni },
    { label: 'CUIT / CUIL', value: cuit, copyValue: cuitRaw || cuit },
    { label: 'CBU', value: cbu },
    { label: 'Alias', value: alias },
    { label: 'Email', value: provider.email || provider.adminEmail || '-' },
    { label: 'Telefono', value: provider.phone || '-' },
    { label: 'Domicilio', value: provider.address || '-' },
    { label: 'Fecha nacimiento', value: provider.birthDate ? formatDate(provider.birthDate) : '-', copyValue: provider.birthDate || '-' },
    { label: 'Categoria', value: category },
    { label: 'Restriccion alimentaria', value: provider.dietaryRestriction || '-' },
    { label: 'Origen', value: provider.source === 'provider_invite' ? 'Alta por link' : 'Carga interna' },
    { label: 'ID proveedor', value: provider.id || '-' },
  ];

  return <ProjectDialog title={`Ficha y comprobantes · ${providerDisplayName(provider)}`} wide onClose={onClose}
    actions={!loading && financePanel ? <button type="button" onClick={() => setShowFinance(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Files className="h-4 w-4" />Asignar documentos y pagos</button> : undefined}>
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">{[{ label: 'CUIT', value: cuit }, ...(canSeeBankDetails ? [{ label: 'CBU', value: cbu }, { label: 'Alias', value: alias }] : [])].map(item => <button key={item.label} type="button"
          onClick={() => void copyValue(item.label, item.label === 'CUIT' ? cuitRaw : item.value)} title={`Copiar ${item.label}`}
          className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
          <span className="text-slate-400">{item.label}</span><span className="font-mono">{item.value}</span><Copy className="h-3 w-3" />{copiedProviderField === item.label && <span>Copiado</span>}
        </button>)}</div>
        {!loading && <dl className="flex items-center gap-5 text-xs"><div><dt className="inline text-slate-500">Trabajado </dt><dd className="inline font-bold">${totals.total.toLocaleString('es-AR')}</dd></div>
          <div><dt className="inline text-slate-500">Saldo </dt><dd className={`inline font-bold ${totals.debt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>${totals.debt.toLocaleString('es-AR')}</dd></div></dl>}
      </div>
      {loading ? <p role="status" className="py-8 text-center text-sm text-slate-500">Cargando comprobantes…</p> : <>
              <section className="rounded-xl border border-slate-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowFullData((value) => !value)}
                  className="flex w-full items-center justify-between bg-slate-50 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  <span>Datos completos del proveedor</span>
                  <span>{showFullData ? 'Ocultar' : 'Ver todos'}</span>
                </button>
                {showFullData && (
                  <div className="grid grid-cols-1 gap-0 divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
                    {fullDataItems.filter(item => canSeeBankDetails || !['CBU', 'Alias'].includes(item.label)).map((item) => (
                      <div key={item.label} className="flex min-w-0 items-start justify-between gap-3 border-b border-slate-100 px-3 py-2 md:[&:nth-last-child(-n+2)]:border-b-0">
                        <div className="min-w-0">
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-300">{item.label}</div>
                          <div className="mt-1 break-words text-xs font-bold text-slate-700">{item.value || '-'}</div>
                        </div>
                        {item.value !== '-' && (
                          <button
                            type="button"
                            onClick={() => copyValue(item.label, item.copyValue || item.value)}
                            className={`shrink-0 rounded border px-2 py-1 text-[9px] font-black uppercase tracking-widest transition-colors ${
                              copiedProviderField === item.label
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-100 text-slate-400 hover:border-black hover:text-black'
                            }`}
                          >
                            {copiedProviderField === item.label ? 'Copiado' : 'Copiar'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
        {companyPanel && <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-600">Representación y respaldos de la empresa · acceso restringido</summary><div className="mt-3">{companyPanel}</div></details>}
        <div key={provider.id}><ProviderProjectList projects={detail.projects || []} lines={detail.lines || []} initialProjectId={initialProjectId} onOpenSharedDocument={onOpenSharedDocument} /></div>
      </>}
    </div>
    {financePanel && <ProviderFinanceWindow open={showFinance} onClose={() => setShowFinance(false)}>{financePanel}</ProviderFinanceWindow>}
  </ProjectDialog>;
}
