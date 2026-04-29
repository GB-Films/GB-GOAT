import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, query, getDocs, addDoc, serverTimestamp, deleteDoc, updateDoc, setDoc, writeBatch } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import { handleFirestoreError } from '../lib/firestoreUtils';
import { useAuth } from '../context/AuthContext';
import { 
  ChevronLeft, 
  Info, 
  DollarSign, 
  Users, 
  Wallet,
  BarChart2,
  Trash2,
  Plus,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Settings,
  Shield,
  UserPlus,
  Mail,
  Upload,
  Download,
  LayoutGrid,
  MapPin,
  ExternalLink as LinkIcon,
  FileText,
  Paperclip,
  X,
  Truck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { cn } from '../lib/utils';
import { BudgetRowCell } from './project-detail/BudgetRowCell';
import { PaymentModal } from './project-detail/PaymentModal';
import type { BudgetItem, Collaborator, Payment, PaymentCollection } from './project-detail/types';
import { formatIdentifier, inferLegacyIdentifiers, providerDisplayName } from '../lib/providerConstants';

const tabs = [
  { id: 'resumen', label: 'Resumen', icon: Info },
  { id: 'presupuesto', label: 'Presupuesto Principal', icon: DollarSign },
  { id: 'areas', label: 'Áreas', icon: LayoutGrid },
  { id: 'saldos', label: 'Saldos', icon: Wallet },
  { id: 'proveedores', label: 'Proveedores', icon: Truck },
  { id: 'equipo', label: 'Equipo', icon: Users },
  { id: 'permisos', label: 'Permisos', icon: Settings },
];

const BUDGET_AREAS = [
  'Producción', 'Dirección', 'Guion', 'Arte', 'Vestuario', 
  'Maquillaje', 'Fotografía', 'Sonido', 'Logística', 'Post-producción', 'Varios'
];

const statusColors: Record<string, string> = {
  'Presupuesto': 'bg-slate-100 text-slate-700 border-slate-200',
  'Pre Producción': 'bg-blue-100 text-blue-700 border-blue-200',
  'Rodaje': 'bg-rose-100 text-rose-700 border-rose-200',
  'Post': 'bg-purple-100 text-purple-700 border-purple-200',
  'Aprobado': 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const roleLabels: Record<Collaborator['role'], string> = {
  admin: 'Admin de proyecto',
  jefe_area: 'Jefe de Área',
  colaborador: 'Colaborador',
  lector: 'Lector',
};

const PROJECT_TAB_IDS = tabs.map(tab => tab.id);
const DEFAULT_COLLABORATOR_TABS = ['resumen', 'areas', 'saldos', 'proveedores'];
const safeArray = (value: any): string[] => Array.isArray(value) ? value : [];
const normalizeAllowedTabs = (allowedTabs: any, role?: Collaborator['role']) => {
  const normalized = safeArray(allowedTabs).filter(tabId => PROJECT_TAB_IDS.includes(tabId));
  if (role === 'admin') return normalized.length ? normalized : PROJECT_TAB_IDS;

  const looksLikeLegacyDefault = normalized.includes('presupuesto') && !normalized.includes('saldos');
  if (looksLikeLegacyDefault) {
    return Array.from(new Set([...normalized.filter(tabId => tabId !== 'presupuesto'), 'saldos', 'proveedores']));
  }

  const looksLikeCurrentDefault = normalized.includes('areas') && normalized.includes('saldos') && !normalized.includes('presupuesto');
  if (looksLikeCurrentDefault && !normalized.includes('proveedores')) {
    return Array.from(new Set([...normalized, 'proveedores']));
  }

  return normalized.length ? normalized : DEFAULT_COLLABORATOR_TABS;
};

const getDefaultCollaboratorPermissions = (role: Collaborator['role'], categories: string[], selectedCategories?: string[]) => {
  const chosenCategories = selectedCategories?.length ? selectedCategories : categories.slice(0, 1);

  if (role === 'admin') {
    return {
      allowedTabs: PROJECT_TAB_IDS,
      allowedCategories: categories,
      canEditBudgetAreas: true,
      canViewBudgetTotals: true,
    };
  }

  if (role === 'lector') {
    return {
      allowedTabs: ['resumen', 'saldos', 'proveedores'],
      allowedCategories: chosenCategories,
      canEditBudgetAreas: false,
      canViewBudgetTotals: false,
    };
  }

  return {
    allowedTabs: DEFAULT_COLLABORATOR_TABS,
    allowedCategories: chosenCategories,
    canEditBudgetAreas: true,
    canViewBudgetTotals: false,
  };
};

const formatDate = (dateString: string | any) => {
  if (!dateString) return 'Sin fecha';
  const date = dateString.seconds ? new Date(dateString.seconds * 1000) : new Date(dateString);
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatShootingDate = (dateValue: any) => {
  if (!dateValue) return 'Sin fecha definida';
  
  let date: Date;
  if (typeof dateValue === 'string') {
    // Handle YYYY-MM-DD
    date = new Date(dateValue + 'T12:00:00');
  } else if (dateValue.seconds) {
    date = new Date(dateValue.seconds * 1000);
  } else {
    date = new Date(dateValue);
  }

  if (isNaN(date.getTime())) return 'Fecha inválida';

  const formatted = date.toLocaleDateString('es-AR', { 
    weekday: 'long', 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric' 
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

const sanitizeFileName = (fileName: string) => {
  return fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
};

const buildInvoiceFileName = (expense: any) => {
  const baseName = sanitizeFileName(
    expense.providerName || expense.description || expense.area || 'factura'
  )
    .replace(/\.[^.]+$/, '')
    .slice(0, 70) || 'factura';
  const shortId = String(expense.id || 'gasto').slice(0, 8);
  return `factura-${baseName}-${shortId}.pdf`;
};

const normalizeEmail = (email?: string | null) => (email || '').trim().toLowerCase();
const normalizeText = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const isProductionArea = (area: unknown) => normalizeText(area).includes('producci');

const formatExportDate = (dateValue: any) => {
  if (!dateValue) return '';
  const date = dateValue.seconds ? new Date(dateValue.seconds * 1000) : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return String(dateValue);
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const downloadCsv = (rows: Record<string, any>[], fileName: string) => {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const downloadXlsx = (rows: Record<string, any>[], sheetName: string, fileName: string) => {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName);
};

const providerExportRow = (provider: any, extra: Record<string, any> = {}) => {
  const inferred = inferLegacyIdentifiers(provider);
  const category = provider.category === 'Otra'
    ? `Otra: ${provider.categoryOther || ''}`.trim()
    : provider.category || '';

  return {
    ...extra,
    Tipo: provider.type === 'empresa' ? 'Empresa' : 'Persona',
    'Nombre / Razon Social': providerDisplayName(provider),
    Nombre: provider.name || '',
    Apellido: provider.lastName || '',
    DNI: formatIdentifier(provider.dni || inferred.dniNormalized) || '',
    CUIT: formatIdentifier(provider.cuit || inferred.cuitNormalized) || '',
    Domicilio: provider.address || '',
    'Fecha Nacimiento': provider.birthDate || '',
    Email: provider.email || provider.adminEmail || '',
    Telefono: provider.phone || '',
    Categoria: category,
    'Restriccion Alimentaria': provider.dietaryRestriction || '',
    Origen: provider.source === 'provider_invite' ? 'Alta por link' : 'Carga interna',
  };
};

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('resumen');
  const [activeAreaTab, setActiveAreaTab] = useState<string | null>(null);
  
  // Data for specific tabs
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [areaExpenses, setAreaExpenses] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>(BUDGET_AREAS);
  const [activeAreas, setActiveAreas] = useState<string[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [newCollaboratorSearch, setNewCollaboratorSearch] = useState('');
  const [selectedUserToAdd, setSelectedUserToAdd] = useState<any | null>(null);
  const [newCollaboratorRole, setNewCollaboratorRole] = useState<Collaborator['role']>('jefe_area');
  const [newCollaboratorCategories, setNewCollaboratorCategories] = useState<string[]>([]);
  const [userPermissions, setUserPermissions] = useState<Collaborator | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [isProjectAdmin, setIsProjectAdmin] = useState(false);
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedItemForPayment, setSelectedItemForPayment] = useState<any>(null);
  const [paymentType, setPaymentType] = useState<PaymentCollection>('areaExpenses');
  const [isDeletingPayment, setIsDeletingPayment] = useState<number | null>(null);
  const [uploadingInvoices, setUploadingInvoices] = useState<Record<string, boolean>>({});
  const [dragOverExpenseId, setDragOverExpenseId] = useState<string | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const areaSelectorRef = useRef<HTMLDivElement>(null);
  const isGlobalAdmin = profile?.role === 'admin';
  
  useEffect(() => {
    const fetchProject = async () => {
      if (!id || !user) return;
      setLoading(true);
      try {
        const docRef = doc(db, 'projects', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setProject({ id: docSnap.id, ...data });
          
          const owner = data.createdBy === user.uid;
          const isGlobalAdmin = profile?.role === 'admin';
          setIsOwner(owner);

          // Fetch permissions. Los colaboradores se guardan por email normalizado.
          const userEmailKey = normalizeEmail(user.email);
          let colSnapshot = await getDoc(doc(db, 'projects', id, 'collaborators', userEmailKey));
          if (!colSnapshot.exists() && user.email && user.email !== userEmailKey) {
            colSnapshot = await getDoc(doc(db, 'projects', id, 'collaborators', user.email));
          }
          
          if (colSnapshot.exists()) {
            const rawPerms = colSnapshot.data() as Collaborator;
            const perms: Collaborator = {
              email: normalizeEmail(rawPerms.email || colSnapshot.id),
              role: rawPerms.role || 'colaborador',
              allowedTabs: normalizeAllowedTabs(rawPerms.allowedTabs, rawPerms.role || 'colaborador'),
              allowedCategories: safeArray(rawPerms.allowedCategories),
              canEditBudgetAreas: rawPerms.canEditBudgetAreas ?? rawPerms.role !== 'lector',
              canViewBudgetTotals: rawPerms.canViewBudgetTotals ?? rawPerms.role === 'admin',
              ...rawPerms,
            };
            setUserPermissions(perms);
            setIsProjectAdmin(owner || perms.role === 'admin' || isGlobalAdmin);
          } else {
            setUserPermissions(null);
            setIsProjectAdmin(owner || isGlobalAdmin);
          }

          if (data.activeAreas) {
            setActiveAreas(data.activeAreas);
            if (data.activeAreas.length > 0 && !activeAreaTab) {
              setActiveAreaTab(data.activeAreas[0]);
            }
          } else {
            setActiveAreas([]);
          }

          if (data.categories && Array.isArray(data.categories)) {
            // Merge with defaults to ensure none are lost, but respect project specific ones if any
            setCategories(Array.from(new Set([...BUDGET_AREAS, ...data.categories])));
          } else {
            setCategories(BUDGET_AREAS);
          }

          // Fetch all collaborators for project admins
          const colSnap = await getDocs(collection(db, 'projects', id, 'collaborators'));
          setCollaborators(colSnap.docs.map(d => {
            const data = d.data() as any;
            return {
              email: normalizeEmail(data.email || d.id),
              role: data.role || 'colaborador',
              allowedTabs: normalizeAllowedTabs(data.allowedTabs, data.role || 'colaborador'),
              allowedCategories: safeArray(data.allowedCategories),
              canEditBudgetAreas: data.canEditBudgetAreas ?? data.role !== 'lector',
              canViewBudgetTotals: data.canViewBudgetTotals ?? data.role === 'admin',
              ...data,
            } as Collaborator;
          }));
        }

        // Fetch Budget Items
        const bq = query(collection(db, 'projects', id, 'budgetItems'));
        const bSnap = await getDocs(bq);
        const fetchedItems = bSnap.docs.map(d => ({ id: d.id, ...d.data() } as BudgetItem));
        // Sort items by order if order exists
        fetchedItems.sort((a, b) => (a.order || 0) - (b.order || 0));
        setBudgetItems(fetchedItems);

        // Fetch All Area Expenses
        const eq = query(collection(db, 'projects', id, 'areaExpenses'));
        const eSnap = await getDocs(eq);
        setAreaExpenses(eSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        // Fetch all Providers (for selection)
        const pq = query(collection(db, 'providers'));
        const pSnap = await getDocs(pq);
        setProviders(pSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        // Fetch all Clients
        const cq = query(collection(db, 'clients'));
        const cSnap = await getDocs(cq);
        setClients(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      } catch (error: any) {
        if (error.message?.includes('insufficient permissions')) {
            handleFirestoreError(error, 'get', `projects/${id}`);
        }
        console.error("Error fetching project data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProject();
  }, [id, user, profile]);

  useEffect(() => {
    if (!isProjectAdmin) return;

    const fetchUsers = async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        setAvailableUsers(snap.docs.map((userDoc) => ({ id: userDoc.id, ...userDoc.data() })));
      } catch (error) {
        console.error('Error fetching available users:', error);
      }
    };

    fetchUsers();
  }, [isProjectAdmin]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (areaSelectorRef.current && !areaSelectorRef.current.contains(event.target as Node)) {
        setIsAreaSelectorOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const updateBudgetItem = async (itemId: string, updates: any) => {
    if (!id || !canEditMainBudget) return;
    try {
      const itemRef = doc(db, 'projects', id, 'budgetItems', itemId);
      await updateDoc(itemRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
      setBudgetItems(items => items.map(i => i.id === itemId ? { ...i, ...updates } : i));
    } catch (e) {
      console.error("Error updating budget item:", e);
    }
  };

  const deleteBudgetItem = async (itemId: string) => {
    if (!id || !canEditMainBudget || !confirm('¿Eliminar esta partida?')) return;
    try {
      await deleteDoc(doc(db, 'projects', id, 'budgetItems', itemId));
      setBudgetItems(items => items.filter(i => i.id !== itemId));
    } catch (e) {
      console.error("Error deleting budget item:", e);
    }
  };

  const addEmptyRow = async (area: string) => {
    if (!id || !canEditMainBudget) return;
    const itemsInArea = budgetItems.filter(i => i.area === area);
    const maxOrder = itemsInArea.length > 0 ? Math.max(...itemsInArea.map(i => i.order || 0)) : 0;
    
    const newItem = {
      projectId: id,
      area,
      providerId: '',
      providerName: '',
      description: '',
      unit: 'Unidad',
      quantity: 0,
      unitPrice: 0,
      total: 0,
      order: maxOrder + 1,
      createdAt: serverTimestamp()
    };
    try {
      const docRef = await addDoc(collection(db, 'projects', id, 'budgetItems'), newItem);
      setBudgetItems([...budgetItems, { id: docRef.id, ...newItem }]);
    } catch (e) {
      console.error("Error adding empty row:", e);
    }
  };

  const onDragEnd = async (result: any) => {
    if (!result.destination || !id || !canEditMainBudget) return;

    const { source, destination, type } = result;
    
    if (type === 'category') {
      const newCategories = [...categories];
      const [reorderedCategory] = newCategories.splice(source.index, 1);
      newCategories.splice(destination.index, 0, reorderedCategory);
      setCategories(newCategories);
      try {
        await updateDoc(doc(db, 'projects', id), { categories: newCategories });
      } catch (e) {
        console.error("Error updating categories order:", e);
      }
      return;
    }

    // Create copies of items
    const newItems = [...budgetItems];
    
    if (source.droppableId === destination.droppableId) {
      // Reordering within the same category
      const area = source.droppableId;
      const areaItems = newItems.filter(i => i.area === area).sort((a, b) => (a.order || 0) - (b.order || 0));
      const otherItems = newItems.filter(i => i.area !== area);
      
      const [reorderedItem] = areaItems.splice(source.index, 1);
      areaItems.splice(destination.index, 0, reorderedItem);

      // Update orders
      const updatedAreaItems = areaItems.map((item, index) => ({
        ...item,
        order: index
      }));

      const finalItems = [...otherItems, ...updatedAreaItems].sort((a, b) => {
        if (a.area === b.area) return (a.order || 0) - (b.order || 0);
        return categories.indexOf(a.area) - categories.indexOf(b.area);
      });

      setBudgetItems(finalItems);

      // Persistence
      try {
        for (const item of updatedAreaItems) {
          const itemRef = doc(db, 'projects', id, 'budgetItems', item.id);
          await updateDoc(itemRef, { order: item.order });
        }
      } catch (e) {
        console.error("Error updating item order:", e);
      }
    } else {
      // Moving between categories
      const sourceArea = source.droppableId;
      const destArea = destination.droppableId;
      
      const sourceItems = newItems.filter(i => i.area === sourceArea).sort((a, b) => (a.order || 0) - (b.order || 0));
      const destItems = newItems.filter(i => i.area === destArea).sort((a, b) => (a.order || 0) - (b.order || 0));
      const otherItems = newItems.filter(i => i.area !== sourceArea && i.area !== destArea);

      const [movedItem] = sourceItems.splice(source.index, 1);
      movedItem.area = destArea; // Update area
      destItems.splice(destination.index, 0, movedItem);

      // Update orders for both categories
      const updatedSourceItems = sourceItems.map((item, index) => ({ ...item, order: index }));
      const updatedDestItems = destItems.map((item, index) => ({ ...item, order: index }));

      const finalItems = [...otherItems, ...updatedSourceItems, ...updatedDestItems].sort((a, b) => {
        if (a.area === b.area) return (a.order || 0) - (b.order || 0);
        return categories.indexOf(a.area) - categories.indexOf(b.area);
      });

      setBudgetItems(finalItems);

      // Persistence
      try {
        const itemRef = doc(db, 'projects', id, 'budgetItems', movedItem.id);
        await updateDoc(itemRef, { area: destArea, order: destination.index });
        
        // Update others in source
        for (const item of updatedSourceItems) {
          await updateDoc(doc(db, 'projects', id, 'budgetItems', item.id), { order: item.order });
        }
        // Update others in destination
        for (const item of updatedDestItems) {
          await updateDoc(doc(db, 'projects', id, 'budgetItems', item.id), { order: item.order });
        }
      } catch (e) {
        console.error("Error moving item across categories:", e);
      }
    }
  };

  const [isAreaSelectorOpen, setIsAreaSelectorOpen] = useState(false);
  
  const addActiveArea = async (areaName: string) => {
    try {
      const currentActive = Array.isArray(activeAreas) ? activeAreas : [];
      const newActiveAreas = [...currentActive, areaName];
      setActiveAreas(newActiveAreas);
      if (id) {
        await updateDoc(doc(db, 'projects', id), { activeAreas: newActiveAreas });
        if (!activeAreaTab) setActiveAreaTab(areaName);
      }
      setIsAreaSelectorOpen(false);
    } catch (error) {
      console.error("Error activating area:", error);
      alert("Error al activar el área.");
    }
  };

  const removeActiveArea = async (areaName: string) => {
    if (!confirm(`¿Estás seguro de que deseas desactivar la gestión del área "${areaName}"? Los gastos registrados no se borrarán pero no se verán aquí.`)) return;
    
    const newActiveAreas = activeAreas.filter(a => a !== areaName);
    setActiveAreas(newActiveAreas);
    if (id) {
      await updateDoc(doc(db, 'projects', id), { activeAreas: newActiveAreas });
    }
    if (activeAreaTab === areaName) {
      setActiveAreaTab(newActiveAreas[0] || null);
    }
  };

  const getAreaBudget = (area: string) => {
    return budgetItems
      .filter(item => item.area === area)
      .reduce((acc, item) => acc + (Number(item.total) || 0), 0);
  };

  const getAreaSpent = (area: string, excludeExpenseId?: string) => {
    return areaExpenses
      .filter(item => item.area === area && item.id !== excludeExpenseId)
      .reduce((acc, item) => acc + (Number(item.total) || 0), 0);
  };

  const canSaveAreaExpense = (area: string, nextTotal: number, excludeExpenseId?: string) => {
    const assigned = getAreaBudget(area);
    const nextSpent = getAreaSpent(area, excludeExpenseId) + (Number(nextTotal) || 0);

    if (assigned <= 0) {
      if (!isProjectAdmin) {
        alert(`El área "${area}" no tiene presupuesto asignado en el Presupuesto Principal.`);
        return false;
      }
      return true;
    }

    if (nextSpent <= assigned + 0.01) return true;

    const overBy = nextSpent - assigned;
    const message = `Este gasto supera el presupuesto asignado para "${area}" por $${overBy.toLocaleString()}.`;

    if (!isProjectAdmin) {
      alert(`${message}\n\nPedí autorización a un administrador del proyecto para ampliar el presupuesto.`);
      return false;
    }

    return confirm(`${message}\n\nComo administrador, ¿querés guardarlo igual?`);
  };

  const addAreaExpense = async (area: string) => {
    if (!id || !canEditArea(area)) return;
    const assigned = getAreaBudget(area);
    const spent = getAreaSpent(area);

    if (!isProjectAdmin && assigned <= 0) {
      alert(`El área "${area}" todavía no tiene presupuesto asignado.`);
      return;
    }

    if (!isProjectAdmin && assigned > 0 && spent >= assigned) {
      alert(`El área "${area}" ya consumió todo el presupuesto asignado.`);
      return;
    }

    const newItem = {
      projectId: id,
      area: area,
      providerId: '',
      providerName: 'Nuevo Gasto',
      description: 'Descripción del gasto...',
      unit: 'Unidad',
      quantity: 1,
      unitPrice: 0,
      total: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    try {
      const docRef = await addDoc(collection(db, 'projects', id, 'areaExpenses'), newItem);
      setAreaExpenses([{ id: docRef.id, ...newItem }, ...areaExpenses]);
    } catch (e) {
      console.error("Error adding area expense:", e);
    }
  };

  const updateAreaExpense = async (expenseId: string, updates: any) => {
    if (!id) return;
    try {
      const currentExpense = areaExpenses.find(e => e.id === expenseId);
      if (!currentExpense) return;

      const nextArea = updates.area || currentExpense.area;
      if (!canEditArea(currentExpense.area) || !canEditArea(nextArea)) return;
      const nextTotal = updates.total !== undefined ? Number(updates.total) : Number(currentExpense.total) || 0;

      if (!canSaveAreaExpense(nextArea, nextTotal, expenseId)) return;

      const docRef = doc(db, 'projects', id, 'areaExpenses', expenseId);
      await updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
      setAreaExpenses(areaExpenses.map(e => e.id === expenseId ? { ...e, ...updates } : e));
    } catch (e) {
      console.error("Error updating area expense:", e);
    }
  };

  const deleteAreaExpense = async (expenseId: string) => {
    const currentExpense = areaExpenses.find(e => e.id === expenseId);
    if (!id || !currentExpense || !canEditArea(currentExpense.area) || !confirm('¿Eliminar este gasto?')) return;
    try {
      await deleteDoc(doc(db, 'projects', id, 'areaExpenses', expenseId));
      setAreaExpenses(areaExpenses.filter(e => e.id !== expenseId));
    } catch (e) {
      console.error("Error deleting area expense:", e);
    }
  };

  const uploadInvoiceForExpense = async (expense: any, file?: File | null) => {
    if (!id || !file || !canUploadAreaFiles(expense.area)) return;

    if (file.type !== 'application/pdf') {
      alert('Por ahora sólo se pueden adjuntar facturas en PDF.');
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      alert('El PDF es muy pesado. El máximo permitido es 15 MB.');
      return;
    }

    setUploadingInvoices(prev => ({ ...prev, [expense.id]: true }));

    try {
      const areaFolder = sanitizeFileName(expense.area || 'sin-area') || 'sin-area';
      const fileName = buildInvoiceFileName(expense);
      const path = `projects/${id}/areas/${areaFolder}/facturas/${fileName}`;
      const storageRef = ref(storage, path);

      await uploadBytes(storageRef, file, {
        contentType: file.type,
        customMetadata: {
          projectId: id,
          expenseId: expense.id,
          area: expense.area || '',
          originalFileName: file.name,
          uploadedBy: user?.email || user?.uid || 'unknown',
        },
      });

      const url = await getDownloadURL(storageRef);
      const invoice = {
        fileName,
        originalFileName: file.name,
        url,
        path,
        contentType: file.type,
        size: file.size,
        uploadedAt: serverTimestamp(),
        uploadedBy: user?.email || user?.uid || '',
      };

      await updateDoc(doc(db, 'projects', id, 'areaExpenses', expense.id), {
        invoice,
        invoiceStatus: 'pendiente',
        updatedAt: serverTimestamp(),
      });

      if (expense.invoice?.path && expense.invoice.path !== path) {
        deleteObject(ref(storage, expense.invoice.path)).catch(() => {});
      }

      setAreaExpenses(areaExpenses.map(item => item.id === expense.id
        ? {
            ...item,
            invoice: { ...invoice, uploadedAt: new Date() },
            invoiceStatus: 'pendiente',
          }
        : item
      ));
    } catch (error: any) {
      console.error('Error uploading invoice:', error);
      handleFirestoreError(error, 'update', `projects/${id}/areaExpenses/${expense.id}`);
      alert('No se pudo subir la factura. Revisá que Firebase Storage esté activado y que las reglas permitan PDFs.');
    } finally {
      setUploadingInvoices(prev => ({ ...prev, [expense.id]: false }));
    }
  };

  const removeInvoiceFromExpense = async (expense: any) => {
    if (!id || !expense.invoice || !canUploadAreaFiles(expense.area)) return;
    if (!confirm('¿Quitar la factura adjunta de este gasto?')) return;

    setUploadingInvoices(prev => ({ ...prev, [expense.id]: true }));

    try {
      await updateDoc(doc(db, 'projects', id, 'areaExpenses', expense.id), {
        invoice: null,
        invoiceStatus: null,
        updatedAt: serverTimestamp(),
      });

      if (expense.invoice.path) {
        await deleteObject(ref(storage, expense.invoice.path)).catch(() => {});
      }

      setAreaExpenses(areaExpenses.map(item => item.id === expense.id
        ? { ...item, invoice: null, invoiceStatus: null }
        : item
      ));
    } catch (error: any) {
      console.error('Error removing invoice:', error);
      handleFirestoreError(error, 'update', `projects/${id}/areaExpenses/${expense.id}`);
    } finally {
      setUploadingInvoices(prev => ({ ...prev, [expense.id]: false }));
    }
  };

  const handleInvoiceDrop = async (event: React.DragEvent<HTMLDivElement>, expense: any) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverExpenseId(null);

    if (uploadingInvoices[expense.id]) return;

    const files: File[] = [];
    for (let index = 0; index < event.dataTransfer.files.length; index += 1) {
      const file = event.dataTransfer.files.item(index);
      if (file) files.push(file);
    }
    const pdfFile = files.find(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));

    if (!pdfFile) {
      alert('Soltá un archivo PDF para adjuntarlo como factura.');
      return;
    }

    await uploadInvoiceForExpense(expense, pdfFile);
  };

  const renameCategory = async (oldName: string) => {
    if (!canEditMainBudget) return;
    const newName = prompt('Nuevo nombre para la categoría:', oldName);
    if (!newName || newName === oldName || !id) return;

    const newCategories = categories.map(c => c === oldName ? newName : c);
    const updatedItems = budgetItems.map(i => i.area === oldName ? { ...i, area: newName } : i);

    setCategories(newCategories);
    setBudgetItems(updatedItems);

    try {
      await updateDoc(doc(db, 'projects', id), { categories: newCategories });
      // Update all items in this area in Firestore
      const itemsInArea = budgetItems.filter(i => i.area === oldName);
      for (const item of itemsInArea) {
        await updateDoc(doc(db, 'projects', id, 'budgetItems', item.id), { area: newName });
      }
    } catch (e) {
      console.error("Error renaming category:", e);
    }
  };

  const toggleCategory = (area: string) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [area]: !prev[area]
    }));
  };

  const openPaymentModal = (item: any, type: PaymentCollection) => {
    setSelectedItemForPayment({ ...item, __paymentCollection: type });
    setPaymentType(type);
    setIsDeletingPayment(null);
    setPaymentModalOpen(true);
  };

  const updatePaymentState = (
    itemId: string,
    collectionName: PaymentCollection,
    updatedHistory: Payment[],
    isFullyPaid: boolean
  ) => {
    const updates = { paymentHistory: updatedHistory, paid: isFullyPaid };

    if (collectionName === 'budgetItems') {
      setBudgetItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updates } : i));
    } else {
      setAreaExpenses(prev => prev.map(i => i.id === itemId ? { ...i, ...updates } : i));
    }

    setSelectedItemForPayment((prev: any) => {
      if (!prev || prev.id !== itemId) return prev;
      return { ...prev, ...updates, __paymentCollection: collectionName };
    });
  };

  const deletePaymentFromSelectedItem = async (paymentIndex: number) => {
    if (!id || !selectedItemForPayment) return;

    if (!window.confirm('¿Borrar definitivamente este registro de pago?')) return;

    setIsDeletingPayment(paymentIndex);

    try {
      const currentItemId = selectedItemForPayment.id;
      if (!currentItemId) throw new Error('No se pudo identificar el ítem. ID faltante.');

      const currentHistory = Array.isArray(selectedItemForPayment.paymentHistory)
        ? [...selectedItemForPayment.paymentHistory]
        : [];
      const paymentToDelete = currentHistory[paymentIndex];

      if (!paymentToDelete) throw new Error('Índice de pago no válido.');

      const updatedHistory = currentHistory.filter((payment: Payment, index: number) => {
        if (paymentToDelete.id) return payment.id !== paymentToDelete.id;
        return index !== paymentIndex;
      });

      const totalPaid = updatedHistory.reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0);
      const itemTotal = Number(selectedItemForPayment.total) || 0;
      const isFullyPaid = totalPaid >= (itemTotal - 0.01);
      const collectionName: PaymentCollection = selectedItemForPayment.__paymentCollection || paymentType;

      await updateDoc(doc(db, 'projects', id, collectionName, currentItemId), {
        paymentHistory: updatedHistory,
        paid: isFullyPaid,
        updatedAt: serverTimestamp()
      });

      if (paymentToDelete.receipt?.path) {
        deleteObject(ref(storage, paymentToDelete.receipt.path)).catch(() => {});
      }

      updatePaymentState(currentItemId, collectionName, updatedHistory, isFullyPaid);
    } catch (error: any) {
      console.error('Error deleting payment:', error);
      alert('Error al eliminar el pago: ' + (error.message || 'Error desconocido'));
    } finally {
      setIsDeletingPayment(null);
    }
  };

  const addCategory = async () => {
    if (!canEditMainBudget) return;
    const name = prompt('Nombre de la nueva categoría:');
    if (!name || !id) return;
    const newCategories = [...categories, name];
    setCategories(newCategories);
    try {
      await updateDoc(doc(db, 'projects', id), { categories: newCategories });
    } catch (e) {
      console.error("Error adding category:", e);
    }
  };

  const downloadTemplate = () => {
    const templateData = [
      {
        Area: 'Producción',
        Proveedor: 'Juan Pérez',
        Descripción: 'Servicios de Fotografía',
        'P Unitario': 500,
        Cantidad: 2
      },
      {
        Area: 'Arte',
        Proveedor: 'María García',
        Descripción: 'Escenografía principal',
        'P Unitario': 1200,
        Cantidad: 1
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla Presupuesto');
    XLSX.writeFile(workbook, 'plantilla_presupuesto_gb_goat.xlsx');
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEditMainBudget) return;
    const file = event.target.files?.[0];
    if (!file || !id) return;

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

        // Process and save items
        const newItems: any[] = [];
        const currentCategories = [...categories];
        let categoriesChanged = false;

        for (const row of jsonData) {
          const providerName = row.Proveedor || row.PROVEEDOR || '';
          const description = row.Descripción || row.DESCRIPCIÓN || row.Descripcion || '';
          const unitPrice = Number(row['P Unitario'] || row['PRECIO UNITARIO'] || row.Price || 0);
          const quantity = Number(row.Cantidad || row.CANTIDAD || row.Quantity || 0);
          const area = row.Area || row.AREA || row.Categoría || row.CATEGORÍA || categories[0] || 'Producción';
          
          // Add category if it doesn't exist
          if (!currentCategories.includes(area)) {
            currentCategories.push(area);
            categoriesChanged = true;
          }

          // Find provider match
          const matchedProvider = providers.find(p => 
            `${p.name} ${p.lastName}`.toLowerCase() === providerName.toLowerCase() ||
            p.name.toLowerCase() === providerName.toLowerCase()
          );

          const newItem = {
            projectId: id,
            area: area,
            providerId: matchedProvider?.id || '',
            providerName: providerName,
            description: description,
            unit: 'Unidad',
            quantity: quantity,
            unitPrice: unitPrice,
            total: quantity * unitPrice,
            order: budgetItems.length + newItems.length,
            createdAt: serverTimestamp()
          };

          const docRef = await addDoc(collection(db, 'projects', id, 'budgetItems'), newItem);
          newItems.push({ id: docRef.id, ...newItem });
        }

        if (categoriesChanged) {
          setCategories(currentCategories);
          await updateDoc(doc(db, 'projects', id), { categories: currentCategories });
        }

        setBudgetItems([...budgetItems, ...newItems]);
        alert(`${newItems.length} partidas importadas correctamente.`);
      } catch (error) {
        console.error("Error importing file:", error);
        alert("Hubo un error al procesar el archivo. Asegúrate de que el formato sea correcto.");
      }
    };

    if (file.name.endsWith('.csv')) {
      reader.readAsText(file);
    } else {
      reader.readAsBinaryString(file);
    }
  };

  const deleteCategory = async (area: string) => {
    if (!id || !canEditMainBudget || !confirm(`¿Eliminar la categoría "${area}" y todos sus ítems?`)) return;
    
    const itemsToDelete = budgetItems.filter(i => i.area === area);
    const newCategories = categories.filter(c => c !== area);
    
    try {
      // Delete items in category
      for (const item of itemsToDelete) {
        await deleteDoc(doc(db, 'projects', id, 'budgetItems', item.id));
      }
      // Update categories in project
      await updateDoc(doc(db, 'projects', id), { categories: newCategories });
      
      setCategories(newCategories);
      setBudgetItems(prev => prev.filter(i => i.area !== area));
    } catch (e) {
      console.error("Error deleting category:", e);
    }
  };

  // Filtered views based on permissions
  const visibleTabs = tabs.filter(tab => {
    if (isProjectAdmin) return true;
    return safeArray(userPermissions?.allowedTabs).includes(tab.id);
  });

  useEffect(() => {
    if (!loading && visibleTabs.length > 0 && !visibleTabs.some(tab => tab.id === activeTab)) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [activeTab, loading, visibleTabs]);

  const visibleCategories = categories.filter(cat => {
    if (activeTab === 'areas') {
       // In areas tab, we only show active ones or what user is allowed
       return activeAreas.includes(cat) && (isProjectAdmin || safeArray(userPermissions?.allowedCategories).includes(cat));
    }
    if (isProjectAdmin) return true;
    return safeArray(userPermissions?.allowedCategories).includes(cat);
  });

  const visibleBudgetItems = budgetItems.filter(item => {
    if (isProjectAdmin) return true;
    return safeArray(userPermissions?.allowedCategories).includes(item.area);
  });

  const selectedAreaTab = activeAreaTab && visibleCategories.includes(activeAreaTab)
    ? activeAreaTab
    : visibleCategories[0] || null;

  const canEditMainBudget = isProjectAdmin;
  const canEditArea = (area?: string | null) => {
    if (!area) return false;
    if (isProjectAdmin) return true;
    return Boolean(
      userPermissions?.canEditBudgetAreas
      && safeArray(userPermissions.allowedCategories).includes(area)
      && safeArray(userPermissions.allowedTabs).includes('areas')
    );
  };
  const canUploadAreaFiles = (area?: string | null) => canEditArea(area);
  const collaboratorEmails = collaborators.map((col) => normalizeEmail(col.email));
  const filteredAvailableUsers = availableUsers
    .filter((candidate) => {
      const email = normalizeEmail(candidate.email);
      if (!email) return false;
      if (collaboratorEmails.includes(email)) return false;
      const term = newCollaboratorSearch.trim().toLowerCase();
      if (!term) return true;
      return [candidate.displayName, candidate.email].filter(Boolean).join(' ').toLowerCase().includes(term);
    })
    .slice(0, 8);

  const providerSaldosByArea = React.useMemo(() => {
    const allowedCategories = isProjectAdmin ? categories : safeArray(userPermissions?.allowedCategories);
    const canSeeArea = (area?: string) => isProjectAdmin || allowedCategories.includes(area || '');
    const saldosMap = new Map<string, { 
      id: string, 
      area: string,
      name: string, 
      cbu: string, 
      budgeted: number, 
      spent: number, 
      paid: number,
      debt: number 
    }>();

    const ensureSaldo = (area: string, providerId: string, providerName?: string) => {
      const provider = providers.find(p => p.id === providerId);
      const key = `${area}__${providerId}`;
      if (!saldosMap.has(key)) {
        saldosMap.set(key, {
          id: key,
          area,
          name: providerName || (provider ? `${provider.name} ${provider.lastName}` : 'Desconocido'),
          cbu: provider?.bankAccount_cbu || 'No especificado',
          budgeted: 0,
          spent: 0,
          paid: 0,
          debt: 0
        });
      }

      return saldosMap.get(key)!;
    };

    budgetItems.forEach(item => {
      if (!item.providerId || !canSeeArea(item.area)) return;
      const s = ensureSaldo(item.area || 'Sin area', item.providerId, item.providerName);
      s.budgeted += item.total || 0;

      if (!activeAreas.includes(item.area)) {
        s.spent += item.total || 0;
        const itemPaid = (item.paymentHistory || []).reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0);
        s.paid += itemPaid;
      }
    });

    areaExpenses.forEach(item => {
      if (!item.providerId || !canSeeArea(item.area)) return;
      const s = ensureSaldo(item.area || 'Sin area', item.providerId, item.providerName);
      s.spent += item.total || 0;
      
      const itemPaid = (item.paymentHistory || []).reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0);
      s.paid += itemPaid;
    });

    const rows = Array.from(saldosMap.values())
      .map(s => ({
        ...s,
        debt: s.spent - s.paid
      }))
      .filter(s => s.spent > 0 || s.paid > 0)
      .sort((a, b) => {
        const areaDiff = categories.indexOf(a.area) - categories.indexOf(b.area);
        if (areaDiff !== 0) return areaDiff;
        return b.debt - a.debt;
      });

    const orderedAreas = Array.from(new Set([...categories, ...rows.map(row => row.area)]));

    return orderedAreas
      .map(area => ({
        area,
        rows: rows.filter(row => row.area === area),
      }))
      .filter(group => group.rows.length > 0);
  }, [activeAreas, areaExpenses, budgetItems, categories, isProjectAdmin, providers, userPermissions]);

  const providerSaldos = providerSaldosByArea.flatMap(group => group.rows);

  const projectAreaProviderRows = React.useMemo(() => {
    const allowedCategories = isProjectAdmin ? categories : safeArray(userPermissions?.allowedCategories);
    const canSeeArea = (area?: string) => isProjectAdmin || allowedCategories.includes(area || '');
    const byProvider = new Map<string, { provider: any; areas: Set<string>; concepts: Set<string> }>();

    areaExpenses.forEach((expense) => {
      if (!expense.providerId || !canSeeArea(expense.area)) return;
      const provider = providers.find(item => item.id === expense.providerId);
      if (!provider) return;

      if (!byProvider.has(expense.providerId)) {
        byProvider.set(expense.providerId, {
          provider,
          areas: new Set<string>(),
          concepts: new Set<string>(),
        });
      }

      const row = byProvider.get(expense.providerId)!;
      if (expense.area) row.areas.add(expense.area);
      if (expense.description) row.concepts.add(expense.description);
    });

    return Array.from(byProvider.values())
      .map(row => ({
        provider: row.provider,
        areas: Array.from(row.areas).sort(),
        concepts: Array.from(row.concepts).sort(),
      }))
      .sort((a, b) => providerDisplayName(a.provider).localeCompare(providerDisplayName(b.provider), 'es'));
  }, [areaExpenses, categories, isProjectAdmin, providers, userPermissions]);

  const allProjectAreaProviderRows = React.useMemo(() => {
    const byProvider = new Map<string, { provider: any; areas: Set<string>; concepts: Set<string> }>();

    areaExpenses.forEach((expense) => {
      if (!expense.providerId) return;
      const provider = providers.find(item => item.id === expense.providerId);
      if (!provider) return;

      if (!byProvider.has(expense.providerId)) {
        byProvider.set(expense.providerId, {
          provider,
          areas: new Set<string>(),
          concepts: new Set<string>(),
        });
      }

      const row = byProvider.get(expense.providerId)!;
      if (expense.area) row.areas.add(expense.area);
      if (expense.description) row.concepts.add(expense.description);
    });

    return Array.from(byProvider.values())
      .map(row => ({
        provider: row.provider,
        areas: Array.from(row.areas).sort(),
        concepts: Array.from(row.concepts).sort(),
      }))
      .sort((a, b) => providerDisplayName(a.provider).localeCompare(providerDisplayName(b.provider), 'es'));
  }, [areaExpenses, providers]);

  const canExportPayroll = isProjectAdmin || safeArray(userPermissions?.allowedCategories).some(isProductionArea);
  const hasExportOptions = isProjectAdmin || canExportPayroll;

  const exportNomina = (format: 'xlsx' | 'csv') => {
    const rows = allProjectAreaProviderRows.map(row => {
      const { Categoria, Origen, ...nominaRow } = providerExportRow(row.provider, {
        Areas: row.areas.join(', '),
      });
      return nominaRow;
    });

    if (rows.length === 0) {
      alert('No hay proveedores cargados en Gestion por Areas para exportar.');
      return;
    }

    if (format === 'csv') {
      downloadCsv(rows, `nomina_proveedores_${project?.name || 'proyecto'}.csv`);
    } else {
      downloadXlsx(rows, 'Nomina', `nomina_proveedores_${project?.name || 'proyecto'}.xlsx`);
    }
  };

  const exportMainBudget = (format: 'xlsx' | 'csv') => {
    const rows = budgetItems.map(item => ({
      Area: item.area || '',
      Proveedor: item.providerName || '',
      Descripcion: item.description || '',
      Unidad: item.unit || '',
      Cantidad: item.quantity || 0,
      'P Unitario': item.unitPrice || 0,
      Total: item.total || 0,
      Pagado: item.paid ? 'Si' : 'No',
      Orden: item.order || 0,
    }));

    if (format === 'csv') {
      downloadCsv(rows, `presupuesto_principal_${project?.name || 'proyecto'}.csv`);
    } else {
      downloadXlsx(rows, 'Presupuesto Principal', `presupuesto_principal_${project?.name || 'proyecto'}.xlsx`);
    }
  };

  const exportAreaBudget = (format: 'xlsx' | 'csv') => {
    const rows = areaExpenses.map(item => {
      const paid = (item.paymentHistory || []).reduce((acc: number, payment: any) => acc + (Number(payment.amount) || 0), 0);
      return {
        Area: item.area || '',
        Proveedor: item.providerName || '',
        Descripcion: item.description || '',
        Unidad: item.unit || '',
        Cantidad: item.quantity || 0,
        'P Unitario': item.unitPrice || 0,
        Total: item.total || 0,
        Pagado: paid,
        Deuda: (Number(item.total) || 0) - paid,
        Factura: item.invoice?.url || '',
        Actualizado: formatExportDate(item.updatedAt),
      };
    });

    if (format === 'csv') {
      downloadCsv(rows, `gestion_por_areas_${project?.name || 'proyecto'}.csv`);
    } else {
      downloadXlsx(rows, 'Gestion por Areas', `gestion_por_areas_${project?.name || 'proyecto'}.xlsx`);
    }
  };

  const addCollaborator = async (selectedUser: any) => {
    if (!id || !selectedUser?.email) return;

    const email = normalizeEmail(selectedUser.email);
    const selectedCategories = newCollaboratorRole === 'admin'
      ? categories
      : newCollaboratorCategories.length
        ? newCollaboratorCategories
        : [activeAreas[0] || categories[0]].filter(Boolean);
    const defaults = getDefaultCollaboratorPermissions(newCollaboratorRole, categories, selectedCategories);

    const newCol: Collaborator = {
      uid: selectedUser.uid || selectedUser.id,
      email,
      displayName: selectedUser.displayName || selectedUser.email,
      photoURL: selectedUser.photoURL || '',
      role: newCollaboratorRole,
      ...defaults,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, 'projects', id, 'collaborators', email), newCol);
      const newEmails = Array.from(new Set([...(project?.collaboratorEmails || []), email].map(normalizeEmail).filter(Boolean)));
      await updateDoc(doc(db, 'projects', id), {
        collaboratorEmails: newEmails,
        updatedAt: serverTimestamp(),
      });

      setCollaborators([...collaborators, { ...newCol, createdAt: new Date(), updatedAt: new Date() }]);
      setProject({ ...project, collaboratorEmails: newEmails });
      setSelectedUserToAdd(null);
      setNewCollaboratorSearch('');
      setNewCollaboratorRole('jefe_area');
      setNewCollaboratorCategories([]);
    } catch (e) {
      console.error("Error adding collaborator:", e);
      alert("Error al añadir colaborador. Verificá permisos o que el usuario exista en la plataforma.");
    }
  };

  const updateCollaboratorRole = async (col: Collaborator, role: Collaborator['role']) => {
    if (!id) return;

    const defaults = getDefaultCollaboratorPermissions(
      role,
      categories,
      col.allowedCategories?.length ? col.allowedCategories : [activeAreas[0] || categories[0]].filter(Boolean)
    );
    const updates: Partial<Collaborator> = {
      role,
      ...defaults,
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, 'projects', id, 'collaborators', normalizeEmail(col.email)), updates);
      setCollaborators(collaborators.map(c => normalizeEmail(c.email) === normalizeEmail(col.email) ? { ...c, ...updates, updatedAt: new Date() } : c));
    } catch (error) {
      console.error('Error updating collaborator role:', error);
      alert('No se pudo actualizar el rol del colaborador.');
    }
  };

  const updateCollaboratorPermissions = async (col: Collaborator, updates: Partial<Collaborator>) => {
    if (!id) return;

    try {
      const payload = { ...updates, updatedAt: serverTimestamp() };
      await updateDoc(doc(db, 'projects', id, 'collaborators', normalizeEmail(col.email)), payload);
      setCollaborators(collaborators.map(c => normalizeEmail(c.email) === normalizeEmail(col.email) ? { ...c, ...updates, updatedAt: new Date() } : c));
    } catch (error) {
      console.error('Error updating collaborator permissions:', error);
      alert('No se pudieron actualizar los permisos.');
    }
  };

  const removeCollaborator = async (col: Collaborator) => {
    if (!id || !confirm('¿Quitar acceso a ' + col.email + '?')) return;
    const email = normalizeEmail(col.email);

    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'projects', id, 'collaborators', email));
      const newEmails = (project?.collaboratorEmails || []).map(normalizeEmail).filter((item: string) => item !== email);
      batch.update(doc(db, 'projects', id), {
        collaboratorEmails: newEmails,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setCollaborators(collaborators.filter(c => normalizeEmail(c.email) !== email));
      setProject({ ...project, collaboratorEmails: newEmails });
    } catch (error) {
      console.error('Error removing collaborator:', error);
      alert('No se pudo quitar el acceso.');
    }
  };

  const handleDeleteProject = async () => {
    if (!id || !project) return;

    if (!isGlobalAdmin) {
      alert('Solo usuarios con rol global de administrador pueden borrar proyectos.');
      return;
    }

    const confirmed = window.confirm(
      `ADVERTENCIA: vas a borrar definitivamente el proyecto "${project.name}".\n\n` +
      'Se eliminará el proyecto y sus datos internos conocidos: presupuesto, gastos, pagos, equipo, colaboradores, hitos y facturas registradas. Esta acción no se puede deshacer.\n\n' +
      '¿Querés continuar?'
    );

    if (!confirmed) return;

    const typedName = window.prompt(
      `Para confirmar el borrado definitivo, escribí el nombre exacto del proyecto:\n\n${project.name}`
    );

    if (typedName !== project.name) {
      alert('Borrado cancelado: el nombre ingresado no coincide.');
      return;
    }

    setIsDeletingProject(true);
    try {
      const subcollections = [
        'collaborators',
        'budgetItems',
        'areaExpenses',
        'expenses',
        'milestones',
        'teamMembers',
        'payments',
        'invoices',
      ];

      for (const subcollection of subcollections) {
        const snap = await getDocs(collection(db, 'projects', id, subcollection));
        await Promise.all(snap.docs.map((childDoc) => deleteDoc(childDoc.ref)));
      }

      await deleteDoc(doc(db, 'projects', id));
      navigate('/proyectos');
    } catch (error) {
      console.error('Error deleting project:', error);
      alert('No se pudo borrar el proyecto. Revisá permisos o conexión.');
    } finally {
      setIsDeletingProject(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500 font-mono text-xs uppercase tracking-widest">Analizando proyecto...</div>;
  if (!project) return <div className="p-8 text-center text-slate-900 font-bold uppercase tracking-widest">Proyecto no encontrado</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <Link 
        to="/proyectos" 
        className="inline-flex items-center gap-2 text-[9px] font-bold text-slate-400 hover:text-black mb-4 transition-colors uppercase tracking-widest"
      >
        <ChevronLeft className="w-3 h-3" />
        Volver
      </Link>

      <header className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="text-[9px] text-slate-400 uppercase tracking-widest font-bold mb-1">Proyectos / {project.status}</div>
          <h1 className="text-3xl font-bold text-black">{project.name}</h1>
        </div>

        <div className="flex gap-2">
            {isProjectAdmin && (
              <button 
                onClick={() => setShowEditProjectModal(true)}
                className="px-4 py-2 border border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-colors flex items-center gap-2"
              >
                <Settings className="w-3 h-3" />
                Editar Proyecto
              </button>
            )}
            <button
              onClick={() => setShowExportModal(true)}
              disabled={!hasExportOptions}
              className="px-4 py-2 border border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={hasExportOptions ? 'Exportar reportes del proyecto' : 'No tenes reportes disponibles para exportar'}
            >
                Exportar
            </button>
        </div>
      </header>

      <nav className="flex gap-6 text-[10px] uppercase font-bold border-b border-slate-200 mb-6 overflow-x-auto scrollbar-hide">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "pb-3 border-b-2 transition-all whitespace-nowrap tracking-widest flex items-center gap-2",
              activeTab === tab.id 
                ? "border-black text-black" 
                : "border-transparent text-slate-400 hover:text-slate-600"
            )}
          >
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
      </nav>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {activeTab === 'resumen' && (
          <div className="grid grid-cols-12 gap-8">
            <div className="col-span-12 lg:col-span-8 space-y-8">
              {/* KPIs Section */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(isProjectAdmin || (userPermissions && userPermissions.allowedCategories.length > 0)) && (
                  <>
                    {isProjectAdmin ? (
                      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm group">
                        <div className="text-[10px] text-slate-400 font-bold uppercase mb-2 tracking-widest flex justify-between">
                          Presupuesto
                          <DollarSign className="w-3 h-3 opacity-20" />
                        </div>
                        <div className="text-2xl font-bold">${project.budgetTotal?.toLocaleString() || '0'}</div>
                        <div className="mt-4 text-[9px] text-slate-400 font-medium">Cliente: <span className="text-slate-900">{project.clientName || 'Sin asignar'}</span></div>
                      </div>
                    ) : (
                      userPermissions && userPermissions.allowedCategories.length > 0 && (
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                          <div className="text-[10px] text-slate-400 font-bold uppercase mb-2 tracking-widest">Presupuesto Asignado (Mis Áreas)</div>
                          <div className="text-2xl font-bold">
                            ${visibleBudgetItems.reduce((acc, curr) => acc + (curr.total || 0), 0).toLocaleString()}
                          </div>
                          <div className="mt-4 text-[9px] text-slate-400 font-medium">{userPermissions.allowedCategories.join(', ')}</div>
                        </div>
                      )
                    )}

                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                      <div className="text-[10px] text-slate-400 font-bold uppercase mb-2 tracking-widest flex justify-between">
                        Costos Reales
                        <BarChart2 className="w-3 h-3 opacity-20" />
                      </div>
                      <div className="text-2xl font-bold">${visibleBudgetItems.reduce((acc, curr) => acc + (curr.total || 0), 0).toLocaleString()}</div>
                      <div className="mt-4 h-1 bg-slate-50 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.min(100, (visibleBudgetItems.reduce((acc, curr) => acc + (curr.total || 0), 0) / (project.budgetTotal || 1)) * 100)}%` }}></div>
                      </div>
                    </div>

                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                      <div className="text-[10px] text-slate-400 font-bold uppercase mb-2 tracking-widest flex justify-between">
                        Equipo Asignado
                        <Users className="w-3 h-3 opacity-20" />
                      </div>
                      <div className="text-2xl font-bold">{visibleBudgetItems.filter(i => i.providerId).length} Proveedores</div>
                      <div className="mt-4 text-[9px] text-slate-400 font-medium">Staff activo en rubros</div>
                    </div>
                  </>
                )}
              </div>

              {/* Status and Shooting Date Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase mb-4 tracking-widest">Estado del Proyecto</h3>
                  {isProjectAdmin ? (
                    <div className="relative">
                      <select 
                        value={project.status || 'Presupuesto'}
                        onChange={async (e) => {
                          const newStatus = e.target.value;
                          await updateDoc(doc(db, 'projects', id!), { status: newStatus });
                          setProject({ ...project, status: newStatus });
                        }}
                        className={cn(
                          "w-full p-3 border rounded text-xs font-bold uppercase tracking-widest focus:outline-none appearance-none cursor-pointer pr-10 transition-colors",
                          statusColors[project.status || 'Presupuesto'] || 'bg-slate-50 border-slate-100 text-slate-900'
                        )}
                      >
                        {['Presupuesto', 'Pre Producción', 'Rodaje', 'Post', 'Aprobado'].map(s => (
                          <option key={s} value={s} className="bg-white text-slate-900">{s}</option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
                    </div>
                  ) : (
                    <div className={cn(
                      "px-4 py-3 rounded text-xs font-bold uppercase tracking-widest inline-block border",
                      statusColors[project.status || 'Presupuesto'] || 'bg-black text-white'
                    )}>
                      {project.status || 'Presupuesto'}
                    </div>
                  )}
                </div>

                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                  <div>
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase mb-4 tracking-widest">Fecha de Rodaje</h3>
                    {isProjectAdmin ? (
                      <input 
                        type="date"
                        value={project.shootingDate || ''}
                        onChange={async (e) => {
                          const newDate = e.target.value;
                          await updateDoc(doc(db, 'projects', id!), { shootingDate: newDate });
                          setProject({ ...project, shootingDate: newDate });
                        }}
                        className="w-full p-3 bg-slate-50 border border-slate-100 rounded text-xs font-medium focus:outline-none focus:border-black"
                      />
                    ) : (
                      <div className="text-xl font-bold text-slate-900 first-letter:uppercase">
                        {formatShootingDate(project.shootingDate)}
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-slate-50">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase mb-4 tracking-widest flex items-center gap-2">
                       <MapPin className="w-3 h-3" />
                       Locación
                    </h3>
                    {isProjectAdmin ? (
                      <div className="space-y-3">
                        <input 
                          type="text"
                          placeholder="Link de Google Maps o Dirección..."
                          value={project.location || ''}
                          onChange={async (e) => {
                            const newLoc = e.target.value;
                            await updateDoc(doc(db, 'projects', id!), { location: newLoc });
                            setProject({ ...project, location: newLoc });
                          }}
                          className="w-full p-3 bg-slate-50 border border-slate-100 rounded text-xs font-medium focus:outline-none focus:border-black"
                        />
                        {project.location?.startsWith('http') && (
                          <a 
                            href={project.location} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[10px] font-bold text-blue-600 flex items-center gap-1 hover:underline"
                          >
                            <LinkIcon className="w-3 h-3" /> Abrir en Maps
                          </a>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm font-medium text-slate-800">
                        {project.location ? (
                          project.location.startsWith('http') ? (
                            <a href={project.location} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-blue-600 hover:underline">
                              <LinkIcon className="w-4 h-4" /> Ver Ubicación en Maps
                            </a>
                          ) : project.location
                        ) : 'Sin locación definida'}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                  <h3 className="font-bold text-[10px] uppercase tracking-widest">Descripción del Proyecto</h3>
                </div>
                <div className="p-8 text-slate-600 leading-relaxed text-sm">
                    {project.description || 'No hay una descripción extendida registrada para esta producción audiovisual.'}
                </div>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-4 space-y-8">
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase mb-6 tracking-widest">
                  {isProjectAdmin ? 'Staff Destacado' : 'Dirección y Producción'}
                </h3>
                <div className="space-y-6">
                  {(() => {
                    const filteredStaff = (isProjectAdmin ? visibleBudgetItems : budgetItems).filter(i => {
                      if (isProjectAdmin) return i.providerId;
                      // Restrict to Direction and Production for simple collaborators
                      return i.providerId && (i.area === 'Producción' || i.area === 'Dirección');
                    });

                    if (filteredStaff.length > 0) {
                      return filteredStaff.slice(0, 5).map((item, i) => (
                        <div key={i} className="flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-bold">
                              {item.providerName?.[0]}
                            </div>
                            <div>
                              <div className="text-[10px] font-bold uppercase">{item.providerName}</div>
                              <div className="text-[10px] text-slate-400 font-medium">{item.area}</div>
                            </div>
                          </div>
                        </div>
                      ));
                    }
                    return <div className="text-center py-4 text-[10px] text-slate-300 font-bold uppercase italic">Sin staff asignado</div>;
                  })()}
                </div>
                {isProjectAdmin && (
                  <button 
                    onClick={() => setActiveTab('equipo')}
                    className="w-full mt-8 py-2.5 text-[10px] font-bold uppercase tracking-widest border border-dashed border-slate-200 rounded text-slate-400 hover:text-black hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                  >
                    Ver Listado de Equipo
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'presupuesto' && (
          <div className="space-y-6 pb-20">
            <header className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Planilla de Presupuesto</h2>
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">
                  {canEditMainBudget ? 'Categorías dinámicas y ordenables' : 'Vista restringida por rol'}
                </div>
              </div>
              <div className="flex gap-2">
                {canEditMainBudget && (
                  <div className="flex gap-1">
                    <button 
                      onClick={downloadTemplate}
                      className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2 rounded"
                      title="Descargar plantilla Excel con el formato correcto"
                    >
                      <Download className="w-3 h-3" />
                      Plantilla
                    </button>
                    <label className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2 rounded cursor-pointer relative group">
                      <Upload className="w-3 h-3" />
                      Importar Excel/CSV
                      <input type="file" accept=".csv, .xlsx, .xls" className="hidden" onChange={handleFileUpload} />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 bg-slate-900 text-white text-[10px] rounded shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all w-48 z-50">
                        <div className="font-bold mb-1 border-b border-white/20 pb-1">Columnas requeridas:</div>
                        <ul className="list-disc pl-4 space-y-1 opacity-80">
                          <li>Area</li>
                          <li>Proveedor</li>
                          <li>Descripción</li>
                          <li>Cantidad</li>
                          <li>P Unitario</li>
                        </ul>
                      </div>
                    </label>
                  </div>
                )}
                {canEditMainBudget && (
                  <button 
                    onClick={addCategory}
                    className="px-4 py-2 bg-black text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2 rounded"
                  >
                    <Plus className="w-3 h-3" />
                    Nueva Categoría
                  </button>
                )}
              </div>
            </header>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
              <div className="min-w-[1000px]">
                {/* Header Row */}
                <div className="grid grid-cols-12 bg-slate-50 border-b border-slate-200 px-4 py-3">
                  <div className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Proveedor / Profesional</div>
                  <div className="col-span-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Descripción / Tarea</div>
                  <div className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">P. Unitario</div>
                  <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Cant.</div>
                  <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Total</div>
                  <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Pagado</div>
                  <div className="col-span-2"></div>
                </div>

                <DragDropContext onDragEnd={canEditMainBudget ? onDragEnd : () => {}}>
                  <Droppable droppableId="all-categories" type="category">
                    {(provided) => (
                      <div {...provided.droppableProps} ref={provided.innerRef}>
                        {visibleCategories.map((area, areaIndex) => {
                          const areaItems = visibleBudgetItems
                            .filter(i => i.area === area)
                            .sort((a, b) => (a.order || 0) - (b.order || 0));
                          const isCollapsed = collapsedCategories[area];
                          const areaTotal = areaItems.reduce((acc, curr) => acc + (curr.total || 0), 0);

                          const DraggableComponent = Draggable as any;
                          return (
                            <DraggableComponent key={area} draggableId={area} index={areaIndex} isDragDisabled={!canEditMainBudget}>
                              {(provided: any) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  className="border-b border-slate-100 last:border-0"
                                >
                                  {/* Category Row */}
                                  <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between group border-l-4 border-emerald-400 shadow-sm">
                                    <div className="flex items-center gap-4 flex-1">
                                      <div {...provided.dragHandleProps} className={cn("text-slate-300", canEditMainBudget ? "hover:text-slate-500 cursor-grab active:cursor-grabbing" : "opacity-30")}>
                                        <GripVertical className="w-4 h-4" />
                                      </div>
                                      <button 
                                        onClick={() => toggleCategory(area)}
                                        className="p-1 text-slate-300 hover:text-white transition-colors"
                                      >
                                        {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                      </button>
                                      <span 
                                        className={cn(
                                          "text-[12px] font-black uppercase tracking-[0.18em] text-white",
                                          canEditMainBudget && "cursor-pointer hover:underline"
                                        )}
                                        onClick={() => canEditMainBudget && renameCategory(area)}
                                        title={canEditMainBudget ? "Click para renombrar" : ""}
                                      >
                                        {area}
                                      </span>
                                      <span className="text-[10px] text-slate-300 font-bold">({areaItems.length} ítems)</span>
                                    </div>
                                    
                                    <div className="flex items-center gap-6">
                                      <div className="text-[10px] font-black tracking-widest text-emerald-300">
                                        SUBTOTAL: ${areaTotal.toLocaleString()}
                                      </div>
                                      <div className="flex items-center gap-1">
                                        {canEditMainBudget && (
                                        <button 
                                          onClick={() => addEmptyRow(area)}
                                          className="p-1.5 text-slate-400 hover:text-black transition-colors bg-white border border-slate-200 rounded"
                                          title="Agregar ítem"
                                        >
                                          <Plus className="w-3.5 h-3.5" />
                                        </button>
                                        )}
                                        {canEditMainBudget && (
                                          <button 
                                            onClick={() => deleteCategory(area)}
                                            className="p-1.5 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                            title="Eliminar categoría"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Draggable Items List */}
                                  {!isCollapsed && (
                                    <Droppable droppableId={area} type="item">
                                      {(provided) => (
                                        <div
                                          {...provided.droppableProps}
                                          ref={provided.innerRef}
                                          className="min-h-[10px]"
                                        >
                                          {areaItems.map((item, index) => {
                                            const DraggableComponent = Draggable as any;
                                            return (
                                              <DraggableComponent key={item.id} draggableId={item.id} index={index}>
                                                {(provided: any, snapshot: any) => (
                                                  <div
                                                    ref={provided.innerRef}
                                                    {...provided.draggableProps}
                                                    className={cn(
                                                      "grid grid-cols-12 px-4 py-2 items-center border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors",
                                                      snapshot.isDragging && "bg-slate-50 shadow-xl border-y border-slate-200 rounded-lg relative z-50"
                                                    )}
                                                  >
                                                    <div className="col-span-12 flex items-center">
                                                      <div {...provided.dragHandleProps} className={cn("mr-2 text-slate-300", canEditMainBudget ? "hover:text-slate-500 cursor-grab active:cursor-grabbing" : "opacity-30")}>
                                                        <GripVertical className="w-4 h-4" />
                                                      </div>
                                                      <div className="grid grid-cols-12 w-full items-center">
                                                        <div className="col-span-2">
                                                          <BudgetRowCell 
                                                            item={item} 
                                                            providers={providers} 
                                                            onUpdate={updateBudgetItem} 
                                                            onDelete={deleteBudgetItem} 
                                                            type="provider"
                                                            disabled={!canEditMainBudget}
                                                          />
                                                        </div>
                                                        <div className="col-span-3">
                                                          <BudgetRowCell 
                                                            item={item} 
                                                            onUpdate={updateBudgetItem} 
                                                            type="description"
                                                            disabled={!canEditMainBudget}
                                                          />
                                                        </div>
                                                        <div className="col-span-2">
                                                          <BudgetRowCell 
                                                            item={item} 
                                                            onUpdate={updateBudgetItem} 
                                                            type="price"
                                                            disabled={!canEditMainBudget}
                                                          />
                                                        </div>
                                                        <div className="col-span-1 text-center font-mono">
                                                          <BudgetRowCell 
                                                            item={item} 
                                                            onUpdate={updateBudgetItem} 
                                                            type="quantity"
                                                            disabled={!canEditMainBudget}
                                                          />
                                                        </div>
                                                        <div className="col-span-1 text-right font-bold text-slate-900 text-xs">
                                                          ${item.total?.toLocaleString()}
                                                        </div>
                                                        <div className="col-span-1">
                                                          <BudgetRowCell 
                                                            item={item} 
                                                            onUpdate={updateBudgetItem} 
                                                            type="paid"
                                                            disabledPayment={activeAreas.includes(item.area)}
                                                            onManagePayment={(item) => openPaymentModal(item, 'budgetItems')}
                                                            disabled={!canEditMainBudget}
                                                          />
                                                        </div>
                                                        <div className="col-span-2 text-right">
                                                          {canEditMainBudget && (
                                                          <button 
                                                            onClick={() => deleteBudgetItem(item.id)}
                                                            className="p-1 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all font-bold text-[10px] uppercase underline"
                                                          >
                                                            Eliminar
                                                          </button>
                                                          )}
                                                        </div>
                                                      </div>
                                                    </div>
                                                  </div>
                                                )}
                                              </DraggableComponent>
                                            );
                                          })}
                                          {provided.placeholder}
                                        </div>
                                      )}
                                    </Droppable>
                                  )}
                                </div>
                              )}
                            </DraggableComponent>
                          );
                        })}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>

                {/* Footer Total Row */}
                <div className="grid grid-cols-12 bg-slate-900 text-white px-4 py-5 items-center">
                  <div className="col-span-9 text-right text-[11px] font-bold uppercase tracking-widest text-slate-400">Total presupuesto del proyecto</div>
                  <div className="col-span-2 text-right text-xl font-bold font-mono">
                    ${visibleBudgetItems.reduce((acc, curr) => acc + (curr.total || 0), 0).toLocaleString()}
                  </div>
                  <div className="col-span-1"></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'areas' && (
          <div className="space-y-6 pb-20">
            <header className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Gestión por Áreas</h2>
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">
                  Control de gastos y saldos por especialidad
                </div>
              </div>
              {isProjectAdmin && (
                <div className="relative" ref={areaSelectorRef}>
                  <button 
                    onClick={() => setIsAreaSelectorOpen(!isAreaSelectorOpen)}
                    className="px-4 py-2 bg-black text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2 rounded"
                  >
                    <Plus className="w-3 h-3" />
                    {isAreaSelectorOpen ? 'Cancelar' : 'Activar Nueva Área'}
                  </button>
 
                  {isAreaSelectorOpen && (
                    <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-[110] p-2 max-h-80 overflow-y-auto">
                      <div className="text-[9px] font-black uppercase text-slate-400 tracking-widest px-3 py-2 border-b border-slate-50 mb-2">Selecciona un área</div>
                      {categories.filter(c => !activeAreas.includes(c)).length === 0 ? (
                        <div className="text-[10px] text-slate-400 p-4 text-center">No hay más áreas para activar</div>
                      ) : (
                        categories
                          .filter(c => !activeAreas.includes(c))
                          .map(area => (
                            <button
                              key={area}
                              onClick={() => {
                                addActiveArea(area);
                                setIsAreaSelectorOpen(false);
                              }}
                              className="w-full text-left px-4 py-2 text-[10px] uppercase font-bold tracking-widest hover:bg-slate-50 rounded transition-colors"
                            >
                              {area}
                            </button>
                          ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </header>

            {/* Sub-tabs for Active Areas */}
            <div className="flex gap-2 p-1 bg-slate-100 rounded-lg overflow-x-auto scrollbar-hide">
              {visibleCategories.map((area) => (
                <button
                  key={area}
                  onClick={() => setActiveAreaTab(area)}
                  className={cn(
                    "px-4 py-2 text-[10px] uppercase font-bold tracking-widest rounded-md transition-all whitespace-nowrap",
                    selectedAreaTab === area
                      ? "bg-white text-black shadow-sm"
                      : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  {area}
                </button>
              ))}
              {activeAreas.length === 0 && (
                <div className="px-4 py-2 text-[10px] text-slate-400 uppercase font-bold tracking-widest">
                  No hay áreas activas para gestión
                </div>
              )}
            </div>

            {selectedAreaTab && activeAreas.includes(selectedAreaTab) && (
              <div className="space-y-6">
                {/* Summary Header */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(() => {
                    const assigned = budgetItems
                      .filter(i => i.area === selectedAreaTab)
                      .reduce((acc, curr) => acc + (curr.total || 0), 0);
                    const spent = areaExpenses
                      .filter(i => i.area === selectedAreaTab)
                      .reduce((acc, curr) => acc + (curr.total || 0), 0);
                    const balance = assigned - spent;
                    const usedPercent = assigned > 0 ? Math.min(100, (spent / assigned) * 100) : 0;

                    return (
                      <>
                        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Presupuesto Asignado</div>
                          <div className="text-2xl font-bold text-slate-900">${assigned.toLocaleString()}</div>
                          <div className="text-[9px] text-slate-400 mt-2 italic">Tomado del Presupuesto Principal</div>
                        </div>
                        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Gastos Realizados</div>
                          <div className="text-2xl font-bold text-emerald-600">${spent.toLocaleString()}</div>
                          <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={cn("h-full rounded-full", balance < 0 ? "bg-red-500" : usedPercent >= 85 ? "bg-yellow-400" : "bg-emerald-500")}
                              style={{ width: `${usedPercent}%` }}
                            />
                          </div>
                          <div className="text-[9px] text-slate-400 mt-2 italic">{areaExpenses.filter(i => i.area === selectedAreaTab).length} registros</div>
                        </div>
                        <div className={cn(
                          "p-5 rounded-xl shadow-sm border",
                          balance >= 0 ? "bg-slate-900 border-slate-900 text-white" : "bg-red-50 border-red-100 text-red-600"
                        )}>
                          <div className={cn("text-[10px] font-bold uppercase tracking-widest mb-1", balance >= 0 ? "text-slate-400" : "text-red-400")}>Saldo Disponible</div>
                          <div className="text-2xl font-bold font-mono tracking-tight">${balance.toLocaleString()}</div>
                          {balance < 0 && <div className="text-[9px] font-bold uppercase mt-2">¡EXCEDIDO!</div>}
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                  <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center rounded-t-xl">
                    <div className="flex items-center gap-4">
                       <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
                         <LayoutGrid className="w-3 h-3" />
                         Carga de Gastos: {selectedAreaTab}
                       </h3>
                       {isProjectAdmin && (
                         <button 
                           onClick={() => removeActiveArea(selectedAreaTab)}
                           className="text-[9px] text-slate-400 hover:text-red-500 font-bold uppercase tracking-widest transition-colors"
                           title="Desactivar gestión de esta área"
                         >
                           Desactivar Gestión
                         </button>
                       )}
                    </div>
                    <button 
                      onClick={() => addAreaExpense(selectedAreaTab)}
                      disabled={!canEditArea(selectedAreaTab)}
                      className="px-3 py-1.5 bg-black text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2 rounded disabled:bg-slate-300 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-3 h-3" />
                      Registrar Gasto
                    </button>
                  </div>
                  
                  <div className="min-w-[800px]">
                    <div className="grid grid-cols-12 bg-slate-50 border-b border-slate-200 px-6 py-3">
                      <div className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Proveedor / Concepto</div>
                      <div className="col-span-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Descripción Detallada</div>
                      <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Factura</div>
                      <div className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">P. Unitario</div>
                      <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Cant.</div>
                      <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Total</div>
                      <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Pagado</div>
                      <div className="col-span-1"></div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {areaExpenses
                        .filter(item => item.area === selectedAreaTab)
                        .sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0)) // Newest first
                        .map((item) => (
                          <div
                            key={item.id}
                            onDragEnter={(event) => {
                              event.preventDefault();
                              if (canUploadAreaFiles(item.area)) setDragOverExpenseId(item.id);
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = canUploadAreaFiles(item.area) ? 'copy' : 'none';
                              if (canUploadAreaFiles(item.area)) setDragOverExpenseId(item.id);
                            }}
                            onDragLeave={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                                setDragOverExpenseId(null);
                              }
                            }}
                            onDrop={(event) => canUploadAreaFiles(item.area) && handleInvoiceDrop(event, item)}
                            className={cn(
                              "relative grid grid-cols-12 px-6 py-3 items-center transition-colors group",
                              dragOverExpenseId === item.id
                                ? "bg-emerald-50 ring-2 ring-inset ring-emerald-400"
                                : "hover:bg-slate-50"
                            )}
                          >
                            {dragOverExpenseId === item.id && (
                              <div className="absolute inset-0 z-20 bg-emerald-50/90 border border-emerald-200 flex items-center justify-center pointer-events-none">
                                <div className="px-4 py-2 rounded bg-white border border-emerald-100 shadow-sm text-[10px] font-black uppercase tracking-widest text-emerald-700 flex items-center gap-2">
                                  <Paperclip className="w-3.5 h-3.5" />
                                  Soltar PDF para adjuntar factura
                                </div>
                              </div>
                            )}
                            <div className="col-span-2">
                              <BudgetRowCell 
                                item={item} 
                                providers={providers} 
                                onUpdate={updateAreaExpense} 
                                onDelete={deleteAreaExpense} 
                                type="provider"
                                disabled={!canEditArea(item.area)}
                              />
                            </div>
                            <div className="col-span-3">
                              <BudgetRowCell 
                                item={item} 
                                onUpdate={updateAreaExpense} 
                                type="description"
                                disabled={!canEditArea(item.area)}
                              />
                            </div>
                            <div className="col-span-1 flex justify-center">
                              <div className="flex items-center justify-center gap-1">
                                {item.invoice?.url ? (
                                  <>
                                    <a
                                      href={item.invoice.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="w-7 h-7 rounded border border-emerald-100 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-all flex items-center justify-center"
                                      title={item.invoice.fileName || 'Ver factura'}
                                    >
                                      <FileText className="w-3.5 h-3.5" />
                                    </a>
                                    {canUploadAreaFiles(item.area) && (
                                      <button
                                        type="button"
                                        disabled={!!uploadingInvoices[item.id]}
                                        onClick={() => removeInvoiceFromExpense(item)}
                                        className="w-7 h-7 rounded border border-slate-100 bg-white text-slate-300 hover:text-red-500 hover:border-red-100 transition-all flex items-center justify-center"
                                        title="Quitar factura"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-300">Sin PDF</span>
                                )}
                                {canUploadAreaFiles(item.area) && (
                                <label
                                  className={cn(
                                    "w-7 h-7 rounded border transition-all flex items-center justify-center cursor-pointer",
                                    uploadingInvoices[item.id]
                                      ? "bg-slate-100 border-slate-200 text-slate-300 cursor-wait"
                                      : "bg-white border-slate-200 text-slate-400 hover:text-black hover:border-black"
                                  )}
                                  title={item.invoice?.url ? 'Reemplazar factura PDF' : 'Adjuntar factura PDF'}
                                >
                                  <Paperclip className="w-3.5 h-3.5" />
                                  <input
                                    type="file"
                                    accept="application/pdf,.pdf"
                                    className="hidden"
                                    disabled={!!uploadingInvoices[item.id]}
                                    onChange={(event) => {
                                      const file = event.target.files?.[0];
                                      uploadInvoiceForExpense(item, file);
                                      event.target.value = '';
                                    }}
                                  />
                                </label>
                                )}
                              </div>
                            </div>
                            <div className="col-span-2">
                              <BudgetRowCell 
                                item={item} 
                                onUpdate={updateAreaExpense} 
                                type="price"
                                disabled={!canEditArea(item.area)}
                              />
                            </div>
                            <div className="col-span-1">
                              <BudgetRowCell 
                                item={item} 
                                onUpdate={updateAreaExpense} 
                                type="quantity"
                                disabled={!canEditArea(item.area)}
                              />
                            </div>
                            <div className="col-span-1 text-right font-bold text-slate-900 text-xs">
                              ${item.total?.toLocaleString()}
                            </div>
                            <div className="col-span-1">
                               <BudgetRowCell 
                                 item={item} 
                                 onUpdate={updateAreaExpense} 
                                 type="paid"
                                 onManagePayment={(item) => openPaymentModal(item, 'areaExpenses')}
                                 disabledPayment={!canEditArea(item.area)}
                               />
                            </div>
                            <div className="col-span-1 text-right">
                               {canEditArea(item.area) && (
                                 <button 
                                   onClick={() => deleteAreaExpense(item.id)}
                                   className="p-1 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                 >
                                   <Trash2 className="w-3.5 h-3.5" />
                                 </button>
                               )}
                            </div>
                          </div>
                        ))}
                      {areaExpenses.filter(item => item.area === selectedAreaTab).length === 0 && (
                        <div className="p-12 text-center text-slate-300 font-bold uppercase tracking-widest text-[10px] italic">
                          Sin gastos registrados en esta área
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'proveedores' && (
          <div className="space-y-6 pb-20">
            <header>
              <h2 className="text-xl font-bold text-slate-900">Proveedores del Proyecto</h2>
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">
                Proveedores cargados en Gestion por Areas
              </p>
            </header>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Tipo</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Proveedor</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">DNI</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">CUIT</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Categoria</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Contacto</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Areas</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Domicilio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {projectAreaProviderRows.map(({ provider, areas }) => {
                    const inferred = inferLegacyIdentifiers(provider);
                    const category = provider.category === 'Otra'
                      ? `Otra: ${provider.categoryOther || '-'}`
                      : provider.category || 'Sin categoria';

                    return (
                      <tr key={provider.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-4 text-xs font-bold uppercase tracking-widest text-slate-400">
                          {provider.type === 'empresa' ? 'Empresa' : 'Persona'}
                        </td>
                        <td className="px-5 py-4">
                          <div className="text-sm font-bold text-slate-900">{providerDisplayName(provider)}</div>
                          <div className="text-[10px] text-slate-400 font-medium">{provider.source === 'provider_invite' ? 'Alta por link' : 'Carga interna'}</div>
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-600 font-medium whitespace-nowrap">
                          {formatIdentifier(provider.dni || inferred.dniNormalized) || '-'}
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-600 font-medium whitespace-nowrap">
                          {formatIdentifier(provider.cuit || inferred.cuitNormalized) || '-'}
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-500">{category}</td>
                        <td className="px-5 py-4 text-xs text-slate-500">
                          <div>{provider.email || provider.adminEmail || '-'}</div>
                          <div className="text-slate-400">{provider.phone || '-'}</div>
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-500 max-w-[180px]">
                          {areas.join(', ') || '-'}
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-500 max-w-[220px] truncate">{provider.address || '-'}</td>
                      </tr>
                    );
                  })}
                  {projectAreaProviderRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-[10px] font-bold uppercase text-slate-300 tracking-widest italic">
                        No hay proveedores cargados en Gestion por Areas
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'saldos' && (
          <div className="space-y-6 pb-20">
            <header>
              <h2 className="text-xl font-bold text-slate-900">Estado de Saldos y Deudas</h2>
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">
                {isProjectAdmin ? 'Resumen de pagos realizados y pendientes por proveedor' : 'Resumen limitado a tus areas asignadas'}
              </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Presupuestado</div>
                <div className="text-2xl font-bold text-slate-900">${providerSaldos.reduce((acc, s) => acc + s.budgeted, 0).toLocaleString()}</div>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Gastado (Facturado)</div>
                <div className="text-2xl font-bold text-slate-900">${providerSaldos.reduce((acc, s) => acc + s.spent, 0).toLocaleString()}</div>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 text-emerald-600">Total Pagado</div>
                <div className="text-2xl font-bold text-emerald-600">${providerSaldos.reduce((acc, s) => acc + s.paid, 0).toLocaleString()}</div>
              </div>
              <div className="bg-slate-900 p-5 rounded-xl border border-slate-900 shadow-sm text-white">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Deuda Pendiente</div>
                <div className="text-2xl font-bold font-mono">${providerSaldos.reduce((acc, s) => acc + s.debt, 0).toLocaleString()}</div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
               <table className="w-full text-left">
                 <thead>
                   <tr className="bg-slate-50 border-b border-slate-200">
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Proveedor</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">CBU / Cuenta</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Presupuesto</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Gastado</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Pagado</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Saldo Deudor</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100">
                   {providerSaldosByArea.map((group) => (
                     <React.Fragment key={group.area}>
                       <tr className="bg-slate-100/70">
                         <td colSpan={6} className="px-6 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                           {group.area}
                         </td>
                       </tr>
                       {group.rows.map((saldo) => (
                         <tr key={saldo.id} className="hover:bg-slate-50/50 transition-colors group">
                           <td className="px-6 py-4">
                             <div className="text-xs font-bold text-slate-900 uppercase">{saldo.name}</div>
                           </td>
                           <td className="px-6 py-4">
                             <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-2 py-1 rounded inline-block border border-slate-100">
                               {saldo.cbu}
                             </div>
                           </td>
                           <td className="px-6 py-4 text-right text-xs font-medium text-slate-400">
                             ${saldo.budgeted.toLocaleString()}
                           </td>
                           <td className="px-6 py-4 text-right text-xs font-medium text-slate-600">
                             ${saldo.spent.toLocaleString()}
                           </td>
                           <td className="px-6 py-4 text-right text-xs font-medium text-emerald-600">
                             ${saldo.paid.toLocaleString()}
                           </td>
                           <td className="px-6 py-4 text-right">
                             <div className={cn(
                               "text-sm font-bold font-mono",
                               saldo.debt > 0 ? "text-rose-600" : "text-emerald-600"
                             )}>
                               ${saldo.debt.toLocaleString()}
                             </div>
                           </td>
                         </tr>
                       ))}
                     </React.Fragment>
                   ))}
                   {providerSaldos.length === 0 && (
                     <tr>
                       <td colSpan={6} className="px-6 py-12 text-center text-[10px] font-bold uppercase text-slate-300 tracking-widest italic">
                         No hay movimientos financieros con proveedores registrados
                       </td>
                     </tr>
                   )}
                 </tbody>
               </table>
            </div>

            <div className="p-6 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-blue-600 shadow-sm">
                <Info className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-blue-900 uppercase tracking-widest mb-1">Sobre el cálculo de deudas</h4>
                <p className="text-xs text-blue-700 leading-relaxed max-w-2xl">
                  El "Saldo Deudor" se calcula restando lo marcado como <b>Pagado</b> del total <b>Gastado</b> (registrado en la pestaña Áreas). 
                  Para actualizar el estado de pago, dirígete a la pestaña <b>Áreas</b> y activa el check de Pago en cada registro.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'equipo' && (
          <div className="space-y-12">
            <header className="flex justify-between items-center">
              <div className="space-y-1">
                <h2 className="text-xl font-bold text-slate-900">Equipo de Trabajo</h2>
                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">
                  Producción y Staff de Producción por rubro
                </p>
              </div>
            </header>

            {/* Equipo de Producción */}
            <section className="space-y-6">
              <div className="flex items-center gap-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 underline decoration-slate-200 underline-offset-8">Dirección y Producción</h3>
                <div className="h-[1px] bg-slate-100 flex-1"></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Dueño / Creador */}
                <div className="bg-white border-2 border-slate-900 p-5 rounded-xl shadow-sm flex items-center justify-between group hover:shadow-md transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-slate-900 text-white rounded-full flex items-center justify-center font-bold text-xs uppercase">
                      {project.createdByEmail?.[0] || 'D'}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 truncate max-w-[150px]">{project.createdByEmail || 'Director / Productor'}</div>
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Creador / Responsable</div>
                    </div>
                  </div>
                  <Shield className="w-4 h-4 text-slate-900" />
                </div>

                {/* Colaboradores */}
                {collaborators.map((col) => (
                  <div key={col.email} className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm flex items-center justify-between group hover:border-black transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-slate-100 text-slate-900 rounded-full flex items-center justify-center font-bold text-xs uppercase">
                        {col.email[0]}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900 truncate max-w-[150px]">{col.email}</div>
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                          {roleLabels[col.role] || 'Colaborador'}
                        </div>
                      </div>
                    </div>
                    {col.role === 'admin' ? (
                      <Shield className="w-4 h-4 text-emerald-500" />
                    ) : col.role === 'jefe_area' ? (
                      <LayoutGrid className="w-4 h-4 text-blue-500" />
                    ) : (
                      <Users className="w-4 h-4 text-slate-300" />
                    )}
                  </div>
                ))}

                {/* Tomas @ Gran Berta fallback */}
                {!collaborators.find(c => c.email === 'tomas@granberta.com') && project.createdByEmail !== 'tomas@granberta.com' && (
                  <div className="bg-slate-50 border border-dashed border-slate-200 p-5 rounded-xl flex items-center justify-between opacity-50">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-slate-200 text-slate-400 rounded-full flex items-center justify-center font-bold text-xs uppercase">T</div>
                      <div>
                        <div className="text-xs font-bold text-slate-400 truncate">tomas@granberta.com</div>
                        <div className="text-[9px] font-bold text-slate-300 uppercase tracking-widest italic">Por invitar</div>
                      </div>
                    </div>
                    <UserPlus className="w-4 h-4 text-slate-200" />
                  </div>
                )}
              </div>
            </section>

            {/* Personal de Rubros */}
            <section className="space-y-8">
              <div className="flex items-center gap-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 underline decoration-slate-200 underline-offset-8">Personal de Rubros</h3>
                <div className="h-[1px] bg-slate-100 flex-1"></div>
              </div>
              {visibleCategories.map(area => {
                const areaTeam = visibleBudgetItems.filter(i => i.area === area && (i.providerId || i.providerName));
                if (areaTeam.length === 0) return null;

                return (
                  <div key={area} className="space-y-4 px-4">
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-300">{area}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {areaTeam.map((member) => (
                        <div key={member.id} className="bg-white border border-slate-100 p-4 rounded-xl shadow-sm flex items-center justify-between group hover:border-slate-300 transition-all">
                          <div className="flex items-center gap-4">
                            <div className="w-8 h-8 bg-slate-50 text-slate-900 rounded-full flex items-center justify-center font-bold text-[10px] uppercase border border-slate-100">
                              {member.providerName?.[0] || 'P'}
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-900">{member.providerName || 'Sin asignar'}</div>
                              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{member.description || 'Staff'}</div>
                            </div>
                          </div>
                          <div className="text-right">
                             <div className="text-[9px] font-bold text-emerald-600">${member.total?.toLocaleString()}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
        )}

        {activeTab === 'permisos' && isProjectAdmin && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-8">
            <div className="max-w-5xl mx-auto space-y-12">
              <header className="text-center">
                <Shield className="w-12 h-12 text-slate-900 mx-auto mb-4" />
                <h2 className="text-xl font-bold mb-2">Permisos del Proyecto</h2>
                <p className="text-sm text-slate-500 max-w-2xl mx-auto">
                  Agregá usuarios que ya se hayan logueado en la plataforma y definí si son admins del proyecto, jefes de área, colaboradores o lectores. Esto no cambia su rol global en la app.
                </p>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 bg-slate-50 border border-slate-100 rounded-2xl">
                <div className="lg:col-span-5 space-y-4">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Buscar usuario logueado</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                    <input
                      value={newCollaboratorSearch}
                      onChange={(event) => {
                        setNewCollaboratorSearch(event.target.value);
                        setSelectedUserToAdd(null);
                      }}
                      placeholder="Nombre o email..."
                      className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded text-sm focus:border-black focus:outline-none transition-all"
                    />
                  </div>

                  <div className="max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {filteredAvailableUsers.length === 0 ? (
                      <div className="p-5 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                        {availableUsers.length === 0 ? 'No hay usuarios disponibles' : 'Sin resultados'}
                      </div>
                    ) : filteredAvailableUsers.map((candidate) => {
                      const candidateEmail = normalizeEmail(candidate.email);
                      const selected = normalizeEmail(selectedUserToAdd?.email) === candidateEmail;
                      return (
                        <button
                          key={candidate.uid || candidate.id || candidateEmail}
                          type="button"
                          onClick={() => setSelectedUserToAdd(candidate)}
                          className={cn(
                            "w-full text-left px-4 py-3 transition-all flex items-center gap-3",
                            selected ? "bg-black text-white" : "hover:bg-slate-50 text-slate-700"
                          )}
                        >
                          <img
                            src={candidate.photoURL || `https://ui-avatars.com/api/?name=${candidate.displayName || candidate.email || 'U'}&background=000&color=fff`}
                            alt="Avatar"
                            className="w-8 h-8 rounded-full border border-white/30"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{candidate.displayName || candidate.email}</div>
                            <div className={cn("text-[10px] truncate", selected ? "text-white/60" : "text-slate-400")}>{candidate.email}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="lg:col-span-7 space-y-5">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Rol dentro del proyecto</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {(['admin', 'jefe_area', 'colaborador', 'lector'] as Collaborator['role'][]).map((role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => setNewCollaboratorRole(role)}
                          className={cn(
                            "px-3 py-2 rounded border text-[9px] font-bold uppercase tracking-widest transition-all",
                            newCollaboratorRole === role ? "bg-black text-white border-black" : "bg-white border-slate-200 text-slate-400 hover:text-black hover:border-black"
                          )}
                        >
                          {roleLabels[role]}
                        </button>
                      ))}
                    </div>
                    {newCollaboratorRole === 'admin' && (
                      <p className="text-[10px] text-slate-500 mt-2">
                        Admin de proyecto: puede gestionar este proyecto y sus permisos, pero no pasa a ser admin global de la app.
                      </p>
                    )}
                  </div>

                  {newCollaboratorRole !== 'admin' && (
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Áreas del presupuesto asignadas</div>
                      <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1">
                        {categories.map((cat) => {
                          const selected = newCollaboratorCategories.includes(cat);
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setNewCollaboratorCategories(selected ? newCollaboratorCategories.filter(item => item !== cat) : [...newCollaboratorCategories, cat])}
                              className={cn(
                                "px-3 py-1.5 rounded text-[10px] font-bold uppercase transition-all tracking-tight",
                                selected ? "bg-emerald-500 text-white" : "bg-white border border-slate-200 text-slate-400 hover:border-emerald-500 hover:text-emerald-500"
                              )}
                            >
                              {cat}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-2">Si no elegís ninguna, se asigna la primera área activa/disponible.</p>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={!selectedUserToAdd}
                    onClick={() => selectedUserToAdd && addCollaborator(selectedUserToAdd)}
                    className="w-full px-6 py-3 bg-black text-white rounded text-xs font-bold uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  >
                    <UserPlus className="w-4 h-4" />
                    Agregar al Proyecto
                  </button>
                </div>
              </div>

              <div className="pt-8 border-t border-slate-100">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6 font-mono">Colaboradores Activos</h3>
                <div className="space-y-4">
                  {collaborators.length === 0 ? (
                    <div className="text-center py-10 border border-dashed border-slate-200 rounded-lg text-slate-300 font-bold uppercase text-[10px] tracking-widest">
                      No hay colaboradores externos en este proyecto
                    </div>
                  ) : (
                    collaborators.map(col => (
                      <div key={col.email} className="p-6 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4 mb-8">
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={col.photoURL || `https://ui-avatars.com/api/?name=${col.displayName || col.email || 'U'}&background=000&color=fff`}
                              alt="Avatar"
                              className="w-10 h-10 rounded-full border border-slate-200"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-bold truncate">{col.displayName || col.email}</div>
                              <div className="text-[10px] text-slate-400 font-medium truncate">{col.email}</div>
                              <div className="text-[9px] text-slate-400 font-bold uppercase mt-1">{roleLabels[col.role] || 'Colaborador'}</div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 items-center justify-end">
                            <div className="flex gap-1 bg-white p-1 rounded border border-slate-200">
                              {(['admin', 'jefe_area', 'colaborador', 'lector'] as Collaborator['role'][]).map((role) => (
                                <button
                                  key={role}
                                  onClick={() => updateCollaboratorRole(col, role)}
                                  className={cn(
                                    "px-2 py-1 text-[8px] font-bold uppercase tracking-widest rounded transition-all",
                                    col.role === role ? "bg-black text-white" : "text-slate-400 hover:text-black"
                                  )}
                                >
                                  {role === 'jefe_area' ? 'Jefe' : role}
                                </button>
                              ))}
                            </div>
                            <button
                              className="text-[10px] text-red-500 font-bold uppercase tracking-widest hover:underline"
                              onClick={() => removeCollaborator(col)}
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>

                        {col.role !== 'admin' ? (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <div>
                              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 font-mono">Pestañas Permitidas</div>
                              <div className="flex flex-wrap gap-2">
                                {tabs.filter(t => t.id !== 'permisos').map(tab => {
                                  const enabled = safeArray(col.allowedTabs).includes(tab.id);
                                  return (
                                    <button
                                      key={tab.id}
                                      onClick={() => {
                                        const next = enabled
                                          ? safeArray(col.allowedTabs).filter(tabId => tabId !== tab.id)
                                          : [...safeArray(col.allowedTabs), tab.id];
                                        updateCollaboratorPermissions(col, { allowedTabs: next });
                                      }}
                                      className={cn(
                                        "px-3 py-1.5 rounded text-[10px] font-bold uppercase transition-all tracking-tight",
                                        enabled ? "bg-black text-white" : "bg-white border border-slate-200 text-slate-400 hover:border-black hover:text-black"
                                      )}
                                    >
                                      {tab.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div>
                              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 font-mono">Áreas de Presupuesto</div>
                              <div className="flex flex-wrap gap-2">
                                {categories.map(cat => {
                                  const enabled = safeArray(col.allowedCategories).includes(cat);
                                  return (
                                    <button
                                      key={cat}
                                      onClick={() => {
                                        const next = enabled
                                          ? safeArray(col.allowedCategories).filter(item => item !== cat)
                                          : [...safeArray(col.allowedCategories), cat];
                                        updateCollaboratorPermissions(col, { allowedCategories: next });
                                      }}
                                      className={cn(
                                        "px-3 py-1.5 rounded text-[10px] font-bold uppercase transition-all tracking-tight",
                                        enabled ? "bg-emerald-500 text-white" : "bg-white border border-slate-200 text-slate-400 hover:border-emerald-500 hover:text-emerald-500"
                                      )}
                                    >
                                      {cat}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="lg:col-span-2 flex flex-wrap gap-2 pt-2">
                              <button
                                onClick={() => updateCollaboratorPermissions(col, { canEditBudgetAreas: !col.canEditBudgetAreas })}
                                className={cn(
                                  "px-3 py-2 rounded text-[10px] font-bold uppercase tracking-widest border transition-all",
                                  col.canEditBudgetAreas ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-400 border-slate-200 hover:border-blue-600 hover:text-blue-600"
                                )}
                              >
                                {col.canEditBudgetAreas ? 'Puede editar áreas' : 'Solo lectura en áreas'}
                              </button>
                              <button
                                onClick={() => updateCollaboratorPermissions(col, { canViewBudgetTotals: !col.canViewBudgetTotals })}
                                className={cn(
                                  "px-3 py-2 rounded text-[10px] font-bold uppercase tracking-widest border transition-all",
                                  col.canViewBudgetTotals ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-400 border-slate-200 hover:border-slate-900 hover:text-slate-900"
                                )}
                              >
                                {col.canViewBudgetTotals ? 'Ve totales' : 'Totales restringidos'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="px-4 py-3 bg-white rounded border border-slate-200 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Tiene acceso completo al proyecto. No es admin global de la app.
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}


        {(activeTab !== 'resumen' && activeTab !== 'presupuesto' && activeTab !== 'equipo' && activeTab !== 'areas' && activeTab !== 'saldos' && activeTab !== 'proveedores' && activeTab !== 'permisos') && (
           <div className="py-32 text-center border border-dashed border-slate-200 rounded-2xl bg-white">
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest animate-pulse">Integrando módulo {activeTab}...</span>
           </div>
        )}
      </motion.div>

      <AnimatePresence>
        {showExportModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-900 flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Exportar Reportes
                </h2>
                <button onClick={() => setShowExportModal(false)} className="text-slate-400 hover:text-black">
                  <Plus className="w-5 h-5 rotate-45" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {canExportPayroll && (
                  <div className="border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <div className="text-sm font-bold text-slate-900">Exportar Nomina</div>
                      <p className="text-xs text-slate-500 mt-1">
                        Proveedores cargados en Gestion por Areas con todos sus datos visibles, sin CBU.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => exportNomina('xlsx')}
                        className="px-4 py-2 bg-black text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all"
                      >
                        Excel
                      </button>
                      <button
                        onClick={() => exportNomina('csv')}
                        className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all"
                      >
                        CSV
                      </button>
                    </div>
                  </div>
                )}

                {isProjectAdmin && (
                  <>
                    <div className="border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div>
                        <div className="text-sm font-bold text-slate-900">Presupuesto Principal</div>
                        <p className="text-xs text-slate-500 mt-1">Partidas, proveedores, cantidades, precios y totales del presupuesto principal.</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => exportMainBudget('xlsx')}
                          className="px-4 py-2 bg-black text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all"
                        >
                          Excel
                        </button>
                        <button
                          onClick={() => exportMainBudget('csv')}
                          className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all"
                        >
                          CSV
                        </button>
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div>
                        <div className="text-sm font-bold text-slate-900">Gestion por Areas</div>
                        <p className="text-xs text-slate-500 mt-1">Gastos registrados por area, pagos, deuda y facturas asociadas.</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => exportAreaBudget('xlsx')}
                          className="px-4 py-2 bg-black text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all"
                        >
                          Excel
                        </button>
                        <button
                          onClick={() => exportAreaBudget('csv')}
                          className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all"
                        >
                          CSV
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {!hasExportOptions && (
                  <div className="py-10 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                    No tenes reportes disponibles para exportar
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
        <PaymentModal
          projectId={id}
          item={selectedItemForPayment}
          isOpen={paymentModalOpen}
          isProjectAdmin={isProjectAdmin}
          paymentType={paymentType}
          isDeletingPayment={isDeletingPayment}
          onClose={() => setPaymentModalOpen(false)}
          onPaymentStateChange={updatePaymentState}
          onDeletePayment={deletePaymentFromSelectedItem}
        />
        {showEditProjectModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-900 flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Configuración del Proyecto
                </h2>
                <button onClick={() => setShowEditProjectModal(false)} className="text-slate-400 hover:text-black">
                  <Plus className="w-5 h-5 rotate-45" />
                </button>
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const updates = {
                  name: formData.get('name'),
                  description: formData.get('description'),
                  clientName: formData.get('clientName'),
                  budgetTotal: Number(formData.get('budgetTotal')),
                };
                try {
                  await updateDoc(doc(db, 'projects', id!), updates);
                  setProject({ ...project, ...updates });
                  setShowEditProjectModal(false);
                } catch (err) {
                  console.error("Error updating project:", err);
                  alert("Error al actualizar el proyecto.");
                }
              }} className="p-8 space-y-6">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Nombre de la Producción</label>
                  <input name="name" defaultValue={project.name} required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Cliente</label>
                    <select name="clientName" defaultValue={project.clientName} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all appearance-none">
                      <option value="">Sin cliente</option>
                      {clients.map(client => (
                        <option key={client.id} value={client.businessName}>{client.businessName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Presupuesto Estimado</label>
                    <input name="budgetTotal" type="number" defaultValue={project.budgetTotal} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Resumen del Proyecto</label>
                  <textarea name="description" defaultValue={project.description} rows={4} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all resize-none" />
                </div>
                {isGlobalAdmin && (
                  <div className="rounded-xl border border-red-100 bg-red-50/50 p-4 space-y-3">
                    <div>
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-red-700">Zona de peligro</h3>
                      <p className="text-xs text-red-600 mt-1 leading-relaxed">
                        Borrar un proyecto elimina sus datos internos conocidos y no se puede deshacer.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDeleteProject}
                      disabled={isDeletingProject}
                      className="w-full px-4 py-3 bg-red-600 text-white rounded text-[10px] font-bold tracking-widest uppercase hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {isDeletingProject ? 'Borrando Proyecto...' : 'Borrar Proyecto'}
                    </button>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setShowEditProjectModal(false)} className="flex-1 px-4 py-3 border border-slate-200 rounded text-[10px] font-bold tracking-widest uppercase hover:bg-slate-50 transition-colors">Cancelar</button>
                  <button type="submit" className="flex-1 px-4 py-3 bg-black text-white rounded text-[10px] font-bold tracking-widest uppercase hover:bg-slate-800 transition-colors">Actualizar Datos</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
