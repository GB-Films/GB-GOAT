import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, UserRound, Building2, AlertTriangle } from 'lucide-react';
import { db } from '../lib/firebase';
import {
  COMPANY_PROVIDER_CATEGORIES,
  PRODUCTION_AREA_CATEGORIES,
  normalizeDigits,
} from '../lib/providerConstants';

type ProviderType = 'persona' | 'empresa';
type DuplicateState = { dni?: boolean; cuit?: boolean };

const emptyForm = {
  type: '' as ProviderType | '',
  name: '',
  lastName: '',
  businessName: '',
  dni: '',
  cuit: '',
  email: '',
  phone: '',
  address: '',
  birthDate: '',
  category: '',
  categoryOther: '',
  bankAccount_cbu: '',
  dietaryRestriction: '',
};

const inputClass = 'w-full px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-black transition-all disabled:bg-slate-50 disabled:text-slate-400';
const labelClass = 'block text-[10px] font-bold uppercase text-slate-500 mb-2 tracking-widest';

const formatDate = (dateValue: string) => {
  if (!dateValue) return 'dd/mm/aaaa';
  const [year, month, day] = dateValue.split('-');
  return year && month && day ? `${day}/${month}/${year}` : dateValue;
};

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateKey = (value?: string) => {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getInviteDate = (dateValue: any) => {
  if (!dateValue) return null;
  if (typeof dateValue.toDate === 'function') return dateValue.toDate();
  if (dateValue.seconds) return new Date(dateValue.seconds * 1000);
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isInviteExpired = (inviteData: any) => {
  const expiresAt = getInviteDate(inviteData?.expiresAt);
  return Boolean(expiresAt && expiresAt.getTime() < Date.now());
};

function InlineDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [anchorDate, setAnchorDate] = useState(() => parseDateKey(value) || new Date(1990, 0, 1));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const todayKey = toDateKey(new Date());
  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const firstDayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - firstDayOffset);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current
        && !popoverRef.current.contains(event.target as Node)
        && buttonRef.current
        && !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const popoverWidth = 292;
    setPosition({
      top: rect.bottom + 8,
      left: Math.min(Math.max(12, rect.left), window.innerWidth - popoverWidth - 12),
    });
  }, [isOpen]);

  const moveMonth = (offset: number) => {
    setAnchorDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  return (
    <div>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setAnchorDate(parseDateKey(value) || new Date(1990, 0, 1));
          setIsOpen((current) => !current);
        }}
        className={`${inputClass} text-center font-bold text-slate-800`}
      >
        {formatDate(value)}
      </button>
      {isOpen && (
        <div ref={popoverRef} style={{ top: position.top, left: position.left }} className="fixed z-[500] w-[292px] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button type="button" onClick={() => moveMonth(-1)} className="px-2 py-1 rounded border border-slate-100 text-[10px] font-black text-slate-500 hover:border-black">Ant.</button>
            <div className="text-[11px] font-black uppercase tracking-widest text-slate-800">{anchorDate.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</div>
            <button type="button" onClick={() => moveMonth(1)} className="px-2 py-1 rounded border border-slate-100 text-[10px] font-black text-slate-500 hover:border-black">Sig.</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, index) => (
              <div key={`${day}-${index}`} className="py-1 text-[9px] font-black uppercase tracking-widest text-slate-300">{day}</div>
            ))}
            {days.map((date) => {
              const key = toDateKey(date);
              const isCurrentMonth = date.getMonth() === anchorDate.getMonth();
              const isSelected = key === value;
              const isToday = key === todayKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onChange(key);
                    setIsOpen(false);
                  }}
                  className={`relative h-8 rounded border text-[10px] font-black transition-all ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900'
                      : isToday
                        ? 'border-blue-300 text-blue-700 bg-blue-50'
                        : isCurrentMonth
                          ? 'bg-white text-slate-700 border-slate-100 hover:border-black'
                          : 'bg-slate-50 text-slate-300 border-slate-50'
                  }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          {value && (
            <div className="mt-3 border-t border-slate-100 pt-3 text-right">
              <button type="button" onClick={() => { onChange(''); setIsOpen(false); }} className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500">Limpiar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RequiredMark() {
  return <span className="text-red-500 ml-1">*</span>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}{required && <RequiredMark />}</label>
      {children}
    </div>
  );
}

export default function ProviderInvite() {
  const { token = '' } = useParams();
  const [invite, setInvite] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateState>({});
  const [form, setForm] = useState(emptyForm);

  const dniNormalized = useMemo(() => normalizeDigits(form.dni), [form.dni]);
  const cuitNormalized = useMemo(() => normalizeDigits(form.cuit), [form.cuit]);
  const categories = form.type === 'empresa' ? COMPANY_PROVIDER_CATEGORIES : PRODUCTION_AREA_CATEGORIES;

  useEffect(() => {
    const loadInvite = async () => {
      try {
        const inviteRef = doc(db, 'providerInvites', token);
        const snap = await getDoc(inviteRef);
        if (!snap.exists()) {
          setError('Este link de alta no existe o fue eliminado.');
          return;
        }
        const data = snap.data();
        if (data.used || data.status === 'used') {
          setError('Este link ya fue utilizado. Pedí un nuevo link a Gran Berta Films.');
          return;
        }
        if (data.status === 'cancelled') {
          setError('Este link fue cancelado. Pedí un nuevo link a Gran Berta Films.');
          return;
        }
        if (isInviteExpired(data)) {
          setError('Este link vencio. Pedi un nuevo link a Gran Berta Films.');
          return;
        }
        setInvite({ id: snap.id, ...data });
      } catch (err) {
        console.error('Error loading provider invite:', err);
        setError('No se pudo validar el link. Revisá tu conexión e intentá de nuevo.');
      } finally {
        setLoading(false);
      }
    };

    if (token) loadInvite();
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    const checkDuplicates = async () => {
      const checks: Promise<void>[] = [];
      const next: DuplicateState = {};

      if (form.type === 'persona' && dniNormalized.length >= 7) {
        checks.push(getDoc(doc(db, 'providerIdentifiers', `dni_${dniNormalized}`)).then((snap) => {
          next.dni = snap.exists();
        }));
      }

      if (cuitNormalized.length >= 10) {
        checks.push(getDoc(doc(db, 'providerIdentifiers', `cuit_${cuitNormalized}`)).then((snap) => {
          next.cuit = snap.exists();
        }));
      }

      if (checks.length === 0) {
        setDuplicates({});
        return;
      }

      setCheckingDuplicates(true);
      try {
        await Promise.all(checks);
        if (!cancelled) setDuplicates(next);
      } catch (err) {
        console.error('Error checking provider duplicates:', err);
      } finally {
        if (!cancelled) setCheckingDuplicates(false);
      }
    };

    const timer = window.setTimeout(checkDuplicates, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [form.type, dniNormalized, cuitNormalized]);

  const updateField = (field: keyof typeof emptyForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
  };

  const selectType = (type: ProviderType) => {
    setForm({ ...emptyForm, type });
    setDuplicates({});
    setError('');
  };

  const validateForm = () => {
    if (!form.type) return 'Elegí si el alta corresponde a Persona física o Empresa.';
    if (!form.category) return 'Seleccioná una categoría.';
    if (form.category === 'Otra' && !form.categoryOther.trim()) return 'Completá el comentario de la categoría Otra.';
    if (!form.email.trim()) return 'Completá el email.';
    if (!form.phone.trim()) return 'Completá el teléfono.';
    if (!form.address.trim()) return 'Completá la dirección.';
    if (!form.bankAccount_cbu.trim()) return 'Completá el CBU o alias.';
    if (!cuitNormalized || cuitNormalized.length < 10) return 'Completá un CUIT/CUIL válido.';
    if (duplicates.cuit) return 'Ya existe un proveedor registrado con este CUIT/CUIL.';

    if (form.type === 'persona') {
      if (!form.name.trim()) return 'Completá el nombre.';
      if (!form.lastName.trim()) return 'Completá el apellido.';
      if (!dniNormalized || dniNormalized.length < 7) return 'Completá un DNI válido.';
      if (duplicates.dni) return 'Ya existe una persona registrada con este DNI.';
    }

    if (form.type === 'empresa') {
      if (!form.businessName.trim()) return 'Completá la razón social.';
    }

    return '';
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitLoading(true);
    setError('');

    try {
      await runTransaction(db, async (transaction) => {
        const inviteRef = doc(db, 'providerInvites', token);
        const inviteSnap = await transaction.get(inviteRef);
        if (!inviteSnap.exists()) throw new Error('INVITE_NOT_FOUND');

        const inviteData = inviteSnap.data();
        if (inviteData.used || inviteData.status === 'used') throw new Error('INVITE_USED');
        if (inviteData.status === 'cancelled') throw new Error('INVITE_CANCELLED');
        if (isInviteExpired(inviteData)) throw new Error('INVITE_EXPIRED');

        const identifierRefs = [] as Array<{ ref: ReturnType<typeof doc>; kind: 'dni' | 'cuit'; value: string }>;
        if (form.type === 'persona') {
          identifierRefs.push({ ref: doc(db, 'providerIdentifiers', `dni_${dniNormalized}`), kind: 'dni', value: dniNormalized });
        }
        identifierRefs.push({ ref: doc(db, 'providerIdentifiers', `cuit_${cuitNormalized}`), kind: 'cuit', value: cuitNormalized });

        for (const item of identifierRefs) {
          const snap = await transaction.get(item.ref);
          if (snap.exists()) throw new Error(item.kind === 'dni' ? 'DNI_EXISTS' : 'CUIT_EXISTS');
        }

        const providerRef = doc(collection(db, 'providers'));
        const commonData = {
          type: form.type,
          cuit: form.cuit.trim(),
          cuitNormalized,
          email: form.email.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          category: form.category,
          categoryOther: form.category === 'Otra' ? form.categoryOther.trim() : '',
          bankAccount_cbu: form.bankAccount_cbu.trim(),
          source: 'provider_invite',
          inviteToken: token,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        const providerData = form.type === 'persona'
          ? {
              ...commonData,
              name: form.name.trim(),
              lastName: form.lastName.trim(),
              fullName: `${form.name.trim()} ${form.lastName.trim()}`.trim(),
              dni: form.dni.trim(),
              dniNormalized,
              birthDate: form.birthDate || '',
              dietaryRestriction: form.dietaryRestriction.trim(),
            }
          : {
              ...commonData,
              name: form.businessName.trim(),
              lastName: '',
              businessName: form.businessName.trim(),
            };

        const targetCollectionName = inviteData.collectionName === 'budgetItems' ? 'budgetItems' : 'areaExpenses';
        const targetExpenseRef = inviteData.projectId && inviteData.expenseId
          ? doc(db, 'projects', inviteData.projectId, targetCollectionName, inviteData.expenseId)
          : null;
        const targetExpenseSnap = targetExpenseRef ? await transaction.get(targetExpenseRef) : null;
        if (targetExpenseRef && !targetExpenseSnap?.exists()) throw new Error('TARGET_EXPENSE_NOT_FOUND');
        const targetExpenseData = targetExpenseSnap?.data();
        if (targetExpenseData && (targetExpenseData.providerId || targetExpenseData.providerName)) {
          throw new Error('TARGET_EXPENSE_ALREADY_ASSIGNED');
        }

        transaction.set(providerRef, providerData);
        for (const item of identifierRefs) {
          transaction.set(item.ref, {
            providerId: providerRef.id,
            providerType: form.type,
            inviteToken: token,
            identifierType: item.kind,
            value: item.value,
            createdAt: serverTimestamp(),
          });
        }
        if (targetExpenseRef) {
          const providerName = form.type === 'persona'
            ? `${form.name.trim()} ${form.lastName.trim()}`.trim()
            : form.businessName.trim();
          transaction.update(targetExpenseRef, {
            providerId: providerRef.id,
            providerName,
            providerInviteAssignment: {
              token,
              providerId: providerRef.id,
              assignedAt: serverTimestamp(),
            },
            updatedAt: serverTimestamp(),
          });
        }
        transaction.update(inviteRef, {
          used: true,
          status: 'used',
          usedAt: serverTimestamp(),
          providerId: providerRef.id,
          providerType: form.type,
        });
      });

      setSubmitted(true);
    } catch (err: any) {
      console.error('Error submitting provider invite:', err);
      const messageByCode: Record<string, string> = {
        INVITE_NOT_FOUND: 'Este link de alta no existe o fue eliminado.',
        INVITE_USED: 'Este link ya fue utilizado. Pedí un nuevo link a Gran Berta Films.',
        INVITE_CANCELLED: 'Este link fue cancelado. Pedí un nuevo link a Gran Berta Films.',
        INVITE_EXPIRED: 'Este link vencio. Pedi un nuevo link a Gran Berta Films.',
        TARGET_EXPENSE_NOT_FOUND: 'El gasto asociado a este link ya no existe. Pedi un nuevo link.',
        TARGET_EXPENSE_ALREADY_ASSIGNED: 'Este gasto ya tiene un proveedor asignado. Pedi un nuevo link si corresponde.',
        DNI_EXISTS: 'Ya existe una persona registrada con este DNI.',
        CUIT_EXISTS: 'Ya existe un proveedor registrado con este CUIT/CUIL.',
      };
      setError(messageByCode[err?.message] || 'No se pudo enviar el alta. Revisá los datos e intentá de nuevo.');
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Validando link
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-10 max-w-lg text-center shadow-sm">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-5" />
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400 mb-3">Gran Berta Films</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">Alta recibida correctamente</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Tu información fue enviada. Este link ya no podrá volver a usarse.
          </p>
        </div>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-red-100 rounded-2xl p-10 max-w-lg text-center shadow-sm">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-5" />
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400 mb-3">Gran Berta Films</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">Link no disponible</h1>
          <p className="text-sm text-red-500 leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.35em] text-slate-400 mb-3">Gran Berta Films</div>
          <h1 className="text-3xl font-bold text-slate-950">Alta como proveedor</h1>
          <p className="text-sm text-slate-500 mt-3 max-w-xl mx-auto">
            Completá tus datos para quedar registrado/a en la base de proveedores. Los campos con asterisco son obligatorios.
          </p>
        </header>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 md:p-8 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
            <button
              type="button"
              onClick={() => selectType('persona')}
              className={`p-5 rounded-xl border text-left transition-all ${form.type === 'persona' ? 'border-black bg-slate-950 text-white' : 'border-slate-200 hover:border-slate-400'}`}
            >
              <UserRound className="w-5 h-5 mb-3" />
              <div className="text-sm font-bold uppercase tracking-widest">Persona física</div>
              <p className={`text-xs mt-2 ${form.type === 'persona' ? 'text-slate-300' : 'text-slate-400'}`}>Freelance, actor/actriz, técnico/a o proveedor individual.</p>
            </button>
            <button
              type="button"
              onClick={() => selectType('empresa')}
              className={`p-5 rounded-xl border text-left transition-all ${form.type === 'empresa' ? 'border-black bg-slate-950 text-white' : 'border-slate-200 hover:border-slate-400'}`}
            >
              <Building2 className="w-5 h-5 mb-3" />
              <div className="text-sm font-bold uppercase tracking-widest">Empresa</div>
              <p className={`text-xs mt-2 ${form.type === 'empresa' ? 'text-slate-300' : 'text-slate-400'}`}>Sociedad, rental, estudio, locación, servicio o proveedor comercial.</p>
            </button>
          </div>

          {form.type && (
            <form onSubmit={handleSubmit} className="space-y-6">
              {form.type === 'persona' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Nombre" required>
                    <input value={form.name} onChange={(e) => updateField('name', e.target.value)} required className={inputClass} />
                  </Field>
                  <Field label="Apellido" required>
                    <input value={form.lastName} onChange={(e) => updateField('lastName', e.target.value)} required className={inputClass} />
                  </Field>
                  <Field label="DNI" required>
                    <input value={form.dni} onChange={(e) => updateField('dni', e.target.value)} required className={`${inputClass} ${duplicates.dni ? 'border-red-400 bg-red-50' : ''}`} />
                    {duplicates.dni && <p className="text-xs text-red-500 mt-2 font-bold">Ya existe una persona registrada con este DNI.</p>}
                  </Field>
                  <Field label="CUIT / CUIL" required>
                    <input value={form.cuit} onChange={(e) => updateField('cuit', e.target.value)} required className={`${inputClass} ${duplicates.cuit ? 'border-red-400 bg-red-50' : ''}`} />
                    {duplicates.cuit && <p className="text-xs text-red-500 mt-2 font-bold">Ya existe un proveedor registrado con este CUIT/CUIL.</p>}
                  </Field>
                  <Field label="Fecha de nacimiento">
                    <InlineDatePicker value={form.birthDate} onChange={(value) => updateField('birthDate', value)} />
                  </Field>
                  <Field label="Restricción alimentaria">
                    <input value={form.dietaryRestriction} onChange={(e) => updateField('dietaryRestriction', e.target.value)} className={inputClass} placeholder="Ej: celiaquía, vegetariano/a, ninguna..." />
                  </Field>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Field label="Razón social" required>
                      <input value={form.businessName} onChange={(e) => updateField('businessName', e.target.value)} required className={inputClass} />
                    </Field>
                  </div>
                  <Field label="CUIT" required>
                    <input value={form.cuit} onChange={(e) => updateField('cuit', e.target.value)} required className={`${inputClass} ${duplicates.cuit ? 'border-red-400 bg-red-50' : ''}`} />
                    {duplicates.cuit && <p className="text-xs text-red-500 mt-2 font-bold">Ya existe una empresa/proveedor registrado con este CUIT.</p>}
                  </Field>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Email" required>
                  <input type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} required className={inputClass} />
                </Field>
                <Field label="Teléfono" required>
                  <input value={form.phone} onChange={(e) => updateField('phone', e.target.value)} required className={inputClass} />
                </Field>
              </div>

              <Field label="Domicilio" required>
                <input value={form.address} onChange={(e) => updateField('address', e.target.value)} required className={inputClass} />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Categoría" required>
                  <select value={form.category} onChange={(e) => updateField('category', e.target.value)} required className={inputClass}>
                    <option value="">Seleccionar...</option>
                    {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </Field>
                {form.category === 'Otra' && (
                  <Field label="Comentario categoría" required>
                    <input value={form.categoryOther} onChange={(e) => updateField('categoryOther', e.target.value)} required className={inputClass} placeholder="Indicar rubro/categoría..." />
                  </Field>
                )}
              </div>

              <Field label="CBU / Alias" required>
                <input value={form.bankAccount_cbu} onChange={(e) => updateField('bankAccount_cbu', e.target.value)} required className={`${inputClass} font-mono`} />
              </Field>

              {checkingDuplicates && <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Revisando duplicados...</p>}
              {error && <div className="p-4 rounded-lg bg-red-50 border border-red-100 text-sm font-bold text-red-600">{error}</div>}

              <button
                type="submit"
                disabled={submitLoading || checkingDuplicates || duplicates.dni || duplicates.cuit}
                className="w-full px-5 py-4 rounded-xl bg-black text-white text-xs font-bold uppercase tracking-widest disabled:bg-slate-300 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
              >
                {submitLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Enviar alta de proveedor
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-6">
          Este link es personal y de un solo uso. No lo compartas con terceros.
        </p>
      </div>
    </div>
  );
}
