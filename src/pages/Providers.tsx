import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, addDoc, serverTimestamp, orderBy, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError } from '../lib/firestoreUtils';
import { useAuth } from '../context/AuthContext';
import { Plus, Search, Truck, ExternalLink, X, Upload, Download, Pencil, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { cn } from '../lib/utils';

const formatDate = (dateValue: any) => {
  if (!dateValue) return '-';
  
  // If it's a string, try to split it (assuming YYYY-MM-DD)
  if (typeof dateValue === 'string') {
    const parts = dateValue.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${day}/${month}/${year}`;
    }
    return dateValue;
  }

  // If it's a Firestore timestamp or Date object
  try {
    const date = dateValue.seconds ? new Date(dateValue.seconds * 1000) : new Date(dateValue);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
  } catch (e) {
    console.error("Error formatting date:", e);
  }

  return String(dateValue);
};

export default function Providers() {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<any | null>(null);
  const { profile } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');

  const downloadTemplate = () => {
    const templateData = [
      {
        Nombre: 'Juan',
        Apellido: 'Pérez',
        'DNI o CUIT': '20-12345678-9',
        Domicilio: 'Calle Falsa 123',
        'Fecha Nacimiento': '1990-01-01',
        'CBU o Cuenta': '0000000000000000000000',
        Categoria: 'Fotografía'
      },
      {
        Nombre: 'María',
        Apellido: 'García',
        'DNI o CUIT': '27-87654321-0',
        Domicilio: 'Avenida Siempre Viva 742',
        'Fecha Nacimiento': '1985-05-15',
        'CBU o Cuenta': '1111111111111111111111',
        Categoria: 'Arte'
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla Proveedores');
    XLSX.writeFile(workbook, 'plantilla_proveedores_gb_goat.xlsx');
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
          const providerData = {
            name: row.Nombre || row.NOMBRE || '',
            lastName: row.Apellido || row.APELLIDO || '',
            dni_cuit: String(row['DNI o CUIT'] || row.DNI || row.CUIT || ''),
            address: row.Domicilio || row.DOMICILIO || '',
            birthDate: row['Fecha Nacimiento'] || '',
            bankAccount_cbu: String(row['CBU o Cuenta'] || row.CBU || row.Cuenta || ''),
            category: row.Categoria || row.CATEGORÍA || row.Category || '',
            createdBy: profile?.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          const docRef = await addDoc(collection(db, 'providers'), providerData);
          newProviders.push({ id: docRef.id, ...providerData, createdAt: new Date() });
        }

        setProviders([...newProviders, ...providers]);
        alert(`${newProviders.length} proveedores importados correctamente.`);
      } catch (error) {
        console.error("Error importing providers:", error);
        alert("Hubo un error al procesar el archivo.");
      }
    };

    if (file.name.endsWith('.csv')) {
      reader.readAsText(file);
    } else {
      reader.readAsBinaryString(file);
    }
  };

  const filteredProviders = providers.filter(p => 
    `${p.name} ${p.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.dni_cuit?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    if (!profile) return;
    const fetchProviders = async () => {
      try {
        const q = query(collection(db, 'providers'), orderBy('lastName', 'asc'));
        const querySnapshot = await getDocs(q);
        setProviders(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error: any) {
        console.error("Error fetching providers:", error);
        if (error.message?.includes('insufficient permissions')) {
          handleFirestoreError(error, 'list', 'providers');
        }
      } finally {
        setLoading(false);
      }
    };
    fetchProviders();
  }, [profile]);

  const handleCreateProvider = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name'),
      lastName: formData.get('lastName'),
      dni_cuit: formData.get('dni_cuit'),
      address: formData.get('address'),
      birthDate: formData.get('birthDate'),
      bankAccount_cbu: formData.get('bankAccount_cbu'),
      createdBy: profile?.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      const docRef = await addDoc(collection(db, 'providers'), data);
      setProviders([{ id: docRef.id, ...data, createdAt: new Date() }, ...providers]);
      setShowNewModal(false);
    } catch (error) {
      console.error("Error adding provider:", error);
    }
  };

  const handleUpdateProvider = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingProvider) return;

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name'),
      lastName: formData.get('lastName'),
      dni_cuit: formData.get('dni_cuit'),
      address: formData.get('address'),
      birthDate: formData.get('birthDate'),
      bankAccount_cbu: formData.get('bankAccount_cbu'),
      category: formData.get('category'),
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, 'providers', editingProvider.id), data);
      setProviders(providers.map(p => p.id === editingProvider.id ? { ...p, ...data } : p));
      setEditingProvider(null);
    } catch (error) {
      console.error("Error updating provider:", error);
    }
  };

  const handleDeleteProvider = async (id: string) => {
    if (!confirm('¿Estás seguro de que deseas eliminar este proveedor?')) return;
    try {
      await deleteDoc(doc(db, 'providers', id));
      setProviders(providers.filter(p => p.id !== id));
    } catch (error) {
      console.error("Error deleting provider:", error);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex items-end justify-between border-b border-slate-200 pb-8">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-widest font-bold mb-1">CineManage / Recursos</div>
          <h1 className="text-3xl font-light text-slate-900">Proveedores: <span className="font-bold text-black">Base de Contactos</span></h1>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={downloadTemplate}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2 rounded"
          >
            <Download className="w-3 h-3" />
            Plantilla
          </button>
          <label className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2 rounded cursor-pointer relative group">
            <Upload className="w-3 h-3" />
            Importar
            <input type="file" accept=".csv, .xlsx, .xls" className="hidden" onChange={handleFileUpload} />
          </label>
          <button 
            onClick={() => setShowNewModal(true)}
            className="px-4 py-2 bg-black text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all active:scale-[0.98] flex items-center gap-2"
          >
            <Plus className="w-3 h-3" />
            Nuevo Proveedor
          </button>
        </div>
      </header>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <input 
            type="text" 
            placeholder="Buscar por nombre, DNI o CUIT..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400 transition-all placeholder:text-slate-300"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filteredProviders.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-200">
           <Truck className="w-12 h-12 text-slate-100 mx-auto mb-4" />
           <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">Sin Proveedores registrados</h3>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Nombre Completo</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">DNI / CUIT</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Fecha Nac.</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Domicilio</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">CBU / Cuenta</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProviders.map((provider) => (
                <tr key={provider.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-slate-900">{provider.name} {provider.lastName}</div>
                    <div className="text-[10px] text-slate-400 font-medium">{provider.category || 'Sin categoría'}</div>
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-600 font-medium">
                    {provider.dni_cuit}
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-600 font-medium whitespace-nowrap">
                    {formatDate(provider.birthDate)}
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-500 max-w-[200px] truncate">
                    {provider.address || '-'}
                  </td>
                  <td className="px-6 py-4 text-xs font-mono text-slate-500">
                    {provider.bankAccount_cbu || 'No especificado'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => setEditingProvider(provider)}
                        className="p-1 text-slate-300 hover:text-black transition-colors"
                        title="Editar proveedor"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={() => handleDeleteProvider(provider.id)}
                        className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                        title="Eliminar proveedor"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <button className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-black transition-colors ml-2">
                        Detalles
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Provider Modal */}
      <AnimatePresence>
        {showNewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewModal(false)}
              className="absolute inset-0 bg-white/80 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="bg-white rounded-xl w-full max-w-2xl p-8 relative z-10 border border-slate-200 shadow-2xl shadow-slate-200/50"
            >
              <div className="flex justify-between items-center mb-8 border-l-4 border-black pl-4">
                <h2 className="text-xs font-bold uppercase tracking-widest">Alta de Proveedor</h2>
                <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-black">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleCreateProvider} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Nombre</label>
                    <input name="name" required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="Nombre..." />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Apellido</label>
                    <input name="lastName" required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="Apellido..." />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Categoría / Oficio</label>
                  <input name="category" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="Ej: Cámara, Sonido, Arte..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">DNI / CUIT</label>
                    <input name="dni_cuit" required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="20-XXXXXXXX-X" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Fecha Nacimiento</label>
                    <input name="birthDate" type="date" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Domicilio</label>
                  <input name="address" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="Calle, Altura, Localidad..." />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">CBU / Cuenta Bancaria</label>
                  <input name="bankAccount_cbu" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all font-mono" placeholder="0000000000000000000000" />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setShowNewModal(false)} className="flex-1 px-4 py-3 border border-slate-200 rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-50 transition-colors">Cancelar</button>
                  <button type="submit" className="flex-1 px-4 py-3 bg-black text-white rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-800 transition-colors">Guardar Proveedor</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Provider Modal */}
      <AnimatePresence>
        {editingProvider && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingProvider(null)}
              className="absolute inset-0 bg-white/80 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="bg-white rounded-xl w-full max-w-2xl p-8 relative z-10 border border-slate-200 shadow-2xl shadow-slate-200/50"
            >
              <div className="flex justify-between items-center mb-8 border-l-4 border-black pl-4">
                <h2 className="text-xs font-bold uppercase tracking-widest">Editar Proveedor</h2>
                <button onClick={() => setEditingProvider(null)} className="text-slate-400 hover:text-black">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleUpdateProvider} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Nombre</label>
                    <input name="name" defaultValue={editingProvider.name} required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="Nombre..." />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Apellido</label>
                    <input name="lastName" defaultValue={editingProvider.lastName} required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="Apellido..." />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Categoría / Oficio</label>
                  <input name="category" defaultValue={editingProvider.category} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="Ej: Cámara, Sonido, Arte..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">DNI / CUIT</label>
                    <input name="dni_cuit" defaultValue={editingProvider.dni_cuit} required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="20-XXXXXXXX-X" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Fecha Nacimiento</label>
                    <input name="birthDate" defaultValue={editingProvider.birthDate} type="date" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Domicilio</label>
                  <input name="address" defaultValue={editingProvider.address} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="Calle, Altura, Localidad..." />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">CBU / Cuenta Bancaria</label>
                  <input name="bankAccount_cbu" defaultValue={editingProvider.bankAccount_cbu} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all font-mono" placeholder="0000000000000000000000" />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setEditingProvider(null)} className="flex-1 px-4 py-3 border border-slate-200 rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-50 transition-colors">Cancelar</button>
                  <button type="submit" className="flex-1 px-4 py-3 bg-black text-white rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-800 transition-colors">Actualizar Proveedor</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
