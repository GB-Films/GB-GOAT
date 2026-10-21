import { useState } from 'react';
import { motion } from 'motion/react';
import { X, Copy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { providerDisplayName, inferLegacyIdentifiers, formatIdentifier, normalizeDigits } from '../lib/providerConstants';
import { ProviderDocumentLinks } from './ProviderDocumentLinks';
import { ProviderFinancePanel } from './ProviderFinancePanel';
const formatDate = (value: any) => typeof value === 'string' ? value.split('-').reverse().join('/') : value?.seconds ? new Date(value.seconds * 1000).toLocaleDateString('es-AR') : '-';
export function ProviderDetailModal({ detail, loading, onClose, onChanged }: { detail: any; loading: boolean; onClose: () => void; onChanged?: () => void }) {
  const { profile } = useAuth();
  const [copiedProviderField, setCopiedProviderField] = useState('');
  const [showFullData, setShowFullData] = useState(false);
  const provider = detail.provider;
  const inferred = inferLegacyIdentifiers(provider);
  const dni = formatIdentifier(provider.dni || inferred.dniNormalized) || '-';
  const cuitRaw = normalizeDigits(provider.cuit || inferred.cuitNormalized);
  const cuit = formatIdentifier(cuitRaw) || '-';
  const cbu = provider.bankAccount_cbu || provider.bankAccount || '-';
  const alias = provider.bankAccount_alias || '-';
  const category = provider.category === 'Otra'
    ? `Otra: ${provider.categoryOther || '-'}`
    : provider.category || '-';
  const totals = detail.totals || { total: 0, paid: 0, debt: 0, invoices: 0, receipts: 0 };

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

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-white/80 backdrop-blur-md" />
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="bg-white rounded-xl w-full max-w-7xl max-h-[90vh] overflow-auto relative z-10 border border-slate-200 shadow-2xl shadow-slate-200/50">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 p-6 flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Detalle de proveedor</div>
            <h2 className="text-xl font-black text-slate-900">{providerDisplayName(provider)}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { label: 'CUIT', value: cuit },
                { label: 'CBU', value: cbu },
                { label: 'Alias', value: alias },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => copyValue(item.label, item.label === 'CUIT' ? cuitRaw : item.value)}
                  className={`inline-flex items-center gap-2 rounded border px-3 py-2 text-[10px] font-bold transition-colors ${
                    copiedProviderField === item.label
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-black'
                  }`}
                  title={`Copiar ${item.label}`}
                >
                  <span className="uppercase tracking-widest text-slate-400">{item.label}</span>
                  <span className="font-mono text-slate-900">{item.value}</span>
                  {copiedProviderField === item.label ? (
                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700">Copiado</span>
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-black"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-5">
          {!loading && profile?.role === 'admin' && <ProviderFinancePanel provider={provider} lines={detail.lines} onChanged={onChanged} />}
          {loading ? (
            <div className="py-16 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">Cargando detalle...</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Total trabajado', value: `$${totals.total.toLocaleString()}`, tone: 'text-slate-900' },
                  { label: 'Pagado', value: `$${totals.paid.toLocaleString()}`, tone: 'text-emerald-600' },
                  { label: 'Deuda', value: `$${totals.debt.toLocaleString()}`, tone: totals.debt > 0 ? 'text-rose-600' : 'text-emerald-600' },
                  { label: 'Facturas', value: totals.invoices.toLocaleString(), tone: 'text-slate-900' },
                  { label: 'Comprobantes', value: totals.receipts.toLocaleString(), tone: 'text-slate-900' },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50/60 p-4">
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{item.label}</div>
                    <div className={`mt-1 text-lg font-black font-mono ${item.tone}`}>{item.value}</div>
                  </div>
                ))}
              </div>

              <section className="rounded-xl border border-slate-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowFullData((value) => !value)}
                  className="flex w-full items-center justify-between bg-slate-50 px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  <span>Datos completos del proveedor</span>
                  <span>{showFullData ? 'Ocultar' : 'Ver todos'}</span>
                </button>
                {showFullData && (
                  <div className="grid grid-cols-1 gap-0 divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
                    {fullDataItems.map((item) => (
                      <div key={item.label} className="flex min-w-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 md:[&:nth-last-child(-n+2)]:border-b-0">
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

              <section className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Proyectos donde trabajo</div>
                {detail.projects.length === 0 ? (
                  <div className="p-8 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">Sin movimientos visibles</div>
                ) : (
                  <div className="overflow-x-auto">
                  <div className="min-w-[1050px] divide-y divide-slate-100">
                    <div className="grid grid-cols-[minmax(180px,1.5fr)_100px_100px_100px_140px_140px_150px] gap-3 bg-slate-50 px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                      <span>Proyecto</span><span className="text-right">Trabajado</span><span className="text-right">Pagado</span><span className="text-right">Deuda</span>
                      <span className="text-center">Facturas</span><span className="text-center">Otros comprobantes</span><span className="text-center">Comprobantes de pago</span>
                    </div>
                    {detail.projects.map((project: any) => (
                      <div key={project.id} className="grid grid-cols-[minmax(180px,1.5fr)_100px_100px_100px_140px_140px_150px] items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                        <a href={`#/proyectos/${project.id}`} className="min-w-0 hover:underline">
                          <div className="text-xs font-black text-slate-900 truncate">{project.name}</div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-300">{project.invoices} facturas / {project.receipts} comprobantes</div>
                        </a>
                        <div className="text-right text-xs font-bold text-slate-500">${project.total.toLocaleString()}</div>
                        <div className="text-right text-xs font-bold text-emerald-600">${project.paid.toLocaleString()}</div>
                        <div className={`text-right text-xs font-black ${project.debt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>${project.debt.toLocaleString()}</div>
                        <ProviderDocumentLinks documents={project.invoiceDocuments} kind="invoice" />
                        <ProviderDocumentLinks documents={project.otherReceiptDocuments} kind="other" />
                        <ProviderDocumentLinks documents={project.paymentReceiptDocuments} kind="payment" />
                      </div>
                    ))}
                  </div>
                  </div>
                )}
              </section>

              {detail.lines.length > 0 && (
                <section className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Movimientos</div>
                  <div className="overflow-x-auto">
                  <div className="min-w-[1050px] divide-y divide-slate-100">
                    <div className="grid grid-cols-[minmax(480px,1fr)_140px_140px_150px] gap-3 bg-slate-50 px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                      <span>Detalle del gasto y pagos</span><span className="text-center">Facturas</span><span className="text-center">Otros comprobantes</span><span className="text-center">Comprobantes de pago</span>
                    </div>
                    {detail.lines.map((line: any) => (
                      <div key={line.id} className="grid grid-cols-[minmax(480px,1fr)_140px_140px_150px] items-start gap-3 px-4 py-3">
                        <div>
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900">{line.projectName} / {line.area}</div>
                            <div className="text-[10px] text-slate-500">{line.description}</div>
                            <div className="text-[9px] uppercase tracking-widest text-slate-300 font-bold mt-1">{line.source}{line.paymentDate ? ` / pago ${formatDate(line.paymentDate)}` : ''}</div>
                          </div>
                          <div className="flex gap-4 text-right font-mono text-xs">
                            <span className="text-slate-500">${line.total.toLocaleString()}</span>
                            <span className="text-emerald-600">${line.paid.toLocaleString()}</span>
                            <span className={line.debt > 0 ? 'text-rose-600 font-black' : 'text-emerald-600 font-black'}>${line.debt.toLocaleString()}</span>
                          </div>
                        </div>
                        {line.payments.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {line.payments.map((payment: any) => (
                              <div key={payment.id} className="text-[9px] font-bold uppercase tracking-widest text-slate-300">
                                Pago ${payment.amount.toLocaleString()}
                                {payment.date ? ` / ${formatDate(payment.date)}` : ''}
                                {' / '}
                                {payment.loadedBy ? `cargado por ${payment.loadedBy}` : 'cargado por usuario no registrado'}
                                {payment.detail ? ` / ${payment.detail}` : ''}
                              </div>
                            ))}
                          </div>
                        )}
                        </div>
                        <ProviderDocumentLinks documents={line.invoiceDocuments} kind="invoice" />
                        <ProviderDocumentLinks documents={line.otherReceiptDocuments} kind="other" />
                        <ProviderDocumentLinks documents={line.paymentReceiptDocuments} kind="payment" />
                      </div>
                    ))}
                  </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
