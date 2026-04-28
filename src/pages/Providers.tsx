import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  query,
  getDocs,
  addDoc,
  serverTimestamp,
  orderBy,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError } from '../lib/firestoreUtils';
import { useAuth } from '../context/AuthContext';
import { Plus, Search, Truck, X, Upload, Download, Pencil, Trash2, Link2, Copy, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import {
  PRODUCTION_AREA_CATEGORIES,
  COMPANY_PROVIDER_CATEGORIES,
  normalizeDigits,
  formatIdentifier,
  providerDisplayName,
  providerSearchText,
  inferLegacyIdentifiers,
} from '../lib/providerConstants';

const inputClass = 'w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all';
const labelClass = 'block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest';

const formatDate = (dateValue: any) => {
  if (!dateValue) return '-';
  if (typeof dateValue === 'string') {
    const parts = dateValue.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${day}/${month}/${year}`;
    }
    return dateValue;
  }

  try {
    const date = dateValue.seconds ? new Date(dateValue.seconds * 1000) : new Date(dateValue);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
  } catch (e) {
    console.error('Error formatting date:', e);
  }

  return String(dateValue);
};

const generateInviteToken = () => {
  const bytes = new Uint8Array(20);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const getPublicInviteLink = (token: string) => {
  const baseUrl = ((import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || '/');
  return `${window.location.origin}${baseUrl}#/alta-proveedor/${token}`;
};

const buildProviderIdentifiers = (provider: any) => {
  const { dniNormalized, cuitNormalized } = inferLegacyIdentifiers(provider);
  const identifiers: Array<{ id: string; type: 'dni' | 'cuit'; value: string }> = [];

  if (dniNormalized) identifiers.push({ id: `dni_${dniNormalized}`, type: 'dni', value: dniNormalized });
  if (cuitNormalized) identifiers.push({ id: `cuit_${cuitNormalized}`, type: 'cuit', value: cuitNormalized });

  return identifiers;
};

export default function Providers() {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<any | null>(null);
  const [generatedInviteLink, setGeneratedInviteLink] = useState('');
  const [copiedInviteLink, setCopiedInviteLink] = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const { profile } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredProviders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return providers;
    return providers.filter((provider) => providerSearchText(provider).includes(term));
  }, [providers, searchTerm]);

  const syncProviderIdentifiers = async (items: any[]) => {
    const providersWithIdentifiers = items.filter((provider) => buildProviderIdentifiers(provider).length > 0);
    if (providersWithIdentifiers.length === 0) return;

    try {
      let batch = writeBatch(db);
      let operationCount = 0;

      for (const provider of providersWithIdentifiers) {
        const identifiers = buildProviderIdentifiers(provider);
        for (const identifier of identifiers) {
          batch.set(doc(db, 'providerIdentifiers', identifier.id), {
            providerId: provider.id,
            providerType: provider.type || 'legacy',
            identifierType: identifier.type,
            value: identifier.value,
            updatedAt: serverTimestamp(),
          }, { merge: true });
          operationCount += 1;

          if (operationCount >= 450) {
            await batch.commit();
            batch = writeBatch(db);
            operationCount = 0;
          }
        }
      }

      if (operationCount > 0) await batch.commit();
    } catch (error) {
      console.error('Error syncing provider identifiers:', error);
    }
  };

  useEffect(() => {
    if (!profile) return;
    const fetchProviders = async () => {
      try {
        const q = query(collection(db, 'providers'), orderBy('updatedAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const items = querySnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        setProviders(items);
        if (profile?.role === 'admin') void syncProviderIdentifiers(items);
      } catch (error: any) {
        console.error('Error fetching providers:', error);
        if (error.message?.includes('insufficient permissions')) {
          handleFirestoreError(error, 'list', 'providers');
        }
      } finally {
        setLoading(false);
      }
    };
    fetchProviders();
  }, [profile]);

  const downloadTemplate = () => {
    const templateData = [
      {
        Tipo: 'persona',
        Nombre: 'Juan',
        Apellido: 'Pérez',
        DNI: '12345678',
        CUIT: '20-12345678-9',
        Domicilio: 'Calle Falsa 123',
        'Fecha Nacimiento': '1990-01-01',
        Email: 'juan@email.com',
        Telefono: '11 1234-5678',
        'CBU o Cuenta': '0000000000000000000000',
        Categoria: 'Cámara',
        'Restriccion Alimentaria': 'Vegetariano',
      },
      {
        Tipo: 'empresa',
        'Razon Social': 'Rental Ejemplo SRL',
        CUIT: '30-71234567-8',
        Domicilio: 'Avenida Siempre Viva 742',
        Email: 'admin@rental.com',
        Telefono: '11 8765-4321',
        'CBU o Cuenta': '1111111111111111111111',
        Categoria: 'Rental de cámara',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla Proveedores');
    XLSX.writeFile(workbook, 'plantilla_proveedores_gb_goat.xlsx');
  };

  const createProviderIdentifierDocs = async (providerId: string, providerData: any) => {
    const identifiers = buildProviderIdentifiers({ id: providerId, ...providerData });
    await Promise.all(identifiers.map((identifier) => setDoc(doc(db, 'providerIdentifiers', identifier.id), {
      providerId,
      providerType: providerData.type || 'manual',
      identifierType: identifier.type,
      value: identifier.value,
      createdAt: serverTimestamp(),
    }, { merge: true })));
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const data = e.target?.result;
      let jsonData: any[] = [];

      try {
        if (file.name.endsWith('.csv')) {
          const results = Papa.parse(data as string, { header: true, skipEmptyLines: true });
          jsonData = results.data;
        } else {
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          jsonData = XLSX.utils.sheet_to_json(worksheet);
        }

        if (jsonData.length === 0) {
          alert('El archivo parece estar vacío.');
          return;
        }

        const newProviders: any[] = [];
        for (const row of jsonData) {
          const type = String(row.Tipo || row.tipo || '').toLowerCase() === 'empresa' ? 'empresa' : 'persona';
          const dni = String(row.DNI || row.dni || '');
          const cuit = String(row.CUIT || row.Cuit || row.cuit || row['DNI o CUIT'] || '');
          const category = row.Categoria || row.CATEGORÍA || row.Category || '';
          const providerData = type === 'empresa'
            ? {
                type,
                name: row['Razon Social'] || row['Razón Social'] || row.RazonSocial || row.Nombre || '',
                businessName: row['Razon Social'] || row['Razón Social'] || row.RazonSocial || row.Nombre || '',
                lastName: '',
                cuit,
                cuitNormalized: normalizeDigits(cuit),
                email: row.Email || row.EMAIL || '',
                phone: row.Telefono || row.Teléfono || row.TELEFONO || '',
                address: row.Domicilio || row.DOMICILIO || '',
                bankAccount_cbu: String(row['CBU o Cuenta'] || row.CBU || row.Cuenta || ''),
                category,
                createdBy: profile?.uid,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              }
            : {
                type,
                name: row.Nombre || row.NOMBRE || '',
                lastName: row.Apellido || row.APELLIDO || '',
                dni,
                dniNormalized: normalizeDigits(dni),
                cuit,
                cuitNormalized: normalizeDigits(cuit),
                dni_cuit: String(row['DNI o CUIT'] || row.DNI || row.CUIT || ''),
                email: row.Email || row.EMAIL || '',
                phone: row.Telefono || row.Teléfono || row.TELEFONO || '',
                address: row.Domicilio || row.DOMICILIO || '',
                birthDate: row['Fecha Nacimiento'] || '',
                bankAccount_cbu: String(row['CBU o Cuenta'] || row.CBU || row.Cuenta || ''),
                category,
                dietaryRestriction: row['Restriccion Alimentaria'] || row['Restricción Alimentaria'] || '',
                createdBy: profile?.uid,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              };

          const docRef = await addDoc(collection(db, 'providers'), providerData);
          await createProviderIdentifierDocs(docRef.id, providerData);
          newProviders.push({ id: docRef.id, ...providerData, createdAt: new Date() });
        }

        setProviders([...newProviders, ...providers]);
        alert(`${newProviders.length} proveedores importados correctamente.`);
      } catch (error) {
        console.error('Error importing providers:', error);
        alert('Hubo un error al procesar el archivo.');
      }
    };

    if (file.name.endsWith('.csv')) reader.readAsText(file);
    else reader.readAsBinaryString(file);
  };

  const handleGenerateProviderInvite = async () => {
    setGeneratingInvite(true);
    setGeneratedInviteLink('');
    setCopiedInviteLink(false);

    try {
      const token = generateInviteToken();
      await setDoc(doc(db, 'providerInvites', token), {
        token,
        status: 'pending',
        used: false,
        createdBy: profile?.uid,
        createdByEmail: profile?.email,
        createdAt: serverTimestamp(),
      });

      const link = getPublicInviteLink(token);
      setGeneratedInviteLink(link);
      try {
        await navigator.clipboard.writeText(link);
        setCopiedInviteLink(true);
      } catch (clipboardError) {
        console.warn('No se pudo copiar automáticamente el link:', clipboardError);
      }
    } catch (error) {
      console.error('Error generating provider invite:', error);
      alert('No se pudo generar el link de alta.');
    } finally {
      setGeneratingInvite(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!generatedInviteLink) return;
    await navigator.clipboard.writeText(generatedInviteLink);
    setCopiedInviteLink(true);
    window.setTimeout(() => setCopiedInviteLink(false), 2500);
  };

  const handleCreateProvider = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const type = String(formData.get('type') || 'persona') as 'persona' | 'empresa';
    const category = String(formData.get('category') || '');
    const categoryOther = String(formData.get('categoryOther') || '');
    const cuit = String(formData.get('cuit') || '');

    const data: any = type === 'empresa'
      ? {
          type,
          name: formData.get('businessName'),
          businessName: formData.get('businessName'),
          lastName: '',
          cuit,
          cuitNormalized: normalizeDigits(cuit),
          email: formData.get('email'),
          phone: formData.get('phone'),
          address: formData.get('address'),
          bankAccount_cbu: formData.get('bankAccount_cbu'),
          category,
          categoryOther: category === 'Otra' ? categoryOther : '',
          createdBy: profile?.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      : {
          type,
          name: formData.get('name'),
          lastName: formData.get('lastName'),
          fullName: `${formData.get('name') || ''} ${formData.get('lastName') || ''}`.trim(),
          dni: formData.get('dni'),
          dniNormalized: normalizeDigits(formData.get('dni')),
          cuit,
          cuitNormalized: normalizeDigits(cuit),
          address: formData.get('address'),
          birthDate: formData.get('birthDate'),
          bankAccount_cbu: formData.get('bankAccount_cbu'),
          category,
          categoryOther: category === 'Otra' ? categoryOther : '',
          dietaryRestriction: formData.get('dietaryRestriction'),
          email: formData.get('email'),
          phone: formData.get('phone'),
          createdBy: profile?.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

    try {
      const docRef = await addDoc(collection(db, 'providers'), data);
      await createProviderIdentifierDocs(docRef.id, data);
      setProviders([{ id: docRef.id, ...data, createdAt: new Date() }, ...providers]);
      setShowNewModal(false);
    } catch (error) {
      console.error('Error adding provider:', error);
    }
  };

  const handleUpdateProvider = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingProvider) return;

    const formData = new FormData(e.currentTarget);
    const providerType = editingProvider?.type === 'empresa' ? 'empresa' : 'persona';
    const name = String(formData.get('name') || '').trim();
    const lastName = String(formData.get('lastName') || '').trim();
    const dni = String(formData.get('dni') || '').trim();
    const cuit = String(formData.get('cuit') || '').trim();
    const category = String(formData.get('category') || '').trim();

    const data: any = {
      type: providerType,
      name,
      businessName: providerType === 'empresa' ? name : editingProvider?.businessName || '',
      lastName: providerType === 'empresa' ? '' : lastName,
      fullName: providerType === 'persona' ? `${name} ${lastName}`.trim() : name,
      dni: providerType === 'persona' ? dni : '',
      dniNormalized: providerType === 'persona' ? normalizeDigits(dni) : '',
      cuit,
      cuitNormalized: normalizeDigits(cuit),
      dni_cuit: formData.get('dni_cuit') || '',
      address: String(formData.get('address') || '').trim(),
      birthDate: providerType === 'persona' ? formData.get('birthDate') || '' : '',
      bankAccount_cbu: String(formData.get('bankAccount_cbu') || '').trim(),
      category,
      categoryOther: category === 'Otra' ? String(formData.get('categoryOther') || '').trim() : '',
      dietaryRestriction: providerType === 'persona' ? String(formData.get('dietaryRestriction') || '').trim() : '',
      email: String(formData.get('email') || '').trim(),
      phone: String(formData.get('phone') || '').trim(),
      updatedAt: serverTimestamp(),
    };

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'providers', editingProvider.id), data);

      for (const identifier of buildProviderIdentifiers(editingProvider)) {
        batch.delete(doc(db, 'providerIdentifiers', identifier.id));
      }

      for (const identifier of buildProviderIdentifiers({ id: editingProvider.id, ...data })) {
        batch.set(doc(db, 'providerIdentifiers', identifier.id), {
          providerId: editingProvider.id,
          providerType,
          identifierType: identifier.type,
          value: identifier.value,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      await batch.commit();
      setProviders(providers.map((provider) => provider.id === editingProvider.id ? { ...provider, ...data, updatedAt: new Date() } : provider));
      setEditingProvider(null);
    } catch (error: any) {
      console.error('Error updating provider:', error);
      if (error.message?.includes('insufficient permissions')) {
        handleFirestoreError(error, 'update', `providers/${editingProvider.id}`);
      } else {
        alert('No se pudo actualizar el proveedor.');
      }
    }
  };

  const handleDeleteProvider = async (provider: any) => {
    if (!confirm('¿Estás seguro de que deseas eliminar este proveedor?')) return;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'providers', provider.id));
      for (const identifier of buildProviderIdentifiers(provider)) {
        batch.delete(doc(db, 'providerIdentifiers', identifier.id));
      }
      await batch.commit();
      setProviders(providers.filter((item) => item.id !== provider.id));
    } catch (error) {
      console.error('Error deleting provider:', error);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col lg:flex-row lg:items-end justify-between border-b border-slate-200 pb-8 gap-4">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-widest font-bold mb-1">CineManage / Recursos</div>
          <h1 className="text-3xl font-light text-slate-900">Proveedores: <span className="font-bold text-black">Base de Contactos</span></h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={downloadTemplate} className="px-4 py-2 bg-white border border-slate-200 text-[10px] font-bold uppercase tracking-widest rounded hover:bg-slate-50 transition-colors flex items-center gap-2">
            <Download className="w-3 h-3" /> Plantilla
          </button>
          <label className="px-4 py-2 bg-white border border-slate-200 text-[10px] font-bold uppercase tracking-widest rounded hover:bg-slate-50 transition-colors flex items-center gap-2 cursor-pointer">
            <Upload className="w-3 h-3" /> Importar
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
          </label>
          <button onClick={handleGenerateProviderInvite} disabled={generatingInvite} className="px-4 py-2 bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest rounded hover:bg-black transition-colors flex items-center gap-2 disabled:bg-slate-300">
            <Link2 className="w-3 h-3" /> {generatingInvite ? 'Generando...' : 'Generar Link Alta'}
          </button>
          <button onClick={() => setShowNewModal(true)} className="px-4 py-2 bg-black text-white text-[10px] font-bold uppercase tracking-widest rounded hover:bg-slate-800 transition-colors flex items-center gap-2">
            <Plus className="w-3 h-3" /> Nuevo Manual
          </button>
        </div>
      </header>

      {generatedInviteLink && (
        <div className="bg-white rounded-xl border border-emerald-200 p-5 shadow-sm flex flex-col lg:flex-row gap-4 lg:items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-2 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5" /> Link de alta generado
            </div>
            <input readOnly value={generatedInviteLink} className="w-full lg:w-[720px] px-3 py-2 bg-slate-50 border border-slate-100 rounded text-xs text-slate-600" />
            <p className="text-[11px] text-slate-400 mt-2">Es genérico, de un solo uso, y la persona elegirá si corresponde a Persona física o Empresa.</p>
          </div>
          <button onClick={handleCopyInviteLink} className="px-4 py-3 border border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest hover:border-black flex items-center justify-center gap-2">
            <Copy className="w-3.5 h-3.5" /> {copiedInviteLink ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
        <input
          type="text"
          placeholder="Buscar por nombre, razón social, DNI, CUIT, email o categoría..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-slate-400 transition-all placeholder:text-slate-300"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-white border border-slate-200 rounded-lg animate-pulse" />)}
        </div>
      ) : filteredProviders.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-200">
          <Truck className="w-12 h-12 text-slate-100 mx-auto mb-4" />
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">Sin Proveedores registrados</h3>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-auto">
          <table className="w-full text-left border-collapse min-w-[1100px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Tipo</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Nombre / Razón Social</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">DNI</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">CUIT</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Categoría</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Email / Teléfono</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Domicilio</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Restricción</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProviders.map((provider) => {
                const inferred = inferLegacyIdentifiers(provider);
                return (
                  <tr key={provider.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-5 py-4 text-xs font-bold uppercase tracking-widest text-slate-400">{provider.type === 'empresa' ? 'Empresa' : 'Persona'}</td>
                    <td className="px-5 py-4">
                      <div className="text-sm font-bold text-slate-900">{providerDisplayName(provider)}</div>
                      <div className="text-[10px] text-slate-400 font-medium">{provider.source === 'provider_invite' ? 'Alta por link' : 'Carga interna'}</div>
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600 font-medium whitespace-nowrap">{formatIdentifier(provider.dni || inferred.dniNormalized) || '-'}</td>
                    <td className="px-5 py-4 text-xs text-slate-600 font-medium whitespace-nowrap">{formatIdentifier(provider.cuit || inferred.cuitNormalized) || '-'}</td>
                    <td className="px-5 py-4 text-xs text-slate-500">{provider.category === 'Otra' ? `Otra: ${provider.categoryOther || '-'}` : provider.category || 'Sin categoría'}</td>
                    <td className="px-5 py-4 text-xs text-slate-500">
                      <div>{provider.email || provider.adminEmail || '-'}</div>
                      <div className="text-slate-400">{provider.phone || '-'}</div>
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500 max-w-[220px] truncate">{provider.address || '-'}</td>
                    <td className="px-5 py-4 text-xs text-slate-500">{provider.dietaryRestriction || '-'}</td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingProvider(provider)} className="p-1 text-slate-300 hover:text-black transition-colors" title="Editar proveedor">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeleteProvider(provider)} className="p-1 text-slate-300 hover:text-red-500 transition-colors" title="Eliminar proveedor">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {showNewModal && (
          <ProviderManualModal onClose={() => setShowNewModal(false)} onSubmit={handleCreateProvider} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingProvider && (
          <ProviderEditModal provider={editingProvider} onClose={() => setEditingProvider(null)} onSubmit={handleUpdateProvider} />
        )}
      </AnimatePresence>
    </div>
  );
}

function ProviderManualModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  const [type, setType] = useState<'persona' | 'empresa'>('persona');
  const [category, setCategory] = useState('');
  const categories = type === 'empresa' ? COMPANY_PROVIDER_CATEGORIES : PRODUCTION_AREA_CATEGORIES;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-white/80 backdrop-blur-md" />
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-auto p-8 relative z-10 border border-slate-200 shadow-2xl shadow-slate-200/50">
        <div className="flex justify-between items-center mb-8 border-l-4 border-black pl-4">
          <h2 className="text-xs font-bold uppercase tracking-widest">Alta Manual de Proveedor</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-black"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setType('persona')} className={`px-4 py-3 rounded border text-xs font-bold uppercase tracking-widest ${type === 'persona' ? 'bg-black text-white border-black' : 'border-slate-200'}`}>Persona</button>
            <button type="button" onClick={() => setType('empresa')} className={`px-4 py-3 rounded border text-xs font-bold uppercase tracking-widest ${type === 'empresa' ? 'bg-black text-white border-black' : 'border-slate-200'}`}>Empresa</button>
          </div>
          <input type="hidden" name="type" value={type} />

          {type === 'persona' ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Nombre" required><input name="name" required className={inputClass} /></Field>
              <Field label="Apellido" required><input name="lastName" required className={inputClass} /></Field>
              <Field label="DNI" required><input name="dni" required className={inputClass} /></Field>
              <Field label="CUIT / CUIL" required><input name="cuit" required className={inputClass} /></Field>
              <Field label="Fecha Nacimiento"><input name="birthDate" type="date" className={inputClass} /></Field>
              <Field label="Restricción alimentaria"><input name="dietaryRestriction" className={inputClass} /></Field>
            </div>
          ) : (
            <>
              <Field label="Razón Social" required><input name="businessName" required className={inputClass} /></Field>
              <Field label="CUIT" required><input name="cuit" required className={inputClass} /></Field>
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" required><input name="email" type="email" required className={inputClass} /></Field>
            <Field label="Teléfono" required><input name="phone" required className={inputClass} /></Field>
          </div>
          <Field label="Domicilio" required><input name="address" required className={inputClass} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Categoría" required>
              <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} required className={inputClass}>
                <option value="">Seleccionar...</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            {category === 'Otra' && <Field label="Comentario Otra" required><input name="categoryOther" required className={inputClass} /></Field>}
          </div>
          <Field label="CBU / Alias" required><input name="bankAccount_cbu" required className={`${inputClass} font-mono`} /></Field>
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-slate-200 rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-50 transition-colors">Cancelar</button>
            <button type="submit" className="flex-1 px-4 py-3 bg-black text-white rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-800 transition-colors">Guardar</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function ProviderEditModal({ provider, onClose, onSubmit }: { provider: any; onClose: () => void; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  const inferred = inferLegacyIdentifiers(provider);
  const [category, setCategory] = useState(provider.category || '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-white/80 backdrop-blur-md" />
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-auto p-8 relative z-10 border border-slate-200 shadow-2xl shadow-slate-200/50">
        <div className="flex justify-between items-center mb-8 border-l-4 border-black pl-4">
          <h2 className="text-xs font-bold uppercase tracking-widest">Editar Proveedor</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-black"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombre / Razón Social" required><input name="name" defaultValue={provider.name || provider.businessName} required className={inputClass} /></Field>
            <Field label="Apellido"><input name="lastName" defaultValue={provider.lastName} className={inputClass} /></Field>
            <Field label="DNI"><input name="dni" defaultValue={provider.dni || inferred.dniNormalized} className={inputClass} /></Field>
            <Field label="CUIT"><input name="cuit" defaultValue={provider.cuit || inferred.cuitNormalized} className={inputClass} /></Field>
          </div>
          <input type="hidden" name="dni_cuit" defaultValue={provider.dni_cuit || ''} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email"><input name="email" type="email" defaultValue={provider.email} className={inputClass} /></Field>
            <Field label="Teléfono"><input name="phone" defaultValue={provider.phone} className={inputClass} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Categoría / Oficio">
              <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                <option value="">Seleccionar...</option>
                {[...new Set([...PRODUCTION_AREA_CATEGORIES, ...COMPANY_PROVIDER_CATEGORIES])].map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            {category === 'Otra' && <Field label="Comentario Otra"><input name="categoryOther" defaultValue={provider.categoryOther} className={inputClass} /></Field>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Fecha Nacimiento"><input name="birthDate" defaultValue={provider.birthDate} type="date" className={inputClass} /></Field>
            <Field label="Restricción alimentaria"><input name="dietaryRestriction" defaultValue={provider.dietaryRestriction} className={inputClass} /></Field>
          </div>
          <Field label="Domicilio"><input name="address" defaultValue={provider.address} className={inputClass} /></Field>
          <Field label="CBU / Cuenta Bancaria"><input name="bankAccount_cbu" defaultValue={provider.bankAccount_cbu} className={`${inputClass} font-mono`} /></Field>
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-slate-200 rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-50 transition-colors">Cancelar</button>
            <button type="submit" className="flex-1 px-4 py-3 bg-black text-white rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-800 transition-colors">Actualizar</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}{required && <span className="text-red-500 ml-1">*</span>}</label>
      {children}
    </div>
  );
}
