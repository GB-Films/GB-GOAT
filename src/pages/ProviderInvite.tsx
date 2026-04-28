import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ExternalLink, Loader2, MapPin, UserRound, Building2, AlertTriangle } from 'lucide-react';
import { db } from '../lib/firebase';
import {
  COMPANY_PROVIDER_CATEGORIES,
  PRODUCTION_AREA_CATEGORIES,
  TAX_CONDITIONS,
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
  accountHolder: '',
  dietaryRestriction: '',
  taxCondition: '',
  taxConditionOther: '',
  contactName: '',
  contactRole: '',
  contactEmail: '',
  contactPhone: '',
  notes: '',
};

const inputClass = 'w-full px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-black transition-all disabled:bg-slate-50 disabled:text-slate-400';
const labelClass = 'block text-[10px] font-bold uppercase text-slate-500 mb-2 tracking-widest';

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

function buildMapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
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
    if (!form.accountHolder.trim()) return 'Completá el titular de la cuenta.';
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
      if (!form.taxCondition) return 'Seleccioná la condición frente al IVA.';
      if (form.taxCondition === 'Otra' && !form.taxConditionOther.trim()) return 'Completá la condición frente al IVA.';
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
          accountHolder: form.accountHolder.trim(),
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
              notes: form.notes.trim(),
            }
          : {
              ...commonData,
              name: form.businessName.trim(),
              lastName: '',
              businessName: form.businessName.trim(),
              taxCondition: form.taxCondition,
              taxConditionOther: form.taxCondition === 'Otra' ? form.taxConditionOther.trim() : '',
              contact: {
                name: form.contactName.trim(),
                role: form.contactRole.trim(),
                email: form.contactEmail.trim(),
                phone: form.contactPhone.trim(),
              },
              notes: form.notes.trim(),
            };

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
                    <input type="date" value={form.birthDate} onChange={(e) => updateField('birthDate', e.target.value)} className={inputClass} />
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
                  <Field label="Condición frente al IVA" required>
                    <select value={form.taxCondition} onChange={(e) => updateField('taxCondition', e.target.value)} required className={inputClass}>
                      <option value="">Seleccionar...</option>
                      {TAX_CONDITIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </Field>
                  {form.taxCondition === 'Otra' && (
                    <div className="md:col-span-2">
                      <Field label="Detalle condición IVA" required>
                        <input value={form.taxConditionOther} onChange={(e) => updateField('taxConditionOther', e.target.value)} required className={inputClass} />
                      </Field>
                    </div>
                  )}
                  <Field label="Nombre de contacto">
                    <input value={form.contactName} onChange={(e) => updateField('contactName', e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Cargo del contacto">
                    <input value={form.contactRole} onChange={(e) => updateField('contactRole', e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Email de contacto">
                    <input type="email" value={form.contactEmail} onChange={(e) => updateField('contactEmail', e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Teléfono de contacto">
                    <input value={form.contactPhone} onChange={(e) => updateField('contactPhone', e.target.value)} className={inputClass} />
                  </Field>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={form.type === 'empresa' ? 'Email administrativo' : 'Email'} required>
                  <input type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} required className={inputClass} />
                </Field>
                <Field label="Teléfono" required>
                  <input value={form.phone} onChange={(e) => updateField('phone', e.target.value)} required className={inputClass} />
                </Field>
              </div>

              <Field label={form.type === 'empresa' ? 'Dirección fiscal / comercial' : 'Dirección'} required>
                <div className="flex flex-col md:flex-row gap-2">
                  <input value={form.address} onChange={(e) => updateField('address', e.target.value)} required className={inputClass} placeholder="Calle, altura, localidad, provincia..." />
                  <a
                    href={form.address.trim() ? buildMapsUrl(form.address) : undefined}
                    target="_blank"
                    rel="noreferrer"
                    className={`px-4 py-3 rounded-lg border text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 whitespace-nowrap ${form.address.trim() ? 'border-slate-300 hover:border-black text-slate-700' : 'border-slate-100 text-slate-300 pointer-events-none'}`}
                  >
                    <MapPin className="w-3.5 h-3.5" /> Validar Maps
                  </a>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Usá el botón para abrir la búsqueda en Google Maps y confirmar que la dirección esté bien escrita.</p>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="CBU o alias" required>
                  <input value={form.bankAccount_cbu} onChange={(e) => updateField('bankAccount_cbu', e.target.value)} required className={inputClass} />
                </Field>
                <Field label="Titular de la cuenta" required>
                  <input value={form.accountHolder} onChange={(e) => updateField('accountHolder', e.target.value)} required className={inputClass} />
                </Field>
              </div>

              <Field label="Notas / aclaraciones">
                <textarea value={form.notes} onChange={(e) => updateField('notes', e.target.value)} rows={3} className={`${inputClass} resize-none`} />
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
