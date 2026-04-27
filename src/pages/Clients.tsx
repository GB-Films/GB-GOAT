import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, addDoc, serverTimestamp, orderBy, where, or } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError } from '../lib/firestoreUtils';
import { useAuth } from '../context/AuthContext';
import { Plus, Search, Building2, Globe, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

export default function Clients() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const { profile } = useAuth();

  useEffect(() => {
    if (!profile?.uid || !profile?.email) return;

    const fetchClients = async () => {
      try {
        const q = query(collection(db, 'clients'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const clientsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Fetch projects separately to avoid one failure blocking the other
        let projectsData: any[] = [];
        try {
          const pq = query(
            collection(db, 'projects'),
            or(
              where('createdBy', '==', profile.uid),
              where('collaboratorEmails', 'array-contains', profile.email)
            )
          );
          const pSnapshot = await getDocs(pq);
          projectsData = pSnapshot.docs.map(doc => doc.data());
        } catch (pError: any) {
          console.error("Error fetching projects count:", pError);
          // If projects fail, we still want to show clients
        }

        const clientsWithCounts = clientsData.map((client: any) => ({
          ...client,
          activeProjects: projectsData.filter((p: any) => p.clientName === client.businessName).length
        }));

        setClients(clientsWithCounts);
      } catch (error: any) {
        console.error("Error fetching clients:", error);
        if (error.message?.includes('insufficient permissions')) {
          handleFirestoreError(error, 'list', 'clients');
        }
      } finally {
        setLoading(false);
      }
    };
    fetchClients();
  }, [profile]);

  const handleCreateClient = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      businessName: formData.get('businessName'),
      cuit: formData.get('cuit'),
      country: formData.get('country'),
      createdBy: profile?.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      const docRef = await addDoc(collection(db, 'clients'), data);
      setClients([{ id: docRef.id, ...data, createdAt: new Date(), activeProjects: 0 }, ...clients]);
      setShowNewModal(false);
    } catch (error) {
      console.error("Error adding client:", error);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex items-end justify-between border-b border-slate-200 pb-8">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-widest font-bold mb-1">CineManage / Comercial</div>
          <h1 className="text-3xl font-light text-slate-900">Clientes: <span className="font-bold text-black">Cartera de Empresas</span></h1>
        </div>
        <button 
          onClick={() => setShowNewModal(true)}
          className="px-4 py-2 bg-black text-white rounded text-sm font-semibold hover:bg-slate-800 transition-all active:scale-[0.98] uppercase tracking-widest flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Nuevo Cliente
        </button>
      </header>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <input 
            type="text" 
            placeholder="Buscar por razon social o CUIT..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400 transition-all placeholder:text-slate-300"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-200">
           <Building2 className="w-12 h-12 text-slate-100 mx-auto mb-4" />
           <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">Sin Clientes registrados</h3>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {clients.map((client, i) => (
            <motion.div
              key={client.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="group bg-white p-6 rounded-xl border border-slate-200 hover:border-slate-900 transition-all shadow-sm shadow-slate-200/50"
            >
              <div className="flex justify-between items-start mb-6">
                <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-slate-50 text-slate-400 rounded">
                  {client.cuit}
                </span>
                <Building2 className="w-4 h-4 text-slate-200 group-hover:text-slate-900 transition-colors" />
              </div>
              
              <h3 className="text-xl font-bold text-slate-900 leading-tight mb-2">
                {client.businessName}
              </h3>
              
              <div className="flex items-center gap-2 mb-8">
                <Globe className="w-3 h-3 text-slate-300" />
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                    {client.country}
                </p>
              </div>

              <div className="pt-4 border-t border-slate-50 flex justify-between items-center">
                <div className="text-[10px] text-slate-300 uppercase font-bold tracking-tighter">Proyectos Activos: {client.activeProjects || 0}</div>
                <button className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-black">Perfil Corporativo</button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* New Client Modal */}
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
              className="bg-white rounded-xl w-full max-w-md p-8 relative z-10 border border-slate-200 shadow-2xl shadow-slate-200/50"
            >
              <div className="flex justify-between items-center mb-8 border-l-4 border-black pl-4">
                <h2 className="text-xs font-bold uppercase tracking-widest">Alta de Cliente</h2>
                <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-black">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleCreateClient} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Razon Social</label>
                  <input name="businessName" required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="Nombre legal de la empresa..." />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">CUIT</label>
                  <input name="cuit" required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="30-XXXXXXXX-X" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">País</label>
                  <input name="country" required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="Argentina, España, etc..." />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setShowNewModal(false)} className="flex-1 px-4 py-3 border border-slate-200 rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-50 transition-colors">Cancelar</button>
                  <button type="submit" className="flex-1 px-4 py-3 bg-black text-white rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-800 transition-colors">Guardar Cliente</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
