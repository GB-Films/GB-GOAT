import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  query,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  orderBy,
  doc,
  setDoc,
  writeBatch,
  where,
  or,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError } from '../lib/firestoreUtils';
import { useAuth } from '../context/AuthContext';
import { Plus, Search, Truck, X, Upload, Download, Pencil, Trash2, Link2, Copy, CheckCircle2, FileText, Paperclip } from 'lucide-react';
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
import { PROVIDER_CREATE_ROLES, PROVIDER_UPDATE_ROLES } from '../lib/roles';

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
  const [providerDetail, setProviderDetail] = useState<any | null>(null);
  const [loadingProviderDetail, setLoadingProviderDetail] = useState(false);
  const [generatedInviteLink, setGeneratedInviteLink] = useState('');
  const [copiedInviteLink, setCopiedInviteLink] = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const { profile } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const canImportProviders = profile?.role === 'admin';
  const canDeleteProviders = profile?.role === 'admin';
  const canEditProviders = PROVIDER_UPDATE_ROLES.includes(profile?.role);
  const canCreateProviders = PROVIDER_CREATE_ROLES.includes(profile?.role);

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
      const activeProviderIds = new Set(items.map((provider) => provider.id));

      for (const provider of providersWithIdentifiers) {
        const identifiers = buildProviderIdentifiers(provider);
        for (const identifier of identifiers) {
          const identifierRef = doc(db, 'providerIdentifiers', identifier.id);
          const existingIdentifier = await getDoc(identifierRef);
          const existingProviderId = existingIdentifier.exists() ? existingIdentifier.data().providerId : '';

          if (existingProviderId && existingProviderId !== provider.id && activeProviderIds.has(existingProviderId)) {
            console.warn(`Duplicate provider identifier skipped: ${identifier.id}`, {
              existingProviderId,
              skippedProviderId: provider.id,
            });
            continue;
          }

          batch.set(identifierRef, {
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
        if (canEditProviders) void syncProviderIdentifiers(items);
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
  }, [profile, canEditProviders]);

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

  const createProviderWithUniqueIdentifiers = async (providerData: any) => {
    const providerRef = doc(collection(db, 'providers'));
    const identifiers = buildProviderIdentifiers({ id: providerRef.id, ...providerData });

    await runTransaction(db, async (transaction) => {
      const identifierRefs = identifiers.map((identifier) => ({
        identifier,
        ref: doc(db, 'providerIdentifiers', identifier.id),
      }));

      for (const item of identifierRefs) {
        const snap = await transaction.get(item.ref);
        if (snap.exists()) {
          throw new Error(item.identifier.type === 'dni' ? 'DNI_EXISTS' : 'CUIT_EXISTS');
        }
      }

      transaction.set(providerRef, providerData);
      for (const item of identifierRefs) {
        transaction.set(item.ref, {
          providerId: providerRef.id,
          providerType: providerData.type || 'manual',
          identifierType: item.identifier.type,
          value: item.identifier.value,
          createdAt: serverTimestamp(),
        });
      }
    });

    return providerRef.id;
  };

  const validateProviderIdentifiersAvailable = async (providerData: any, currentProviderId = '') => {
    const identifiers = buildProviderIdentifiers(providerData);
    for (const identifier of identifiers) {
      const snap = await getDoc(doc(db, 'providerIdentifiers', identifier.id));
      if (snap.exists() && snap.data().providerId !== currentProviderId) {
        return identifier.type === 'dni'
          ? 'Ya existe una persona registrada con este DNI.'
          : 'Ya existe un proveedor registrado con este CUIT/CUIL.';
      }
    }
    return '';
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canImportProviders) return;
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

          const providerId = await createProviderWithUniqueIdentifiers(providerData);
          newProviders.push({ id: providerId, ...providerData, createdAt: new Date() });
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
    if (!canCreateProviders) return;
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
    if (!canCreateProviders) return;
    if (savingProvider) return;
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
      setSavingProvider(true);
      const duplicateMessage = await validateProviderIdentifiersAvailable(data);
      if (duplicateMessage) {
        alert(duplicateMessage);
        return;
      }

      const providerId = await createProviderWithUniqueIdentifiers(data);
      setProviders([{ id: providerId, ...data, createdAt: new Date() }, ...providers]);
      setShowNewModal(false);
      alert('Proveedor cargado con exito.');
    } catch (error: any) {
      console.error('Error adding provider:', error);
      alert(error?.message === 'DNI_EXISTS'
        ? 'Ya existe una persona registrada con este DNI.'
        : error?.message === 'CUIT_EXISTS'
          ? 'Ya existe un proveedor registrado con este CUIT/CUIL.'
          : 'No se pudo cargar el proveedor.');
    } finally {
      setSavingProvider(false);
    }
  };

  const handleUpdateProvider = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canEditProviders) return;
    if (!editingProvider) return;
    if (savingProvider) return;

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
      setSavingProvider(true);
      const duplicateMessage = await validateProviderIdentifiersAvailable(data, editingProvider.id);
      if (duplicateMessage) {
        alert(duplicateMessage);
        return;
      }

      const providerRef = doc(db, 'providers', editingProvider.id);
      const oldIdentifiers = buildProviderIdentifiers(editingProvider);
      const nextIdentifiers = buildProviderIdentifiers({ id: editingProvider.id, ...data });

      await runTransaction(db, async (transaction) => {
        const nextIdentifierRefs = nextIdentifiers.map((identifier) => ({
          identifier,
          ref: doc(db, 'providerIdentifiers', identifier.id),
        }));

        for (const item of nextIdentifierRefs) {
          const snap = await transaction.get(item.ref);
          if (snap.exists() && snap.data().providerId !== editingProvider.id) {
            throw new Error(item.identifier.type === 'dni' ? 'DNI_EXISTS' : 'CUIT_EXISTS');
          }
        }

        transaction.update(providerRef, data);

        for (const identifier of oldIdentifiers) {
          if (!nextIdentifiers.some((next) => next.id === identifier.id)) {
            transaction.delete(doc(db, 'providerIdentifiers', identifier.id));
          }
        }

        for (const item of nextIdentifierRefs) {
          transaction.set(item.ref, {
            providerId: editingProvider.id,
            providerType,
            identifierType: item.identifier.type,
            value: item.identifier.value,
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }
      });
      setProviders(providers.map((provider) => provider.id === editingProvider.id ? { ...provider, ...data, updatedAt: new Date() } : provider));
      setEditingProvider(null);
    } catch (error: any) {
      console.error('Error updating provider:', error);
      if (error?.message === 'DNI_EXISTS' || error?.message === 'CUIT_EXISTS') {
        alert(error.message === 'DNI_EXISTS'
          ? 'Ya existe una persona registrada con este DNI.'
          : 'Ya existe un proveedor registrado con este CUIT/CUIL.');
      } else if (error.message?.includes('insufficient permissions')) {
        handleFirestoreError(error, 'update', `providers/${editingProvider.id}`);
      } else {
        alert('No se pudo actualizar el proveedor.');
      }
    } finally {
      setSavingProvider(false);
    }
  };

  const handleDeleteProvider = async (provider: any) => {
    if (!canDeleteProviders) return;
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

  const openProviderDetail = async (provider: any) => {
    if (!profile?.uid || !profile?.email) return;
    setLoadingProviderDetail(true);
    setProviderDetail({ provider, loading: true, projects: [], totals: null, lines: [] });

    try {
      const projectsRef = collection(db, 'projects');
      const projectsQuery = profile.role === 'admin'
        ? query(projectsRef)
        : query(
            projectsRef,
            or(
              where('createdBy', '==', profile.uid),
              where('collaboratorEmails', 'array-contains', String(profile.email || '').trim().toLowerCase())
            )
          );
      const projectSnapshot = await getDocs(projectsQuery);
      const projects = projectSnapshot.docs.map((item) => ({ id: item.id, ...item.data() as any }));
      const lines: any[] = [];

      await Promise.all(projects.map(async (project) => {
        const [budgetSnap, areaSnap] = await Promise.all([
          getDocs(collection(db, 'projects', project.id, 'budgetItems')),
          getDocs(collection(db, 'projects', project.id, 'areaExpenses')),
        ]);

        const pushLine = (item: any, source: 'Presupuesto Principal' | 'Gestion por Areas') => {
          if (item.providerId !== provider.id) return;
          const paid = Array.isArray(item.paymentHistory)
            ? item.paymentHistory.reduce((acc: number, payment: any) => acc + (Number(payment.amount) || 0), 0)
            : 0;
          const total = Number(item.total) || 0;
          lines.push({
            id: `${project.id}-${source}-${item.id}`,
            projectId: project.id,
            projectName: project.name || 'Sin nombre',
            area: item.area || 'Sin area',
            source,
            description: item.description || 'Sin descripcion',
            total,
            paid,
            debt: Math.max(0, total - paid),
            paymentDate: item.paymentDate || '',
            invoiceUrl: item.invoice?.url || '',
            invoiceName: item.invoice?.originalFileName || item.invoice?.fileName || '',
            receipts: [
              ...(Array.isArray(item.paymentHistory) ? item.paymentHistory.filter((payment: any) => payment.receipt?.url).map((payment: any) => payment.receipt) : []),
              ...(Array.isArray(item.otherReceipts) ? item.otherReceipts.filter((receipt: any) => receipt?.url) : []),
            ],
          });
        };

        budgetSnap.docs.forEach((item) => pushLine({ id: item.id, ...item.data() }, 'Presupuesto Principal'));
        areaSnap.docs.forEach((item) => pushLine({ id: item.id, ...item.data() }, 'Gestion por Areas'));
      }));

      const projectMap = new Map<string, any>();
      lines.forEach((line) => {
        if (!projectMap.has(line.projectId)) {
          projectMap.set(line.projectId, {
            id: line.projectId,
            name: line.projectName,
            total: 0,
            paid: 0,
            debt: 0,
            invoices: 0,
            receipts: 0,
          });
        }
        const row = projectMap.get(line.projectId);
        row.total += line.total;
        row.paid += line.paid;
        row.debt += line.debt;
        if (line.invoiceUrl) row.invoices += 1;
        row.receipts += line.receipts.length;
      });

      const totals = lines.reduce((acc, line) => ({
        total: acc.total + line.total,
        paid: acc.paid + line.paid,
        debt: acc.debt + line.debt,
        invoices: acc.invoices + (line.invoiceUrl ? 1 : 0),
        receipts: acc.receipts + line.receipts.length,
      }), { total: 0, paid: 0, debt: 0, invoices: 0, receipts: 0 });

      setProviderDetail({
        provider,
        loading: false,
        projects: Array.from(projectMap.values()).sort((a, b) => b.total - a.total),
        totals,
        lines: lines.sort((a, b) => a.projectName.localeCompare(b.projectName, 'es')),
      });
    } catch (error) {
      console.error('Error loading provider detail:', error);
      alert('No se pudo cargar el detalle del proveedor.');
      setProviderDetail(null);
    } finally {
      setLoadingProviderDetail(false);
    }
  };

  return (
    <div className="max-w-full mx-auto space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between border-b border-slate-200 pb-6">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">GB GOAT / Recursos</div>
          <h1 className="text-2xl font-bold text-black leading-none">Base de contactos</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canImportProviders && (
            <>
              <button onClick={downloadTemplate} className="px-4 py-2 bg-white border border-slate-200 text-[10px] font-bold uppercase tracking-widest rounded hover:bg-slate-50 transition-colors flex items-center gap-2">
                <Download className="w-3 h-3" /> Plantilla
              </button>
              <label className="px-4 py-2 bg-white border border-slate-200 text-[10px] font-bold uppercase tracking-widest rounded hover:bg-slate-50 transition-colors flex items-center gap-2 cursor-pointer">
                <Upload className="w-3 h-3" /> Importar
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
              </label>
            </>
          )}
          {canCreateProviders && (
            <>
              <button onClick={handleGenerateProviderInvite} disabled={generatingInvite} className="px-4 py-2 bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest rounded hover:bg-black transition-colors flex items-center gap-2 disabled:bg-slate-300">
                <Link2 className="w-3 h-3" /> {generatingInvite ? 'Generando...' : 'Generar Link Alta'}
              </button>
              <button onClick={() => setShowNewModal(true)} className="px-4 py-2 bg-black text-white text-[10px] font-bold uppercase tracking-widest rounded hover:bg-slate-800 transition-colors flex items-center gap-2">
                <Plus className="w-3 h-3" /> Nuevo Manual
              </button>
            </>
          )}
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
                {(canEditProviders || canDeleteProviders) && (
                  <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Acciones</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProviders.map((provider) => {
                const inferred = inferLegacyIdentifiers(provider);
                return (
                  <tr
                    key={provider.id}
                    onClick={() => openProviderDetail(provider)}
                    className="hover:bg-slate-50/50 transition-colors group cursor-pointer"
                  >
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
                    {(canEditProviders || canDeleteProviders) && (
                      <td className="px-5 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          {canEditProviders && (
                            <button onClick={(event) => { event.stopPropagation(); setEditingProvider(provider); }} className="p-1 text-slate-300 hover:text-black transition-colors" title="Editar proveedor">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDeleteProviders && (
                            <button onClick={(event) => { event.stopPropagation(); handleDeleteProvider(provider); }} className="p-1 text-slate-300 hover:text-red-500 transition-colors" title="Eliminar proveedor">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {showNewModal && (
          <ProviderManualModal saving={savingProvider} onClose={() => setShowNewModal(false)} onSubmit={handleCreateProvider} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingProvider && (
          <ProviderEditModal saving={savingProvider} provider={editingProvider} onClose={() => setEditingProvider(null)} onSubmit={handleUpdateProvider} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {providerDetail && (
          <ProviderDetailModal
            detail={providerDetail}
            loading={loadingProviderDetail}
            onClose={() => setProviderDetail(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ProviderDetailModal({ detail, loading, onClose }: { detail: any; loading: boolean; onClose: () => void }) {
  const [copiedProviderField, setCopiedProviderField] = useState('');
  const [showFullData, setShowFullData] = useState(false);
  const provider = detail.provider;
  const inferred = inferLegacyIdentifiers(provider);
  const dni = formatIdentifier(provider.dni || inferred.dniNormalized) || '-';
  const cuit = formatIdentifier(provider.cuit || inferred.cuitNormalized) || '-';
  const cbu = provider.bankAccount_cbu || provider.bankAccount || '-';
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
    { label: 'DNI', value: dni },
    { label: 'CUIT / CUIL', value: cuit },
    { label: 'CBU / Alias', value: cbu },
    { label: 'Email', value: provider.email || provider.adminEmail || '-' },
    { label: 'Telefono', value: provider.phone || '-' },
    { label: 'Domicilio', value: provider.address || '-' },
    { label: 'Fecha nacimiento', value: provider.birthDate ? formatDate(provider.birthDate) : '-' },
    { label: 'Categoria', value: category },
    { label: 'Restriccion alimentaria', value: provider.dietaryRestriction || '-' },
    { label: 'Origen', value: provider.source === 'provider_invite' ? 'Alta por link' : 'Carga interna' },
    { label: 'ID proveedor', value: provider.id || '-' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-white/80 backdrop-blur-md" />
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="bg-white rounded-xl w-full max-w-5xl max-h-[90vh] overflow-auto relative z-10 border border-slate-200 shadow-2xl shadow-slate-200/50">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 p-6 flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Detalle de proveedor</div>
            <h2 className="text-xl font-black text-slate-900">{providerDisplayName(provider)}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { label: 'CUIT', value: cuit },
                { label: 'CBU / Alias', value: cbu },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => copyValue(item.label, item.value)}
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
                        {['DNI', 'CUIT / CUIL', 'CBU / Alias'].includes(item.label) && item.value !== '-' && (
                          <button
                            type="button"
                            onClick={() => copyValue(item.label, item.value)}
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
                  <div className="divide-y divide-slate-100">
                    {detail.projects.map((project: any) => (
                      <a key={project.id} href={`#/proyectos/${project.id}`} className="grid grid-cols-5 gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                        <div className="col-span-2 min-w-0">
                          <div className="text-xs font-black text-slate-900 truncate">{project.name}</div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-300">{project.invoices} facturas / {project.receipts} comprobantes</div>
                        </div>
                        <div className="text-right text-xs font-bold text-slate-500">${project.total.toLocaleString()}</div>
                        <div className="text-right text-xs font-bold text-emerald-600">${project.paid.toLocaleString()}</div>
                        <div className={`text-right text-xs font-black ${project.debt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>${project.debt.toLocaleString()}</div>
                      </a>
                    ))}
                  </div>
                )}
              </section>

              {detail.lines.length > 0 && (
                <section className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Movimientos</div>
                  <div className="divide-y divide-slate-100">
                    {detail.lines.map((line: any) => (
                      <div key={line.id} className="px-4 py-3">
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
                        <div className="mt-2 flex flex-wrap gap-2">
                          {line.invoiceUrl && (
                            <a href={line.invoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-700 hover:bg-emerald-600 hover:text-white">
                              <FileText className="w-3 h-3" /> Factura
                            </a>
                          )}
                          {line.receipts.map((receipt: any, index: number) => (
                            <a key={receipt.id || receipt.path || index} href={receipt.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-blue-700 hover:bg-blue-600 hover:text-white">
                              <Paperclip className="w-3 h-3" /> Comprobante
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
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

function ProviderManualModal({ saving, onClose, onSubmit }: { saving?: boolean; onClose: () => void; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
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
              <Field label="Fecha Nacimiento"><DateInputField name="birthDate" /></Field>
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
            <button type="submit" disabled={saving} className="flex-1 px-4 py-3 bg-black text-white rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-800 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

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

function DateInputField({ name, defaultValue = '' }: { name: string; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [anchorDate, setAnchorDate] = useState(() => parseDateKey(defaultValue) || new Date(1990, 0, 1));
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
      <input type="hidden" name={name} value={value} />
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setAnchorDate(parseDateKey(value) || new Date(1990, 0, 1));
          setIsOpen((current) => !current);
        }}
        className={`${inputClass} text-center font-bold text-slate-800`}
      >
        {value ? formatDate(value) : 'dd/mm/aaaa'}
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          style={{ top: position.top, left: position.left }}
          className="fixed z-[500] w-[292px] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <button type="button" onClick={() => moveMonth(-1)} className="px-2 py-1 rounded border border-slate-100 text-[10px] font-black text-slate-500 hover:border-black">Ant.</button>
            <div className="text-[11px] font-black uppercase tracking-widest text-slate-800">
              {anchorDate.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
            </div>
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
                    setValue(key);
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
                  title={isToday ? 'Hoy' : undefined}
                >
                  {date.getDate()}
                  {isToday && (
                    <span className={`absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${isSelected ? 'bg-white' : 'bg-blue-500'}`} />
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
              <span className="h-2 w-2 rounded-full bg-blue-500" />Hoy
            </span>
            {value && (
              <button type="button" onClick={() => { setValue(''); setIsOpen(false); }} className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500">
                Limpiar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderEditModal({ saving, provider, onClose, onSubmit }: { saving?: boolean; provider: any; onClose: () => void; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
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
            <Field label="Fecha Nacimiento"><DateInputField name="birthDate" defaultValue={provider.birthDate || ''} /></Field>
            <Field label="Restricción alimentaria"><input name="dietaryRestriction" defaultValue={provider.dietaryRestriction} className={inputClass} /></Field>
          </div>
          <Field label="Domicilio"><input name="address" defaultValue={provider.address} className={inputClass} /></Field>
          <Field label="CBU / Cuenta Bancaria"><input name="bankAccount_cbu" defaultValue={provider.bankAccount_cbu} className={`${inputClass} font-mono`} /></Field>
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-slate-200 rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-50 transition-colors">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-3 bg-black text-white rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-800 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed">
              {saving ? 'Guardando...' : 'Actualizar'}
            </button>
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
