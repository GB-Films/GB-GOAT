import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, query, getDocs, addDoc, serverTimestamp, deleteDoc, updateDoc, setDoc, writeBatch } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import { handleFirestoreError } from '../lib/firestoreUtils';
import { useAuth } from '../context/AuthContext';
import { 
  ChevronLeft, 
  Calendar,
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
  Search,
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
import { buildPaymentCalendarDays, formatDateKey, formatPeriodLabel, getOverdueLines, getTodayLines, getUnscheduledLines, sumDebt, type PaymentScheduleLine } from '../lib/paymentSchedule';
import { BudgetRowCell } from './project-detail/BudgetRowCell';
import { PaymentModal } from './project-detail/PaymentModal';
import type { AreaExpense, BudgetItem, CashMovement, Collaborator, Payment, PaymentCollection } from './project-detail/types';
import { formatIdentifier, inferLegacyIdentifiers, providerDisplayName } from '../lib/providerConstants';

const tabs = [
  { id: 'resumen', label: 'Resumen', icon: Info },
  { id: 'presupuesto', label: 'Presupuesto Principal', icon: DollarSign },
  { id: 'areas', label: 'Áreas', icon: LayoutGrid },
  { id: 'cajas', label: 'Cajas', icon: Wallet },
  { id: 'saldos', label: 'Finanzas', icon: Wallet },
  { id: 'documentos', label: 'Documentos', icon: FileText },
  { id: 'resultado', label: 'Resultado', icon: BarChart2 },
  { id: 'proveedores', label: 'Proveedores', icon: Truck },
  { id: 'equipo', label: 'Equipo', icon: Users },
  { id: 'permisos', label: 'Permisos', icon: Settings },
];

const RESULT_INCIDENCES = [
  { id: 'imprevistos', label: 'Imprevistos' },
  { id: 'impuestos', label: 'Impuestos' },
  { id: 'financiacion', label: 'Financiacion' },
  { id: 'administracion', label: 'Indirectos' },
  { id: 'margen', label: 'Margen' },
];

const DOCUMENT_FAMILIES = [
  { id: 'todos', label: 'Todos' },
  { id: 'finanzas', label: 'Finanzas' },
  { id: 'contratos', label: 'Contratos' },
  { id: 'seguros', label: 'Seguros' },
  { id: 'locaciones', label: 'Locaciones' },
] as const;

const MANUAL_DOCUMENT_FAMILIES = DOCUMENT_FAMILIES.filter((family) => family.id !== 'todos' && family.id !== 'finanzas');

const DEFAULT_AREA_EXPENSE_SUBCATEGORY = 'Sin subcategoria';
const AREA_EXPENSE_DRAG_TYPE = 'application/gb-goat-area-expense';

type AreaExpenseSortKey = 'updated' | 'provider' | 'paymentDate' | 'amountDesc' | 'amountAsc' | 'created';

const AREA_EXPENSE_SORT_OPTIONS: Array<{ id: AreaExpenseSortKey; label: string }> = [
  { id: 'updated', label: 'Ultimos cambios' },
  { id: 'provider', label: 'Proveedor A-Z' },
  { id: 'paymentDate', label: 'Fecha de pago' },
  { id: 'amountDesc', label: 'Monto mayor' },
  { id: 'amountAsc', label: 'Monto menor' },
  { id: 'created', label: 'Carga reciente' },
];

const DOCUMENT_SUBTYPES: Record<string, string[]> = {
  contratos: ['Contrato proveedor', 'Contrato talento / crew', 'Prestacion de servicios', 'Cesion de derechos', 'Release', 'Otro'],
  seguros: ['Seguro tecnico / equipos', 'ART / accidentes personales', 'Responsabilidad civil', 'Seguro de locacion', 'Poliza / certificado', 'Otro'],
  locaciones: ['Permiso de filmacion', 'Autorizacion de locacion', 'Condiciones de uso', 'Contacto / datos utiles', 'Otro'],
};

const BUDGET_AREAS = [
  'Ejecutiva', 'Producción', 'Dirección', 'Guion', 'Arte', 'Vestuario', 
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
  jefe_produccion: 'Jefe de Produccion',
  jefe_area: 'Jefe de Área',
};

const PROJECT_TAB_IDS = tabs.map(tab => tab.id);
const DEFAULT_AREA_LEAD_TABS = ['resumen', 'areas', 'cajas', 'saldos', 'documentos', 'proveedores'];
const DEFAULT_PRODUCTION_LEAD_TABS = ['resumen', 'areas', 'cajas', 'saldos', 'documentos', 'proveedores', 'permisos'];
const PROJECT_ADMIN_ROLE_OPTIONS: Collaborator['role'][] = ['admin', 'jefe_produccion', 'jefe_area'];
const PRODUCTION_LEAD_ROLE_OPTIONS: Collaborator['role'][] = ['jefe_area'];
const safeArray = (value: any): string[] => Array.isArray(value) ? value : [];
const normalizeProjectRole = (role: unknown): Collaborator['role'] => {
  if (role === 'admin' || role === 'jefe_produccion' || role === 'jefe_area') return role;
  return 'jefe_area';
};

const normalizeAllowedTabs = (allowedTabs: any, role?: Collaborator['role'] | string) => {
  const normalizedRole = normalizeProjectRole(role);
  const normalized = safeArray(allowedTabs).filter(tabId => PROJECT_TAB_IDS.includes(tabId));
  if (normalizedRole === 'admin') return normalized.length ? normalized : PROJECT_TAB_IDS;
  if (normalizedRole === 'jefe_produccion' && normalized.length === 0) return DEFAULT_PRODUCTION_LEAD_TABS;

  const looksLikeLegacyDefault = normalized.includes('presupuesto') && !normalized.includes('saldos');
  if (looksLikeLegacyDefault) {
    return Array.from(new Set([...normalized.filter(tabId => tabId !== 'presupuesto'), 'saldos', 'documentos', 'proveedores']));
  }

  const looksLikeCurrentDefault = normalized.includes('areas') && normalized.includes('saldos') && !normalized.includes('presupuesto');
  if (looksLikeCurrentDefault && (!normalized.includes('proveedores') || !normalized.includes('documentos'))) {
    return Array.from(new Set([...normalized, 'documentos', 'proveedores']));
  }

  if (looksLikeCurrentDefault && !normalized.includes('cajas')) {
    return Array.from(new Set([...normalized, 'cajas']));
  }

  return normalized.length ? normalized : DEFAULT_AREA_LEAD_TABS;
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

  if (role === 'jefe_produccion') {
    return {
      allowedTabs: DEFAULT_PRODUCTION_LEAD_TABS,
      allowedCategories: chosenCategories,
      canEditBudgetAreas: true,
      canViewBudgetTotals: false,
    };
  }

  return {
    allowedTabs: DEFAULT_AREA_LEAD_TABS,
    allowedCategories: chosenCategories,
    canEditBudgetAreas: true,
    canViewBudgetTotals: false,
  };
};

const formatDate = (dateString: string | any) => {
  if (!dateString) return 'Sin fecha';
  const date = parseProjectDate(dateString);
  if (!date) return 'Fecha invalida';
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

const parseProjectDate = (dateValue: any): Date | null => {
  if (!dateValue) return null;
  if (typeof dateValue === 'string') {
    const value = dateValue.trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00`)
      : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (dateValue.seconds) {
    const date = new Date(dateValue.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getDateTimestamp = (dateValue: any) => {
  const date = parseProjectDate(dateValue);
  return date ? date.getTime() : 0;
};

const normalizeAreaExpenseSubcategory = (value: any) => {
  const normalized = String(value || '').trim();
  return normalized || DEFAULT_AREA_EXPENSE_SUBCATEGORY;
};

const hasAreaExpenseSubcategory = (value: any) => normalizeAreaExpenseSubcategory(value) !== DEFAULT_AREA_EXPENSE_SUBCATEGORY;
const cleanAreaExpenseSubcategory = (value: any) => {
  const normalized = normalizeAreaExpenseSubcategory(value);
  return normalized === DEFAULT_AREA_EXPENSE_SUBCATEGORY ? '' : normalized;
};

const sortAreaExpenses = (expenses: AreaExpense[], sortKey: AreaExpenseSortKey) => {
  return [...expenses].sort((a, b) => {
    if (sortKey === 'provider') {
      const providerDiff = String(a.providerName || '').localeCompare(String(b.providerName || ''), 'es', { sensitivity: 'base' });
      if (providerDiff !== 0) return providerDiff;
      return String(a.description || '').localeCompare(String(b.description || ''), 'es', { sensitivity: 'base' });
    }

    if (sortKey === 'paymentDate') {
      const aDate = getDateTimestamp(a.paymentDate) || Number.MAX_SAFE_INTEGER;
      const bDate = getDateTimestamp(b.paymentDate) || Number.MAX_SAFE_INTEGER;
      if (aDate !== bDate) return aDate - bDate;
      return String(a.providerName || '').localeCompare(String(b.providerName || ''), 'es', { sensitivity: 'base' });
    }

    if (sortKey === 'amountDesc') return (Number(b.total) || 0) - (Number(a.total) || 0);
    if (sortKey === 'amountAsc') return (Number(a.total) || 0) - (Number(b.total) || 0);

    if (sortKey === 'created') {
      return getDateTimestamp(b.createdAt) - getDateTimestamp(a.createdAt);
    }

    return getDateTimestamp(b.updatedAt || b.createdAt) - getDateTimestamp(a.updatedAt || a.createdAt);
  });
};

const toDateInputValue = (dateValue: any) => {
  if (!dateValue) return '';
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue;
  const date = parseProjectDate(dateValue);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getShootingStartDate = (project: any) => (
  project?.shootingStartDate || project?.shootingDate || ''
);

const getShootingEndDate = (project: any) => (
  project?.shootingEndDate || project?.shootingStartDate || project?.shootingDate || ''
);

const formatShootingRange = (project: any) => {
  const start = getShootingStartDate(project);
  const end = getShootingEndDate(project);
  if (!start && !end) return 'Sin fecha de rodaje';
  if (!start || start === end) return `Rodaje: ${formatDate(end || start)}`;
  return `Rodaje: ${formatDate(start)} a ${formatDate(end)}`;
};

const buildGoogleMapsLink = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${trimmed}, Buenos Aires, Argentina`)}`;
};

const getPaymentLeadTimeLabel = (paymentDate: any, shootingDate: any) => {
  if (!paymentDate) return 'Sin fecha';
  const payment = parseProjectDate(paymentDate);
  const shooting = parseProjectDate(shootingDate);
  if (!payment) return 'Fecha inválida';
  if (!shooting) return 'Sin rodaje';
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((payment.getTime() - shooting.getTime()) / dayMs);
  if (diffDays === 0) return 'Mismo día';
  const absDays = Math.abs(diffDays);
  const suffix = absDays === 1 ? 'día' : 'días';
  return diffDays > 0 ? `${absDays} ${suffix} después` : `${absDays} ${suffix} antes`;
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

const validateProjectDocumentFile = (file?: File | null) => {
  if (!file) return 'Selecciona un archivo para subir.';
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return 'El documento debe ser PDF, JPG, PNG o WEBP.';
  }
  if (file.size > 15 * 1024 * 1024) {
    return 'El documento es muy pesado. El maximo permitido es 15 MB.';
  }
  return '';
};

const normalizeEmail = (email?: string | null) => (email || '').trim().toLowerCase();
const normalizeText = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const isProductionArea = (area: unknown) => normalizeText(area).includes('producci');
const isExecutiveArea = (area: unknown) => normalizeText(area).includes('ejecutiv');
const isPostProductionArea = (area: unknown) => {
  const normalized = normalizeText(area);
  return normalized.includes('post') && normalized.includes('producci');
};

const formatExportDate = (dateValue: any) => {
  if (!dateValue) return '';
  const date = parseProjectDate(dateValue);
  if (!date) return String(dateValue);
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
    'Fecha Nacimiento': provider.birthDate ? formatDate(provider.birthDate) : '',
    Email: provider.email || provider.adminEmail || '',
    Telefono: provider.phone || '',
    Categoria: category,
    'Restriccion Alimentaria': provider.dietaryRestriction || '',
    Origen: provider.source === 'provider_invite' ? 'Alta por link' : 'Carga interna',
  };
};

const PROJECT_KEY_PEOPLE = [
  { id: 'director', label: 'Director' },
  { id: 'lineProducer', label: 'Line Producer' },
  { id: 'producer', label: 'Productor' },
];

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('resumen');
  const [selectedAreaTabs, setSelectedAreaTabs] = useState<string[]>([]);
  
  // Data for specific tabs
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [areaExpenses, setAreaExpenses] = useState<AreaExpense[]>([]);
  const [manualProjectDocuments, setManualProjectDocuments] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>(BUDGET_AREAS);
  const [activeAreas, setActiveAreas] = useState<string[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [collapsedAreaSubcategories, setCollapsedAreaSubcategories] = useState<Record<string, boolean>>({});
  const [areaExpenseSort, setAreaExpenseSort] = useState<AreaExpenseSortKey>('updated');
  const [areaExpenseSearch, setAreaExpenseSearch] = useState('');
  const [draggedAreaExpenseId, setDraggedAreaExpenseId] = useState<string | null>(null);
  const [dragOverAreaTarget, setDragOverAreaTarget] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [cashRecipientEmail, setCashRecipientEmail] = useState('');
  const [cashTransferTargetEmail, setCashTransferTargetEmail] = useState('');
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [newCollaboratorSearch, setNewCollaboratorSearch] = useState('');
  const [selectedUserToAdd, setSelectedUserToAdd] = useState<any | null>(null);
  const [newCollaboratorRole, setNewCollaboratorRole] = useState<Collaborator['role']>('jefe_produccion');
  const [newCollaboratorCategories, setNewCollaboratorCategories] = useState<string[]>([]);
  const [userPermissions, setUserPermissions] = useState<Collaborator | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [isProjectAdmin, setIsProjectAdmin] = useState(false);
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [showCopyBudgetModal, setShowCopyBudgetModal] = useState(false);
  const [copyBudgetSearch, setCopyBudgetSearch] = useState('');
  const [sourceProjects, setSourceProjects] = useState<any[]>([]);
  const [selectedSourceProjectId, setSelectedSourceProjectId] = useState('');
  const [isCopyingBudget, setIsCopyingBudget] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedItemForPayment, setSelectedItemForPayment] = useState<any>(null);
  const [paymentType, setPaymentType] = useState<PaymentCollection>('areaExpenses');
  const [isDeletingPayment, setIsDeletingPayment] = useState<number | null>(null);
  const [uploadingInvoices, setUploadingInvoices] = useState<Record<string, boolean>>({});
  const [dragOverExpenseId, setDragOverExpenseId] = useState<string | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [locationDraft, setLocationDraft] = useState('');
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [showKeyPeopleData, setShowKeyPeopleData] = useState(false);
  const [financeAreaFilter, setFinanceAreaFilter] = useState('all');
  const [financeStatusFilter, setFinanceStatusFilter] = useState<'all' | 'pendiente' | 'parcial' | 'pagado'>('all');
  const [financeInvoiceFilter, setFinanceInvoiceFilter] = useState<'all' | 'with' | 'without'>('all');
  const [financeSearch, setFinanceSearch] = useState('');
  const [paymentScheduleAnchor, setPaymentScheduleAnchor] = useState(() => formatDateKey(new Date()));
  const [selectedPaymentBucketKey, setSelectedPaymentBucketKey] = useState<string | null>(null);
  const [expandedPaymentLineId, setExpandedPaymentLineId] = useState<string | null>(null);
  const [documentFamilyFilter, setDocumentFamilyFilter] = useState<'todos' | 'finanzas' | 'contratos' | 'seguros' | 'locaciones'>('todos');
  const [documentTypeFilter, setDocumentTypeFilter] = useState<'all' | 'factura' | 'comprobante'>('all');
  const [documentAreaFilter, setDocumentAreaFilter] = useState('all');
  const [documentSearch, setDocumentSearch] = useState('');
  const [showDocumentUploadModal, setShowDocumentUploadModal] = useState(false);
  const [isUploadingProjectDocument, setIsUploadingProjectDocument] = useState(false);
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
          setLocationDraft(data.location || '');
          
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
            const role = normalizeProjectRole(rawPerms.role);
            const perms: Collaborator = {
              ...rawPerms,
              email: normalizeEmail(rawPerms.email || colSnapshot.id),
              role,
              allowedTabs: normalizeAllowedTabs(rawPerms.allowedTabs, role),
              allowedCategories: safeArray(rawPerms.allowedCategories),
              canEditBudgetAreas: rawPerms.canEditBudgetAreas ?? true,
              canViewBudgetTotals: rawPerms.canViewBudgetTotals ?? role === 'admin',
            };
            setUserPermissions(perms);
            setIsProjectAdmin(owner || perms.role === 'admin' || isGlobalAdmin);
          } else {
            setUserPermissions(null);
            setIsProjectAdmin(owner || isGlobalAdmin);
          }

          if (data.activeAreas) {
            setActiveAreas(data.activeAreas);
            setSelectedAreaTabs((current) => {
              const stillVisible = current.filter((area) => data.activeAreas.includes(area));
              return stillVisible.length > 0 ? stillVisible : data.activeAreas;
            });
          } else {
            setActiveAreas([]);
            setSelectedAreaTabs([]);
          }

          if (data.categories && Array.isArray(data.categories) && data.categories.length > 0) {
            // Once a project has saved categories, respect them exactly.
            // A one-time migration adds Ejecutiva to older projects; after that, admins can delete it and it stays deleted.
            const savedCategories = Array.from(new Set(data.categories));
            const needsExecutiveDefault = !data.executiveCategoryDefaultApplied && !savedCategories.some(isExecutiveArea);
            const resolvedCategories = needsExecutiveDefault
              ? ['Ejecutiva', ...savedCategories]
              : savedCategories;
            setCategories(resolvedCategories);
            if (needsExecutiveDefault) {
              updateDoc(doc(db, 'projects', id), {
                categories: resolvedCategories,
                executiveCategoryDefaultApplied: true,
                updatedAt: serverTimestamp(),
              }).catch((error) => console.error('Error applying executive category default:', error));
            }
          } else {
            setCategories(BUDGET_AREAS);
          }

          // Fetch all collaborators for project admins
          const colSnap = await getDocs(collection(db, 'projects', id, 'collaborators'));
          setCollaborators(colSnap.docs.map(d => {
            const data = d.data() as any;
            const role = normalizeProjectRole(data.role);
            return {
              ...data,
              email: normalizeEmail(data.email || d.id),
              role,
              allowedTabs: normalizeAllowedTabs(data.allowedTabs, role),
              allowedCategories: safeArray(data.allowedCategories),
              canEditBudgetAreas: data.canEditBudgetAreas ?? true,
              canViewBudgetTotals: data.canViewBudgetTotals ?? role === 'admin',
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
        setAreaExpenses(eSnap.docs.map(d => ({ id: d.id, ...d.data() } as AreaExpense)));

        const dq = query(collection(db, 'projects', id, 'projectDocuments'));
        const dSnap = await getDocs(dq);
        setManualProjectDocuments(dSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        const cashSnap = await getDocs(collection(db, 'projects', id, 'cashMovements'));
        setCashMovements(cashSnap.docs.map(d => ({ id: d.id, ...d.data() } as CashMovement)));

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
    if (!isProjectAdmin || !id) return;

    const fetchSourceProjects = async () => {
      try {
        const snap = await getDocs(collection(db, 'projects'));
        const items = snap.docs
          .map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }))
          .filter((item) => item.id !== id)
          .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
        setSourceProjects(items);
      } catch (error) {
        console.error('Error fetching source projects:', error);
      }
    };

    fetchSourceProjects();
  }, [isProjectAdmin, id]);

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
      quantity: 1,
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
      setSelectedAreaTabs((current) => Array.from(new Set([...current, areaName])));
      if (id) {
        await updateDoc(doc(db, 'projects', id), { activeAreas: newActiveAreas });
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
    setSelectedAreaTabs((current) => current.filter((area) => area !== areaName));
    if (id) {
      await updateDoc(doc(db, 'projects', id), { activeAreas: newActiveAreas });
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
      alert(`${message}\n\nSe guardara igual y el area quedara marcada como excedida.`);
      return true;
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
      subcategory: '',
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

  const getStoredAreaSubcategories = (area: string) => {
    const stored = project?.areaExpenseSubcategories;
    const list = stored && typeof stored === 'object' ? stored[area] : [];
    return Array.isArray(list) ? list.map(normalizeAreaExpenseSubcategory) : [];
  };

  const saveAreaSubcategories = async (area: string, subcategories: string[]) => {
    if (!id || !canEditArea(area)) return;
    const normalized = Array.from(new Set(
      subcategories
        .map(cleanAreaExpenseSubcategory)
        .filter(Boolean)
    ));
    const nextMap = {
      ...(project?.areaExpenseSubcategories || {}),
      [area]: normalized,
    };

    await updateDoc(doc(db, 'projects', id), {
      areaExpenseSubcategories: nextMap,
      updatedAt: serverTimestamp(),
    });
    setProject((current: any) => current ? { ...current, areaExpenseSubcategories: nextMap } : current);
  };

  const createAreaExpenseSubcategory = async (area: string) => {
    if (!canEditArea(area)) return;
    const rawName = window.prompt(`Nueva subcategoria para ${area}`);
    const name = cleanAreaExpenseSubcategory(rawName);
    if (!rawName || !name) return;

    const existing = getStoredAreaSubcategories(area);
    if (existing.some((item) => item.toLowerCase() === name.toLowerCase())) {
      alert('Esa subcategoria ya existe en esta area.');
      return;
    }

    try {
      await saveAreaSubcategories(area, [...existing, name]);
    } catch (error) {
      console.error('Error creating area expense subcategory:', error);
      alert('No se pudo crear la subcategoria.');
    }
  };

  const moveAreaExpense = async (expense: AreaExpense, nextArea: string, nextSubcategory: string) => {
    if (!expense?.id) return;
    const targetArea = nextArea || expense.area;
    const targetSubcategory = cleanAreaExpenseSubcategory(nextSubcategory);
    const updates: Partial<AreaExpense> = {};

    if (targetArea !== expense.area) {
      updates.area = targetArea;
      const targetSubcategories = getStoredAreaSubcategories(targetArea);
      updates.subcategory = targetSubcategories.some((item) => item.toLowerCase() === targetSubcategory.toLowerCase())
        ? targetSubcategory
        : '';
    } else if (targetSubcategory !== cleanAreaExpenseSubcategory(expense.subcategory)) {
      updates.subcategory = targetSubcategory;
    }

    if (Object.keys(updates).length === 0) return;
    await updateAreaExpense(expense.id, updates);
  };

  const startAreaExpenseDrag = (event: React.DragEvent<HTMLDivElement>, expense: AreaExpense) => {
    if (!canEditArea(expense.area)) return;
    setDraggedAreaExpenseId(expense.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(AREA_EXPENSE_DRAG_TYPE, expense.id);
    event.dataTransfer.setData('text/plain', expense.id);
  };

  const finishAreaExpenseDrop = async (area: string, subcategory = '') => {
    const expenseId = draggedAreaExpenseId;
    setDraggedAreaExpenseId(null);
    setDragOverAreaTarget(null);
    if (!expenseId) return;

    const expense = areaExpenses.find((item) => item.id === expenseId);
    if (!expense || !canEditArea(expense.area) || !canEditArea(area)) return;
    await moveAreaExpense(expense, area, subcategory);
  };

  const isAreaExpenseDrag = (event: React.DragEvent<HTMLElement>) => (
    draggedAreaExpenseId || Array.from(event.dataTransfer.types).includes(AREA_EXPENSE_DRAG_TYPE)
  );

  const updateScheduledPaymentDate = async (item: any, collectionName: PaymentCollection, paymentDate: string) => {
    if (!item?.id) return;
    if (collectionName === 'budgetItems' && activeAreas.includes(item.area)) return;

    const currentDate = toDateInputValue(item.paymentDate);
    if (currentDate === paymentDate) return;

    if (collectionName === 'budgetItems') {
      await updateBudgetItem(item.id, { paymentDate });
    } else {
      await updateAreaExpense(item.id, { paymentDate });
    }
  };

  const renderPaymentScheduleCell = (item: any, collectionName: PaymentCollection, disabled: boolean) => (
    <div className="space-y-1">
      <div className={cn(
        "relative w-full px-2 py-1.5 bg-slate-50 border border-slate-100 rounded text-[10px] font-bold text-center transition-all",
        disabled ? "cursor-not-allowed text-slate-400 bg-slate-100" : "cursor-pointer text-slate-700 hover:border-black"
      )}>
        {item.paymentDate ? formatDate(item.paymentDate) : 'Definir fecha'}
      <input
        type="date"
        defaultValue={toDateInputValue(item.paymentDate)}
        disabled={disabled}
        onChange={(event) => updateScheduledPaymentDate(item, collectionName, event.target.value)}
        className="absolute inset-0 h-full w-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
      />
      </div>
    </div>
  );

  const renderPaymentLeadTimeCell = (item: any) => (
    <div className={cn(
      "text-[9px] font-black uppercase tracking-widest text-center px-2 py-1.5 rounded border",
      item.paymentDate ? "bg-slate-50 border-slate-100 text-slate-600" : "bg-white border-slate-100 text-slate-300"
    )}>
      {getPaymentLeadTimeLabel(item.paymentDate, getShootingEndDate(project))}
    </div>
  );

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

  const uploadProjectDocument = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id || !canUploadProjectDocuments) return;

    const formData = new FormData(event.currentTarget);
    const file = formData.get('file') as File | null;
    const fileError = validateProjectDocumentFile(file);
    if (fileError) {
      alert(fileError);
      return;
    }

    const family = String(formData.get('family') || 'contratos');
    const subtype = String(formData.get('subtype') || 'Otro');
    const providerId = String(formData.get('providerId') || '');
    const provider = providers.find((item) => item.id === providerId);
    const area = String(formData.get('area') || '');
    const title = String(formData.get('title') || '').trim() || subtype;
    const expirationDate = String(formData.get('expirationDate') || '');
    const notes = String(formData.get('notes') || '').trim();
    const docRef = doc(collection(db, 'projects', id, 'projectDocuments'));
    const cleanBase = sanitizeFileName(file!.name.replace(/\.[^.]+$/, '') || title).slice(0, 80) || 'documento';
    const extension = file!.name.includes('.') ? file!.name.split('.').pop() : 'pdf';
    const fileName = `${family}-${docRef.id}-${cleanBase}.${extension}`;
    const path = `projects/${id}/documents/${docRef.id}/${fileName}`;

    setIsUploadingProjectDocument(true);
    try {
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file!, {
        contentType: file!.type,
        customMetadata: {
          projectId: id,
          family,
          subtype,
          uploadedBy: user?.email || '',
        },
      });
      const url = await getDownloadURL(storageRef);
      const payload = {
        family,
        type: subtype,
        subtype,
        title,
        providerId,
        providerName: provider ? providerDisplayName(provider) : '',
        area,
        expirationDate,
        notes,
        fileName,
        originalFileName: file!.name,
        url,
        path,
        contentType: file!.type,
        size: file!.size,
        source: 'Carga manual',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        uploadedBy: user?.email || '',
      };

      await setDoc(docRef, payload);
      setManualProjectDocuments((current) => [{ id: docRef.id, ...payload, createdAt: new Date(), updatedAt: new Date() }, ...current]);
      setDocumentFamilyFilter(family as any);
      setShowDocumentUploadModal(false);
    } catch (error) {
      console.error('Error uploading project document:', error);
      alert('No se pudo subir el documento. Revisa permisos de Firebase Storage.');
    } finally {
      setIsUploadingProjectDocument(false);
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
    const collectionName: PaymentCollection = selectedItemForPayment.__paymentCollection || paymentType;
    if (!canManagePaymentForItem(selectedItemForPayment, collectionName)) return;

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

      await updateDoc(doc(db, 'projects', id, collectionName, currentItemId), {
        paymentHistory: updatedHistory,
        paid: isFullyPaid,
        updatedAt: serverTimestamp()
      });

      if (paymentToDelete.receipt?.path) {
        deleteObject(ref(storage, paymentToDelete.receipt.path)).catch(() => {});
      }

      if (paymentToDelete.cashMovementId) {
        await deleteDoc(doc(db, 'projects', id, 'cashMovements', paymentToDelete.cashMovementId));
        setCashMovements((current) => current.filter((movement) => movement.id !== paymentToDelete.cashMovementId));
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

  const copyBudgetFromProject = async () => {
    if (!id || !canEditMainBudget || !selectedSourceProjectId) return;

    const sourceProject = sourceProjects.find((item) => item.id === selectedSourceProjectId);
    if (!sourceProject) return;

    const shouldReplace = budgetItems.length > 0
      ? window.confirm('Este proyecto ya tiene partidas en el presupuesto principal. ¿Querés reemplazarlas por el presupuesto copiado?')
      : true;
    if (!shouldReplace) return;

    setIsCopyingBudget(true);
    try {
      const sourceItemsSnap = await getDocs(collection(db, 'projects', selectedSourceProjectId, 'budgetItems'));
      const sourceCategories = safeArray(sourceProject.categories);
      const sourceItems = sourceItemsSnap.docs
        .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() } as any))
        .sort((a, b) => {
          const areaDiff = sourceCategories.indexOf(a.area) - sourceCategories.indexOf(b.area);
          if (areaDiff !== 0) return areaDiff;
          return (a.order || 0) - (b.order || 0);
        });

      if (sourceItems.length === 0) {
        alert('El proyecto elegido no tiene partidas en el presupuesto principal.');
        return;
      }

      const batch = writeBatch(db);
      if (budgetItems.length > 0) {
        budgetItems.forEach((item) => {
          batch.delete(doc(db, 'projects', id, 'budgetItems', item.id));
        });
      }

      const copiedItems = sourceItems.map((item, index) => {
        const docRef = doc(collection(db, 'projects', id, 'budgetItems'));
        const payload = {
          projectId: id,
          area: item.area || 'Producción',
          providerId: item.providerId || '',
          providerName: item.providerName || '',
          description: item.description || '',
          unit: item.unit || 'Unidad',
          quantity: Number(item.quantity) || 0,
          unitPrice: Number(item.unitPrice) || 0,
          total: Number(item.total) || ((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)),
          paymentDate: item.paymentDate || '',
          order: typeof item.order === 'number' ? item.order : index,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        batch.set(docRef, payload);
        return { id: docRef.id, ...payload };
      });

      const copiedCategories = Array.from(new Set([
        ...sourceCategories,
        ...sourceItems.map((item) => item.area).filter(Boolean),
      ]));
      const nextCategories = copiedCategories.length > 0 ? copiedCategories : BUDGET_AREAS;
      batch.update(doc(db, 'projects', id), {
        categories: nextCategories,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      setBudgetItems(copiedItems as BudgetItem[]);
      setCategories(nextCategories);
      setShowCopyBudgetModal(false);
      setSelectedSourceProjectId('');
      setCopyBudgetSearch('');
      alert(`${copiedItems.length} partidas copiadas desde ${sourceProject.name || 'otro proyecto'}.`);
    } catch (error) {
      console.error('Error copying budget:', error);
      alert('No se pudo copiar el presupuesto. Revisá permisos o conexión.');
    } finally {
      setIsCopyingBudget(false);
    }
  };

  const deleteCategory = async (area: string) => {
    if (!id || !canEditMainBudget || !confirm(`¿Eliminar la categoría "${area}" y todos sus ítems?`)) return;
    
    const itemsToDelete = budgetItems.filter(i => i.area === area);
    const newCategories = categories.filter(c => c !== area);
    const newActiveAreas = activeAreas.filter(a => a !== area);
    
    try {
      // Delete items in category
      for (const item of itemsToDelete) {
        await deleteDoc(doc(db, 'projects', id, 'budgetItems', item.id));
      }
      // Update categories in project and remove it from active area management if needed
      await updateDoc(doc(db, 'projects', id), { categories: newCategories, activeAreas: newActiveAreas });

      const collaboratorsToUpdate = collaborators.filter(col => safeArray(col.allowedCategories).includes(area));
      for (const col of collaboratorsToUpdate) {
        await updateDoc(doc(db, 'projects', id, 'collaborators', normalizeEmail(col.email)), {
          allowedCategories: safeArray(col.allowedCategories).filter(cat => cat !== area),
          updatedAt: serverTimestamp(),
        });
      }
      
      setCategories(newCategories);
      setActiveAreas(newActiveAreas);
      setSelectedAreaTabs(current => current.filter(tab => tab !== area));
      setBudgetItems(prev => prev.filter(i => i.area !== area));
      setCollaborators(prev => prev.map(col => ({
        ...col,
        allowedCategories: safeArray(col.allowedCategories).filter(cat => cat !== area),
      })));
    } catch (e) {
      console.error("Error deleting category:", e);
    }
  };

  // Filtered views based on permissions
  const visibleTabs = tabs.filter(tab => {
    if (tab.id === 'resultado') return isProjectAdmin;
    if (tab.id === 'permisos' && userPermissions?.role === 'jefe_produccion') return true;
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

  const visibleCategoryKey = visibleCategories.join('|');
  const selectedVisibleAreas = selectedAreaTabs.filter((area) => visibleCategories.includes(area));
  const areaExpenseSubcategoriesByArea = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    const stored = project?.areaExpenseSubcategories && typeof project.areaExpenseSubcategories === 'object'
      ? project.areaExpenseSubcategories
      : {};

    visibleCategories.forEach((area) => {
      const storedList = Array.isArray(stored[area]) ? stored[area] : [];
      const expenseList = areaExpenses
        .filter((expense) => expense.area === area)
        .map((expense) => normalizeAreaExpenseSubcategory(expense.subcategory));
      map[area] = Array.from(new Set([
        ...storedList.map(normalizeAreaExpenseSubcategory),
        ...expenseList,
      ])).filter(hasAreaExpenseSubcategory);
    });

    return map;
  }, [areaExpenses, project?.areaExpenseSubcategories, visibleCategoryKey]);

  useEffect(() => {
    setSelectedAreaTabs((current) => {
      const stillVisible = current.filter((area) => visibleCategories.includes(area));
      if (stillVisible.length > 0 || visibleCategories.length === 0) return stillVisible;
      return visibleCategories;
    });
  }, [visibleCategoryKey]);

  const areaDashboardRows = React.useMemo(() => (
    visibleCategories.map((area) => {
      const searchTerm = normalizeText(areaExpenseSearch);
      const matchesAreaExpenseSearch = (item: AreaExpense) => {
        if (!searchTerm) return true;
        return normalizeText([
          item.providerName,
          item.description,
          item.area,
          item.subcategory,
          item.unit,
          item.total,
          formatDate(item.paymentDate),
        ].filter(Boolean).join(' ')).includes(searchTerm);
      };
      const assigned = budgetItems
        .filter((item) => item.area === area)
        .reduce((acc, item) => acc + (Number(item.total) || 0), 0);
      const allExpenses = areaExpenses
        .filter((item) => item.area === area)
        .sort((a, b) => getDateTimestamp(b.updatedAt || b.createdAt) - getDateTimestamp(a.updatedAt || a.createdAt));
      const expenses = allExpenses.filter(matchesAreaExpenseSearch);
      const spent = expenses.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
      const balance = assigned - spent;
      const usedPercent = assigned > 0 ? Math.min(100, (spent / assigned) * 100) : 0;
      const knownSubcategories = areaExpenseSubcategoriesByArea[area] || [];
      const unassignedExpenses = sortAreaExpenses(
        expenses.filter((expense) => !hasAreaExpenseSubcategory(expense.subcategory)),
        areaExpenseSort
      );
      const namedSubcategoryGroups = knownSubcategories
        .map((subcategory) => {
          const groupExpenses = sortAreaExpenses(
            expenses.filter((expense) => normalizeAreaExpenseSubcategory(expense.subcategory) === subcategory),
            areaExpenseSort
          );

          return {
            subcategory,
            expenses: groupExpenses,
            subtotal: groupExpenses.reduce((acc, item) => acc + (Number(item.total) || 0), 0),
          };
        })
        .filter((group) => group.expenses.length > 0 || !searchTerm);
      const subcategoryGroups = [
        ...(unassignedExpenses.length > 0
          ? [{
              subcategory: '',
              expenses: unassignedExpenses,
              subtotal: unassignedExpenses.reduce((acc, item) => acc + (Number(item.total) || 0), 0),
            }]
          : []),
        ...namedSubcategoryGroups,
      ];

      return { area, assigned, expenses, subcategoryGroups, spent, balance, usedPercent, hasSubcategories: knownSubcategories.length > 0 };
    })
  ), [areaExpenseSearch, areaExpenseSort, areaExpenseSubcategoriesByArea, areaExpenses, budgetItems, visibleCategoryKey]);

  const selectedAreaDashboardRows = areaDashboardRows.filter((row) => selectedVisibleAreas.includes(row.area));
  const areaDashboardTotals = selectedAreaDashboardRows.reduce((acc, row) => ({
    assigned: acc.assigned + row.assigned,
    spent: acc.spent + row.spent,
    balance: acc.balance + row.balance,
    records: acc.records + row.expenses.length,
  }), { assigned: 0, spent: 0, balance: 0, records: 0 });

  const isProductionLead = userPermissions?.role === 'jefe_produccion';
  const canEditProjectOperations = isProjectAdmin || isProductionLead;
  const canManageProjectRoles = isProjectAdmin;
  const canAssignProjectAreas = isProjectAdmin || isProductionLead;
  const canUploadProjectDocuments = isProjectAdmin || (
    isProductionLead && safeArray(userPermissions?.allowedTabs).includes('documentos')
  );
  const canSeeFullPayroll = isProjectAdmin || isProductionLead;
  const roleOptionsForCurrentUser = isProjectAdmin ? PROJECT_ADMIN_ROLE_OPTIONS : PRODUCTION_LEAD_ROLE_OPTIONS;
  const currentUserEmail = normalizeEmail(user?.email);
  const currentUserName = profile?.displayName || user?.displayName || currentUserEmail;
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
  const canManagePaymentForItem = (item?: any | null, collectionName?: PaymentCollection) => {
    if (!item || !collectionName) return false;
    if (isProjectAdmin) return true;
    return canEditArea(item.area);
  };
  const canUploadAreaFiles = (area?: string | null) => canEditArea(area);
  const collaboratorEmails = collaborators.map((col) => normalizeEmail(col.email));
  const visiblePermissionCollaborators = isProjectAdmin
    ? collaborators
    : collaborators.filter((col) => col.role === 'jefe_area');
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

  const filteredSourceProjects = React.useMemo(() => {
    const term = copyBudgetSearch.trim().toLowerCase();
    return sourceProjects.filter((sourceProject) => {
      if (!term) return true;
      return [sourceProject.name, sourceProject.clientName, sourceProject.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [copyBudgetSearch, sourceProjects]);

  const cashResponsibles = React.useMemo(() => (
    collaborators
      .filter((col) => col.role === 'jefe_produccion' || col.role === 'jefe_area')
      .map((col) => ({
        ...col,
        email: normalizeEmail(col.email),
        displayName: col.displayName || col.email,
      }))
      .sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email, 'es'))
  ), [collaborators]);

  const cashBalanceByEmail = React.useMemo(() => {
    const balances = new Map<string, number>();
    cashMovements.forEach((movement) => {
      const amount = Number(movement.amount) || 0;
      const toEmail = normalizeEmail(movement.toUserEmail);
      const fromEmail = normalizeEmail(movement.fromUserEmail);
      if (toEmail) balances.set(toEmail, (balances.get(toEmail) || 0) + amount);
      if (fromEmail) balances.set(fromEmail, (balances.get(fromEmail) || 0) - amount);
    });
    return balances;
  }, [cashMovements]);

  const currentCashBalance = cashBalanceByEmail.get(currentUserEmail) || 0;
  const productionTransferTargets = React.useMemo(() => (
    cashResponsibles.filter((responsible) => {
      if (responsible.role !== 'jefe_area') return false;
      if (normalizeEmail(responsible.email) === currentUserEmail) return false;
      if (isProjectAdmin) return true;
      const ownAreas = safeArray(userPermissions?.allowedCategories);
      return safeArray(responsible.allowedCategories).some((area) => ownAreas.includes(area));
    })
  ), [cashResponsibles, currentUserEmail, isProjectAdmin, userPermissions]);

  const visibleCashRows = React.useMemo(() => (
    cashResponsibles
      .filter((responsible) => (
        isProjectAdmin
        || normalizeEmail(responsible.email) === currentUserEmail
        || (
          isProductionLead
          && responsible.role === 'jefe_area'
          && safeArray(responsible.allowedCategories).some((area) => safeArray(userPermissions?.allowedCategories).includes(area))
        )
      ))
      .map((responsible) => {
        const email = normalizeEmail(responsible.email);
        const movements = cashMovements
          .filter((movement) => normalizeEmail(movement.toUserEmail) === email || normalizeEmail(movement.fromUserEmail) === email)
          .sort((a, b) => {
            const ad = a.createdAt?.seconds ? a.createdAt.seconds : new Date(a.date || 0).getTime() / 1000;
            const bd = b.createdAt?.seconds ? b.createdAt.seconds : new Date(b.date || 0).getTime() / 1000;
            return bd - ad;
          });
        const received = movements
          .filter((movement) => normalizeEmail(movement.toUserEmail) === email)
          .reduce((acc, movement) => acc + (Number(movement.amount) || 0), 0);
        const used = movements
          .filter((movement) => normalizeEmail(movement.fromUserEmail) === email && movement.type === 'pago')
          .reduce((acc, movement) => acc + (Number(movement.amount) || 0), 0);
        const transferred = movements
          .filter((movement) => normalizeEmail(movement.fromUserEmail) === email && movement.type === 'transferencia')
          .reduce((acc, movement) => acc + (Number(movement.amount) || 0), 0);

        return {
          responsible,
          email,
          movements,
          received,
          used,
          transferred,
          balance: cashBalanceByEmail.get(email) || 0,
        };
      })
  ), [cashBalanceByEmail, cashMovements, cashResponsibles, currentUserEmail, isProductionLead, isProjectAdmin, userPermissions]);

  useEffect(() => {
    if (!cashRecipientEmail && cashResponsibles.length > 0) {
      setCashRecipientEmail(cashResponsibles[0].email);
    }
  }, [cashRecipientEmail, cashResponsibles]);

  useEffect(() => {
    if (!cashTransferTargetEmail && productionTransferTargets.length > 0) {
      setCashTransferTargetEmail(productionTransferTargets[0].email);
    }
  }, [cashTransferTargetEmail, productionTransferTargets]);

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
      debt: number,
      entries: Array<{
        id: string;
        collectionName: PaymentCollection;
        item: any;
        description: string;
        total: number;
        paid: number;
        invoice?: any;
      }>;
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
          debt: 0,
          entries: []
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
        s.entries.push({
          id: item.id,
          collectionName: 'budgetItems',
          item,
          description: item.description || 'Partida de presupuesto',
          total: Number(item.total) || 0,
          paid: itemPaid,
        });
      }
    });

    areaExpenses.forEach(item => {
      if (!item.providerId || !canSeeArea(item.area)) return;
      const s = ensureSaldo(item.area || 'Sin area', item.providerId, item.providerName);
      s.spent += item.total || 0;
      
      const itemPaid = (item.paymentHistory || []).reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0);
      s.paid += itemPaid;
      s.entries.push({
        id: item.id,
        collectionName: 'areaExpenses',
        item,
        description: item.description || 'Gasto de area',
        total: Number(item.total) || 0,
        paid: itemPaid,
        invoice: item.invoice,
      });
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

  const getFinanceStatus = (saldo: { debt: number; paid: number }) => {
    if (saldo.debt <= 0.01 && saldo.paid > 0) return 'pagado';
    if (saldo.paid > 0 && saldo.debt > 0.01) return 'parcial';
    return 'pendiente';
  };

  const filteredProviderSaldosByArea = React.useMemo(() => {
    const search = financeSearch.trim().toLowerCase();

    return providerSaldosByArea
      .map((group) => {
        const rows = group.rows.filter((saldo) => {
          const status = getFinanceStatus(saldo);
          const hasInvoice = saldo.entries.some((entry) => entry.invoice?.url);
          const matchesArea = financeAreaFilter === 'all' || saldo.area === financeAreaFilter;
          const matchesStatus = financeStatusFilter === 'all' || status === financeStatusFilter;
          const matchesInvoice = financeInvoiceFilter === 'all'
            || (financeInvoiceFilter === 'with' && hasInvoice)
            || (financeInvoiceFilter === 'without' && !hasInvoice);
          const matchesSearch = !search
            || saldo.name.toLowerCase().includes(search)
            || saldo.entries.some((entry) => entry.description.toLowerCase().includes(search));

          return matchesArea && matchesStatus && matchesInvoice && matchesSearch;
        });

        return { ...group, rows };
      })
      .filter((group) => group.rows.length > 0);
  }, [financeAreaFilter, financeInvoiceFilter, financeSearch, financeStatusFilter, providerSaldosByArea]);

  const filteredProviderSaldos = filteredProviderSaldosByArea.flatMap(group => group.rows);
  const financeTotals = React.useMemo(() => (
    filteredProviderSaldos.reduce((acc, saldo) => ({
      budgeted: acc.budgeted + saldo.budgeted,
      spent: acc.spent + saldo.spent,
      paid: acc.paid + saldo.paid,
      debt: acc.debt + saldo.debt,
      invoices: acc.invoices + saldo.entries.filter((entry) => entry.invoice?.url).length,
      receipts: acc.receipts + saldo.entries.reduce((count, entry) => (
        count + safeArray(entry.item?.paymentHistory).filter((payment: any) => payment.receipt?.url).length
      ), 0),
    }), { budgeted: 0, spent: 0, paid: 0, debt: 0, invoices: 0, receipts: 0 })
  ), [filteredProviderSaldos]);


  const paymentScheduleLines = React.useMemo<PaymentScheduleLine[]>(() => (
    providerSaldos.flatMap((saldo) => (
      saldo.entries.map((entry) => {
        const debt = Math.max(0, Number(entry.total) - Number(entry.paid || 0));
        return {
          id: `${entry.collectionName}-${entry.id}`,
          projectId: project?.id,
          projectName: project?.name || 'Proyecto actual',
          area: saldo.area,
          providerName: saldo.name,
          cbu: saldo.cbu,
          description: entry.description || 'Movimiento',
          total: Number(entry.total) || 0,
          paid: Number(entry.paid) || 0,
          debt,
          paymentDate: entry.item?.paymentDate,
          source: entry.collectionName === 'areaExpenses' ? 'Gestion por Areas' : 'Presupuesto Principal',
        };
      })
    ))
    .filter((line) => line.debt > 0.01)
    .sort((a, b) => a.providerName.localeCompare(b.providerName, 'es'))
  ), [project?.id, project?.name, providerSaldos]);

  const paymentScheduleCalendarDays = React.useMemo(() => (
    buildPaymentCalendarDays(paymentScheduleLines, paymentScheduleAnchor)
  ), [paymentScheduleAnchor, paymentScheduleLines]);

  const selectedPaymentBucket = React.useMemo(() => {
    if (paymentScheduleCalendarDays.length === 0) return null;
    return paymentScheduleCalendarDays.find((bucket) => bucket.key === selectedPaymentBucketKey)
      || paymentScheduleCalendarDays.find((bucket) => bucket.isToday)
      || paymentScheduleCalendarDays.find((bucket) => bucket.isCurrentMonth)
      || paymentScheduleCalendarDays[0];
  }, [paymentScheduleCalendarDays, selectedPaymentBucketKey]);

  const paymentScheduleStats = React.useMemo(() => {
    const periodLines = paymentScheduleCalendarDays
      .filter((bucket) => bucket.isCurrentMonth)
      .flatMap((bucket) => bucket.lines);
    const todayLines = getTodayLines(paymentScheduleLines);
    const overdueLines = getOverdueLines(paymentScheduleLines);
    const unscheduledLines = getUnscheduledLines(paymentScheduleLines);

    return {
      periodLines,
      periodDebt: sumDebt(periodLines),
      todayLines,
      todayDebt: sumDebt(todayLines),
      overdueLines,
      overdueDebt: sumDebt(overdueLines),
      unscheduledLines,
      unscheduledDebt: sumDebt(unscheduledLines),
    };
  }, [paymentScheduleCalendarDays, paymentScheduleLines]);

  const projectDocuments = React.useMemo(() => {
    const docs: Array<{
      id: string;
      family: 'finanzas' | 'contratos' | 'seguros' | 'locaciones';
      type: string;
      area: string;
      providerName: string;
      description: string;
      fileName: string;
      url: string;
      amount: number;
      source: string;
      uploadedAt?: any;
      paymentDate?: string;
    }> = [];

    providerSaldosByArea.forEach((group) => {
      group.rows.forEach((saldo) => {
        saldo.entries.forEach((entry) => {
          if (entry.invoice?.url) {
            docs.push({
              id: `invoice-${entry.collectionName}-${entry.id}`,
              family: 'finanzas',
              type: 'factura',
              area: saldo.area,
              providerName: saldo.name,
              description: entry.description,
              fileName: entry.invoice.fileName || entry.invoice.originalFileName || 'Factura',
              url: entry.invoice.url,
              amount: entry.total,
              source: entry.collectionName === 'areaExpenses' ? 'Gestion por Areas' : 'Presupuesto Principal',
              uploadedAt: entry.invoice.uploadedAt,
            });
          }

          safeArray(entry.item?.paymentHistory).forEach((payment: any, index) => {
            if (!payment.receipt?.url) return;
            docs.push({
              id: `receipt-${entry.collectionName}-${entry.id}-${payment.id || index}`,
              family: 'finanzas',
              type: 'comprobante',
              area: saldo.area,
              providerName: saldo.name,
              description: entry.description,
              fileName: payment.receipt.originalFileName || payment.receipt.fileName || 'Comprobante',
              url: payment.receipt.url,
              amount: Number(payment.amount) || 0,
              source: 'Pago registrado',
              uploadedAt: payment.receipt.uploadedAt,
              paymentDate: payment.date,
            });
          });
        });
      });
    });

    manualProjectDocuments.forEach((document) => {
      docs.push({
        id: `manual-${document.id}`,
        family: document.family || 'contratos',
        type: document.type || document.subtype || 'Documento',
        area: document.area || 'General',
        providerName: document.providerName || 'Sin proveedor',
        description: document.title || document.notes || document.subtype || 'Documento',
        fileName: document.originalFileName || document.fileName || 'Documento',
        url: document.url,
        amount: 0,
        source: document.expirationDate ? `Carga manual / vence ${document.expirationDate}` : 'Carga manual',
        uploadedAt: document.createdAt,
      });
    });

    return docs.sort((a, b) => {
      const typeDiff = a.type.localeCompare(b.type);
      if (typeDiff !== 0) return typeDiff;
      return a.providerName.localeCompare(b.providerName, 'es');
    });
  }, [manualProjectDocuments, providerSaldosByArea]);

  const filteredProjectDocuments = React.useMemo(() => {
    const search = documentSearch.trim().toLowerCase();
    return projectDocuments.filter((docItem) => {
      const matchesFamily = documentFamilyFilter === 'todos' || docItem.family === documentFamilyFilter;
      const matchesType = documentTypeFilter === 'all' || docItem.type === documentTypeFilter;
      const matchesArea = documentAreaFilter === 'all' || docItem.area === documentAreaFilter;
      const matchesSearch = !search
        || docItem.providerName.toLowerCase().includes(search)
        || docItem.description.toLowerCase().includes(search)
        || docItem.fileName.toLowerCase().includes(search);

      return matchesFamily && matchesType && matchesArea && matchesSearch;
    });
  }, [documentAreaFilter, documentFamilyFilter, documentSearch, documentTypeFilter, projectDocuments]);

  const documentTotals = React.useMemo(() => ({
    invoices: projectDocuments.filter((docItem) => docItem.type === 'factura').length,
    receipts: projectDocuments.filter((docItem) => docItem.type === 'comprobante').length,
    finances: projectDocuments.filter((docItem) => docItem.family === 'finanzas').length,
    contracts: projectDocuments.filter((docItem) => docItem.family === 'contratos').length,
    insurance: projectDocuments.filter((docItem) => docItem.family === 'seguros').length,
    locations: projectDocuments.filter((docItem) => docItem.family === 'locaciones').length,
    visible: filteredProjectDocuments.length,
  }), [filteredProjectDocuments.length, projectDocuments]);

  const projectAreaProviderRows = React.useMemo(() => {
    const allowedCategories = canSeeFullPayroll ? categories : safeArray(userPermissions?.allowedCategories);
    const canSeeArea = (area?: string) => canSeeFullPayroll || allowedCategories.includes(area || '');
    const byProvider = new Map<string, { provider: any; areas: Set<string>; concepts: Set<string> }>();

    budgetItems.forEach((item) => {
      if (!item.providerId || !canSeeArea(item.area)) return;
      const provider = providers.find(candidate => candidate.id === item.providerId);
      if (!provider) return;

      if (!byProvider.has(item.providerId)) {
        byProvider.set(item.providerId, {
          provider,
          areas: new Set<string>(),
          concepts: new Set<string>(),
        });
      }

      const row = byProvider.get(item.providerId)!;
      if (item.area) row.areas.add(item.area);
      if (item.description) row.concepts.add(item.description);
    });

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
  }, [areaExpenses, budgetItems, canSeeFullPayroll, categories, providers, userPermissions]);

  const allProjectAreaProviderRows = React.useMemo(() => {
    const byProvider = new Map<string, { provider: any; areas: Set<string>; concepts: Set<string> }>();

    budgetItems.forEach((item) => {
      if (!item.providerId) return;
      const provider = providers.find(candidate => candidate.id === item.providerId);
      if (!provider) return;

      if (!byProvider.has(item.providerId)) {
        byProvider.set(item.providerId, {
          provider,
          areas: new Set<string>(),
          concepts: new Set<string>(),
        });
      }

      const row = byProvider.get(item.providerId)!;
      if (item.area) row.areas.add(item.area);
      if (item.description) row.concepts.add(item.description);
    });

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
  }, [areaExpenses, budgetItems, providers]);

  const canExportPayroll = canSeeFullPayroll || safeArray(userPermissions?.allowedCategories).some(isProductionArea);
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
      'Fecha Pago': item.paymentDate ? formatDate(item.paymentDate) : '',
      'Rodaje a Pago': getPaymentLeadTimeLabel(item.paymentDate, getShootingEndDate(project)),
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
        Subcategoria: cleanAreaExpenseSubcategory(item.subcategory),
        Proveedor: item.providerName || '',
        Descripcion: item.description || '',
        Unidad: item.unit || '',
        Cantidad: item.quantity || 0,
        'P Unitario': item.unitPrice || 0,
        Total: item.total || 0,
        'Fecha Pago': item.paymentDate ? formatDate(item.paymentDate) : '',
        'Rodaje a Pago': getPaymentLeadTimeLabel(item.paymentDate, getShootingEndDate(project)),
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

  const resultIncidences = React.useMemo(() => (
    project?.resultIncidences && typeof project.resultIncidences === 'object'
      ? project.resultIncidences
      : {}
  ), [project?.resultIncidences]);

  const resultCategoryTotals = React.useMemo(() => (
    categories
      .map((area) => {
        const assigned = budgetItems
          .filter((item) => item.area === area)
          .reduce((acc, item) => acc + (Number(item.total) || 0), 0);
        const spent = areaExpenses
          .filter((item) => item.area === area)
          .reduce((acc, item) => acc + (Number(item.total) || 0), 0);

        return {
          area,
          total: spent > 0 ? spent : assigned,
        };
      })
      .filter((item) => item.total > 0)
  ), [areaExpenses, budgetItems, categories]);

  const executiveTotal = resultCategoryTotals
    .filter((item) => isExecutiveArea(item.area))
    .reduce((acc, item) => acc + item.total, 0);
  const postProductionTotal = resultCategoryTotals
    .filter((item) => isPostProductionArea(item.area))
    .reduce((acc, item) => acc + item.total, 0);
  const productionCategoryTotals = resultCategoryTotals.filter((item) => !isExecutiveArea(item.area) && !isPostProductionArea(item.area));
  const productionTotal = productionCategoryTotals.reduce((acc, item) => acc + item.total, 0);
  const directCostTotal = productionTotal + executiveTotal + postProductionTotal;
  const saleValue = Number(project?.budgetTotal) || 0;
  const incidenceRows = RESULT_INCIDENCES.map((incidence) => {
    const percent = Number(resultIncidences[incidence.id]) || 0;
    return {
      ...incidence,
      percent,
      amount: saleValue * (percent / 100),
    };
  });
  const incidenceTotal = incidenceRows.reduce((acc, item) => acc + item.amount, 0);
  const totalCost = directCostTotal + incidenceTotal;
  const margin = saleValue - totalCost;
  const marginPercent = saleValue > 0 ? (margin / saleValue) * 100 : 0;

  const updateResultIncidence = async (incidenceId: string, value: number) => {
    if (!id || !isProjectAdmin) return;
    const nextIncidences = {
      ...resultIncidences,
      [incidenceId]: Math.max(0, Number(value) || 0),
    };
    await updateDoc(doc(db, 'projects', id), {
      resultIncidences: nextIncidences,
      updatedAt: serverTimestamp(),
    });
    setProject({ ...project, resultIncidences: nextIncidences });
  };

  const projectKeyPeople = React.useMemo(() => {
    const assignments = project?.keyPeople || {};
    return PROJECT_KEY_PEOPLE.map((role) => {
      const providerId = assignments?.[role.id]?.providerId || '';
      const provider = providers.find((item) => item.id === providerId) || null;
      return {
        ...role,
        providerId,
        provider,
      };
    });
  }, [project?.keyPeople, providers]);

  const updateProjectKeyPerson = async (roleId: string, providerId: string) => {
    if (!id || !isProjectAdmin) return;
    const provider = providers.find((item) => item.id === providerId);
    const nextKeyPeople = {
      ...(project?.keyPeople || {}),
      [roleId]: provider
        ? { providerId: provider.id, providerName: providerDisplayName(provider) }
        : { providerId: '', providerName: '' },
    };

    await updateDoc(doc(db, 'projects', id), {
      keyPeople: nextKeyPeople,
      updatedAt: serverTimestamp(),
    });
    setProject({ ...project, keyPeople: nextKeyPeople });
  };

  const areaSummaryRows = React.useMemo(() => {
    const targetAreas = isProjectAdmin
      ? categories
      : safeArray(userPermissions?.allowedCategories);

    return targetAreas
      .map((area) => {
        const assigned = budgetItems
          .filter((item) => item.area === area)
          .reduce((acc, item) => acc + (Number(item.total) || 0), 0);
        const spent = areaExpenses
          .filter((item) => item.area === area)
          .reduce((acc, item) => acc + (Number(item.total) || 0), 0);
        const balance = assigned - spent;
        const usedPercent = assigned > 0 ? Math.min(100, (spent / assigned) * 100) : 0;

        return { area, assigned, spent, balance, usedPercent, actualCost: isProjectAdmin && spent === 0 ? assigned : spent };
      })
      .filter((row) => row.assigned > 0 || row.spent > 0 || !isProjectAdmin);
  }, [areaExpenses, budgetItems, categories, isProjectAdmin, userPermissions]);

  const areaSummaryTotals = React.useMemo(() => {
    const totals = areaSummaryRows.reduce((acc, row) => ({
      assigned: acc.assigned + row.assigned,
      spent: acc.spent + row.spent,
      balance: acc.balance + row.balance,
      actualCost: acc.actualCost + row.actualCost,
    }), { assigned: 0, spent: 0, balance: 0, actualCost: 0 });

    return {
      ...totals,
      projectedBalance: totals.assigned - totals.actualCost,
    };
  }, [areaSummaryRows]);

  const createCashDelivery = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id || !isProjectAdmin) return;

    const formData = new FormData(event.currentTarget);
    const toEmail = normalizeEmail(formData.get('toUserEmail') as string);
    const amount = Number(formData.get('amount'));
    const notes = String(formData.get('notes') || '').trim();
    const recipient = cashResponsibles.find((item) => normalizeEmail(item.email) === toEmail);

    if (!recipient || !amount || amount <= 0) return;

    const payload = {
      type: 'entrega',
      amount,
      date: new Date(),
      toUserEmail: recipient.email,
      toUserName: recipient.displayName || recipient.email,
      notes,
      createdByEmail: currentUserEmail,
      createdByName: currentUserName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, 'projects', id, 'cashMovements'), payload);
    setCashMovements((current) => [{ id: docRef.id, ...payload, createdAt: new Date(), updatedAt: new Date() } as CashMovement, ...current]);
    event.currentTarget.reset();
  };

  const createCashTransfer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id || !isProductionLead) return;

    const formData = new FormData(event.currentTarget);
    const toEmail = normalizeEmail(formData.get('toUserEmail') as string);
    const amount = Number(formData.get('amount'));
    const notes = String(formData.get('notes') || '').trim();
    const recipient = productionTransferTargets.find((item) => normalizeEmail(item.email) === toEmail);

    if (!recipient || !amount || amount <= 0) return;
    if (amount > currentCashBalance + 0.01) {
      alert('El monto supera tu saldo disponible en caja.');
      return;
    }

    const payload = {
      type: 'transferencia',
      amount,
      date: new Date(),
      fromUserEmail: currentUserEmail,
      fromUserName: currentUserName,
      toUserEmail: recipient.email,
      toUserName: recipient.displayName || recipient.email,
      notes,
      createdByEmail: currentUserEmail,
      createdByName: currentUserName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, 'projects', id, 'cashMovements'), payload);
    setCashMovements((current) => [{ id: docRef.id, ...payload, createdAt: new Date(), updatedAt: new Date() } as CashMovement, ...current]);
    event.currentTarget.reset();
  };

  const ensureGlobalProductionLeadRole = async (targetUser: any) => {
    const userId = targetUser?.uid || targetUser?.id;
    if (!userId || ['admin', 'jefe_produccion'].includes(targetUser?.role)) return;

    try {
      await updateDoc(doc(db, 'users', userId), { role: 'jefe_produccion' });
      setAvailableUsers((current) => current.map((item) => (
        (item.uid || item.id) === userId ? { ...item, role: 'jefe_produccion' } : item
      )));
    } catch (error) {
      console.warn('No se pudo sincronizar el rol global de jefe de produccion:', error);
    }
  };

  const addCollaborator = async (selectedUser: any) => {
    if (!id || !selectedUser?.email || !canManageProjectRoles) return;

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
      if (newCollaboratorRole === 'jefe_produccion') {
        await ensureGlobalProductionLeadRole(selectedUser);
      }

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
    if (!id || !canManageProjectRoles) return;

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
      if (role === 'jefe_produccion') {
        await ensureGlobalProductionLeadRole(col);
      }
      setCollaborators(collaborators.map(c => normalizeEmail(c.email) === normalizeEmail(col.email) ? { ...c, ...updates, updatedAt: new Date() } : c));
    } catch (error) {
      console.error('Error updating collaborator role:', error);
      alert('No se pudo actualizar el rol del colaborador.');
    }
  };

  const updateCollaboratorPermissions = async (col: Collaborator, updates: Partial<Collaborator>) => {
    if (!id) return;
    if (!isProjectAdmin) {
      if (col.role !== 'jefe_area') return;
      const updateKeys = Object.keys(updates);
      if (updateKeys.some((key) => key !== 'allowedCategories')) return;
      const nextCategories = safeArray(updates.allowedCategories);
      const ownCategories = safeArray(userPermissions?.allowedCategories);
      if (nextCategories.some((category) => !ownCategories.includes(category))) return;
    }

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
    if (!id || !canManageProjectRoles || !confirm('¿Quitar acceso a ' + col.email + '?')) return;
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
        'projectDocuments',
        'cashMovements',
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

  const updateShootingRange = async (updates: { shootingStartDate?: string; shootingEndDate?: string }) => {
    if (!id || !canEditProjectOperations) return;

    const nextStart = updates.shootingStartDate ?? getShootingStartDate(project);
    const nextEnd = updates.shootingEndDate ?? (project.shootingEndDate || '');
    const payload = {
      ...updates,
      shootingDate: nextStart,
      shootingEndDate: nextEnd,
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, 'projects', id), payload);
      setProject({ ...project, ...payload, updatedAt: new Date() });
    } catch (error) {
      console.error('Error updating shooting range:', error);
      alert('No se pudo guardar el rango de rodaje.');
    }
  };

  const saveLocation = async () => {
    const nextLocation = buildGoogleMapsLink(locationDraft);
    if (!id || !canEditProjectOperations || nextLocation === (project.location || '')) return;

    setIsSavingLocation(true);
    try {
      await updateDoc(doc(db, 'projects', id), { location: nextLocation, updatedAt: serverTimestamp() });
      setProject({ ...project, location: nextLocation });
      setLocationDraft(nextLocation);
    } catch (error) {
      console.error('Error updating location:', error);
      alert('No se pudo guardar la locacion.');
    } finally {
      setIsSavingLocation(false);
    }
  };

  const renderShootingRangeControls = () => (
    <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 shadow-sm hover:border-blue-200 hover:shadow-md transition-all">
      <Calendar className="w-3.5 h-3.5 text-slate-500" />
      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Rodaje</span>
      <label className="relative min-w-[76px] text-center text-[11px] font-bold text-slate-900 cursor-pointer">
        {getShootingStartDate(project) ? formatDate(getShootingStartDate(project)) : 'Inicio'}
        <input
          type="date"
          value={toDateInputValue(getShootingStartDate(project))}
          onChange={(e) => {
            const newStart = e.target.value;
            const currentEnd = toDateInputValue(project.shootingEndDate);
            updateShootingRange({
              shootingStartDate: newStart,
              shootingEndDate: currentEnd && currentEnd < newStart ? newStart : currentEnd,
            });
          }}
          className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
          title="Inicio de rodaje"
        />
      </label>
      <span className="text-slate-300">a</span>
      <label className="relative min-w-[76px] text-center text-[11px] font-bold text-slate-900 cursor-pointer">
        {getShootingEndDate(project) ? formatDate(getShootingEndDate(project)) : 'Fin'}
        <input
          type="date"
          min={toDateInputValue(getShootingStartDate(project))}
          value={toDateInputValue(project.shootingEndDate)}
          onChange={(e) => updateShootingRange({ shootingEndDate: e.target.value })}
          className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
          title="Fin de rodaje"
        />
      </label>
    </div>
  );

  const mapsSearchUrl = buildGoogleMapsLink(locationDraft || project?.location || '');

  if (loading) return <div className="p-8 text-center text-slate-500 font-mono text-xs uppercase tracking-widest">Analizando proyecto...</div>;
  if (!project) return <div className="p-8 text-center text-slate-900 font-bold uppercase tracking-widest">Proyecto no encontrado</div>;

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="rounded-2xl border border-slate-200 bg-white/95 shadow-[0_16px_45px_rgba(15,23,42,0.12)] ring-1 ring-white backdrop-blur-sm overflow-hidden mb-4">
        <header className="px-4 md:px-5 py-3 md:py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 mb-2">
                <Link to="/proyectos" className="inline-flex items-center gap-1 hover:text-blue-700 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                  Proyectos
                </Link>
              </div>

              <div className="flex items-center gap-3">
                <div>
                  <h1 className="text-3xl md:text-4xl font-black tracking-[-0.06em] text-slate-950 leading-none">{project.name}</h1>
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] font-semibold text-slate-600">
                    {isProjectAdmin ? (
                      <>
                        <div className="relative group">
                          <select
                            aria-label="Estado del proyecto"
                            value={project.status || 'Presupuesto'}
                            onChange={async (e) => {
                              const newStatus = e.target.value;
                              await updateDoc(doc(db, 'projects', id!), { status: newStatus, updatedAt: serverTimestamp() });
                              setProject({ ...project, status: newStatus });
                            }}
                            className={cn(
                              "h-8 max-w-[180px] appearance-none rounded-full border px-3 pr-8 text-[10px] font-black uppercase tracking-wider outline-none transition-all cursor-pointer shadow-sm hover:shadow-md focus:ring-2 focus:ring-blue-100",
                              statusColors[project.status || 'Presupuesto'] || 'bg-emerald-100 text-emerald-700 border-emerald-200'
                            )}
                          >
                            {['Presupuesto', 'Pre Producción', 'Rodaje', 'Post', 'Aprobado'].map(status => (
                              <option key={status} value={status} className="bg-white text-slate-900">{status}</option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-60" />
                        </div>

                        {renderShootingRangeControls()}

                        <label className="inline-flex h-8 min-w-[260px] max-w-[430px] flex-1 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 shadow-sm hover:border-blue-200 hover:shadow-md transition-all">
                          <MapPin className="w-3.5 h-3.5 flex-none text-slate-500" />
                          <input
                            type="url"
                            aria-label="Link de Google Maps"
                            placeholder="Link de Google Maps o dirección"
                            value={locationDraft}
                            onChange={(e) => setLocationDraft(e.target.value)}
                            onBlur={saveLocation}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur();
                            }}
                            className="min-w-0 flex-1 bg-transparent text-[11px] font-bold text-slate-900 outline-none placeholder:text-slate-400"
                          />
                          {isSavingLocation && <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Guardando</span>}
                        </label>

                        {mapsSearchUrl && (
                          <a
                            href={mapsSearchUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3 text-[10px] font-black uppercase tracking-wider text-blue-700 hover:border-blue-200 hover:bg-blue-100 transition-all"
                          >
                            <LinkIcon className="w-3.5 h-3.5" /> Maps
                          </a>
                        )}
                      </>
                    ) : (
                      <>
                        <span className={cn("px-2.5 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider", statusColors[project.status || 'Presupuesto'] || 'bg-emerald-100 text-emerald-700 border-emerald-200')}>
                          {project.status || 'En producción'}
                        </span>
                        {canEditProjectOperations ? (
                          <>
                            {renderShootingRangeControls()}
                            <label className="inline-flex h-8 min-w-[260px] max-w-[430px] flex-1 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 shadow-sm hover:border-blue-200 hover:shadow-md transition-all">
                              <MapPin className="w-3.5 h-3.5 flex-none text-slate-500" />
                              <input
                                type="url"
                                aria-label="Link de Google Maps"
                                placeholder="Link de Google Maps o dirección"
                                value={locationDraft}
                                onChange={(e) => setLocationDraft(e.target.value)}
                                onBlur={saveLocation}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') event.currentTarget.blur();
                                }}
                                className="min-w-0 flex-1 bg-transparent text-[11px] font-bold text-slate-900 outline-none placeholder:text-slate-400"
                              />
                              {isSavingLocation && <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Guardando</span>}
                            </label>
                            {mapsSearchUrl && (
                              <a
                                href={mapsSearchUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3 text-[10px] font-black uppercase tracking-wider text-blue-700 hover:border-blue-200 hover:bg-blue-100 transition-all"
                              >
                                <LinkIcon className="w-3.5 h-3.5" /> Maps
                              </a>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-slate-500" /> {formatShootingRange(project)}</span>
                            <span className="hidden sm:inline text-slate-300">•</span>
                            {mapsSearchUrl ? (
                              <a href={mapsSearchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-blue-700 hover:underline">
                                <MapPin className="w-3.5 h-3.5 text-slate-500" /> Ver locación
                              </a>
                            ) : (
                              <span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-slate-500" /> Locación sin definir</span>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 lg:pt-0">
              {isProjectAdmin && (
                <button 
                  onClick={() => setShowEditProjectModal(true)}
                  className="px-3.5 py-2 border border-slate-300 bg-white rounded-lg text-[11px] font-bold hover:bg-slate-50 hover:border-slate-400 transition-all flex items-center gap-2 shadow-md shadow-slate-200/70"
                >
                  <Settings className="w-4 h-4" />
                  Editar proyecto
                </button>
              )}
              <button
                onClick={() => setShowExportModal(true)}
                disabled={!hasExportOptions}
                className="px-3.5 py-2 border border-slate-950 bg-slate-950 text-white rounded-lg text-[11px] font-bold hover:bg-slate-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-slate-900/20"
                title={hasExportOptions ? 'Exportar reportes del proyecto' : 'No tenes reportes disponibles para exportar'}
              >
                <Download className="w-4 h-4" />
                Exportar
                <ChevronDown className="w-4 h-4 opacity-70" />
              </button>
            </div>
          </div>
        </header>

        <nav className="flex gap-1.5 px-3 md:px-4 py-2 text-xs font-bold border-t border-slate-200 bg-slate-100/90 overflow-x-auto scrollbar-hide shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-3 py-2 rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 border",
                activeTab === tab.id 
                  ? "bg-white border-blue-200 text-blue-700 shadow-lg shadow-slate-300/50" 
                  : "border-transparent text-slate-600 hover:text-slate-950 hover:bg-white/70"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {activeTab === 'resumen' && (
          <div className="grid grid-cols-12 gap-3 lg:gap-5">
            <div className="col-span-12 space-y-4">
              <section className="bg-white rounded-xl border border-slate-200 shadow-[0_12px_32px_rgba(15,23,42,0.10)] ring-1 ring-white overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-slate-100 to-white">
                  <div>
                    <h3 className="font-black text-lg tracking-[-0.02em] text-slate-950">Dirección & Producción</h3>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">Responsables clave del proyecto</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowKeyPeopleData((current) => !current)}
                    className="px-3 py-2 bg-white border border-slate-200 rounded text-[10px] font-black uppercase tracking-widest text-slate-600 hover:border-black hover:text-black transition-all"
                  >
                    {showKeyPeopleData ? 'Ocultar datos' : 'Ver datos'}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200">
                  {projectKeyPeople.map(({ id: roleId, label, provider }) => (
                      <div key={roleId} className="p-4 space-y-3">
                        <div className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
                        {isProjectAdmin && (
                          <select
                            value={provider?.id || ''}
                            onChange={(event) => updateProjectKeyPerson(roleId, event.target.value)}
                            className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-bold focus:outline-none focus:border-blue-500"
                          >
                            <option value="">Sin asignar</option>
                            {providers.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>{providerDisplayName(candidate)}</option>
                            ))}
                          </select>
                        )}
                        {provider ? (
                          <div>
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-slate-950 text-white flex items-center justify-center text-sm font-black uppercase shadow-lg shadow-slate-900/20">
                                {providerDisplayName(provider)[0] || 'P'}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-black text-slate-950 truncate">{providerDisplayName(provider)}</div>
                                <div className="text-[10px] font-black text-blue-700 uppercase tracking-widest">
                                  {showKeyPeopleData ? 'Datos visibles' : 'Datos ocultos'}
                                </div>
                              </div>
                            </div>
                            {showKeyPeopleData && (
                              <div className="mt-4 text-xs text-slate-500 space-y-2 border-t border-slate-100 pt-4">
                                <div><span className="font-bold text-slate-700">Email:</span> {provider.email || provider.adminEmail || '-'}</div>
                                <div><span className="font-bold text-slate-700">Tel:</span> {provider.phone || '-'}</div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="py-4 text-[10px] font-bold uppercase tracking-widest text-slate-300">Sin asignar</div>
                        )}
                      </div>
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-2xl font-black tracking-[-0.04em] text-slate-950">
                    {isProjectAdmin ? 'Presupuesto' : 'Mis áreas asignadas'}
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="border border-slate-200 rounded-2xl p-5 bg-white text-slate-950 shadow-[0_14px_34px_rgba(15,23,42,0.11)] ring-1 ring-white">
                    {isProjectAdmin ? (
                      <>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Presupuesto</div>
                        <div className="text-3xl font-black mt-1 tracking-[-0.04em] text-slate-950">${Number(project.budgetTotal || 0).toLocaleString()}</div>
                        <div className="mt-3 text-[10px] font-semibold text-slate-500">
                          Valor total del proyecto
                          <span className="mx-2 text-slate-300">•</span>
                          Cliente: <span className="font-black text-slate-800">{project.clientName || 'Sin asignar'}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Presupuesto Asignado (Mis Áreas)</div>
                        <div className="text-3xl font-black mt-1 tracking-[-0.04em] text-slate-950">
                          ${visibleBudgetItems.reduce((acc, curr) => acc + (curr.total || 0), 0).toLocaleString()}
                        </div>
                        <div className="mt-3 text-[10px] font-semibold text-slate-500 truncate">
                          {userPermissions?.allowedCategories?.length
                            ? userPermissions.allowedCategories.join(', ')
                            : 'Sin áreas asignadas'}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="border border-slate-200 rounded-2xl p-5 bg-white text-slate-950 shadow-[0_14px_34px_rgba(15,23,42,0.11)] ring-1 ring-white">
                    <div className="flex flex-col gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-700">Saldo Proyectado</div>
                        <div className={cn("text-3xl font-black mt-1 tracking-[-0.04em]", areaSummaryTotals.projectedBalance >= 0 ? "text-slate-950" : "text-rose-600")}>${areaSummaryTotals.projectedBalance.toLocaleString()}</div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-left md:text-right">
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Asignado áreas</div>
                          <div className="text-base font-black text-slate-950">${areaSummaryTotals.assigned.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Gastado</div>
                          <div className="text-base font-black text-slate-950">${areaSummaryTotals.spent.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Costo proyectado</div>
                          <div className="text-base font-black text-slate-950">${areaSummaryTotals.actualCost.toLocaleString()}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  {areaSummaryRows.map((row) => (
                    <div key={row.area} className="border border-slate-200 rounded-xl p-4 bg-white shadow-[0_10px_26px_rgba(15,23,42,0.10)] ring-1 ring-white hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(15,23,42,0.13)] transition-all">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <div className="text-base font-black tracking-[-0.02em] text-slate-950">{row.area}</div>
                          <div className="text-[10px] font-black text-blue-700 uppercase tracking-widest mt-1">{row.usedPercent.toFixed(0)}% consumido</div>
                        </div>
                        <div className={cn("text-sm font-black font-mono", row.balance >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          ${row.balance.toLocaleString()}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Asignado</div>
                          <div className="text-xs font-bold text-slate-900">${row.assigned.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Gastado</div>
                          <div className="text-xs font-bold text-slate-900">${row.spent.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Diferencia</div>
                          <div className={cn("text-xs font-bold", row.balance >= 0 ? "text-emerald-600" : "text-rose-600")}>${row.balance.toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="mt-3 h-2 bg-slate-200 rounded-full overflow-hidden shadow-inner">
                        <div className={cn("h-full rounded-full", row.balance < 0 ? "bg-rose-500" : row.usedPercent >= 85 ? "bg-yellow-400" : "bg-emerald-500")} style={{ width: `${row.usedPercent}%` }} />
                      </div>
                    </div>
                  ))}
                  {areaSummaryRows.length === 0 && (
                    <div className="md:col-span-2 p-6 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                      No hay áreas asignadas con presupuesto o gastos
                    </div>
                  )}
                </div>
              </section>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                  <h3 className="font-bold text-[10px] uppercase tracking-widest">Descripción del Proyecto</h3>
                </div>
                <div className="p-8 text-slate-600 leading-relaxed text-sm">
                    {project.description || 'No hay una descripción extendida registrada para esta producción audiovisual.'}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'presupuesto' && (
          <div className="space-y-4 pb-20">
            <header className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Planilla de Presupuesto</h2>
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
                    <button
                      type="button"
                      onClick={() => setShowCopyBudgetModal(true)}
                      className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2 rounded"
                    >
                      <ArrowRight className="w-3 h-3" />
                      Copiar presupuesto
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
              <div className="min-w-[1200px]">
                {/* Header Row */}
                <div className="grid grid-cols-12 bg-slate-50 border-b border-slate-200 px-4 py-3 gap-2">
                  <div className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Proveedor / Profesional</div>
                  <div className="col-span-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Descripción / Tarea</div>
                  <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">P. Unitario</div>
                  <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Cant.</div>
                  <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Total</div>
                  <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Fecha Pago</div>
                  <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Rodaje → Pago</div>
                  <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Pagado</div>
                  <div className="col-span-1"></div>
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
                                    <div className="flex items-center gap-3 flex-1">
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
                                                      <div className="grid grid-cols-12 w-full items-center gap-2">
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
                                                        <div className="col-span-1">
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
                                                          {renderPaymentScheduleCell(item, 'budgetItems', !canEditMainBudget || activeAreas.includes(item.area))}
                                                        </div>
                                                        <div className="col-span-1">
                                                          {renderPaymentLeadTimeCell(item)}
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
                                                        <div className="col-span-1 text-right">
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
                  <div className="col-span-10 text-right text-[11px] font-bold uppercase tracking-widest text-slate-400">Total presupuesto del proyecto</div>
                  <div className="col-span-1 text-right text-xl font-bold font-mono">
                    ${visibleBudgetItems.reduce((acc, curr) => acc + (curr.total || 0), 0).toLocaleString()}
                  </div>
                  <div className="col-span-1"></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'areas' && (
          <div className="space-y-4 pb-20">
            <header className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Gestión por Áreas</h2>
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

            {/* Multi-select buttons for Active Areas */}
            <div className="flex flex-col lg:flex-row gap-2">
            <div className="flex-1 flex items-center gap-2 p-1 bg-slate-100 rounded-lg overflow-x-auto scrollbar-hide">
              {visibleCategories.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedAreaTabs(visibleCategories)}
                    className="shrink-0 px-3 py-2 text-[9px] uppercase font-black tracking-widest rounded-md bg-white border border-slate-200 text-slate-500 hover:border-black hover:text-black transition-colors"
                  >
                    Todas
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedAreaTabs([])}
                    className="shrink-0 px-3 py-2 text-[9px] uppercase font-black tracking-widest rounded-md bg-white border border-slate-200 text-slate-500 hover:border-black hover:text-black transition-colors"
                  >
                    Limpiar
                  </button>
                  <div className="h-6 w-px shrink-0 bg-slate-200" />
                </>
              )}
              {visibleCategories.map((area) => (
                <button
                  key={area}
                  onClick={() => setSelectedAreaTabs((current) => (
                    current.includes(area)
                      ? current.filter((item) => item !== area)
                      : [...current, area]
                  ))}
                  className={cn(
                    "px-4 py-2 text-[10px] uppercase font-bold tracking-widest rounded-md transition-all whitespace-nowrap",
                    selectedVisibleAreas.includes(area)
                      ? "bg-slate-900 text-white shadow-sm"
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
            <div className="shrink-0 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1 bg-white border border-slate-200 rounded-lg">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Orden</span>
                <select
                  value={areaExpenseSort}
                  onChange={(event) => setAreaExpenseSort(event.target.value as AreaExpenseSortKey)}
                  className="bg-transparent text-[10px] font-bold text-slate-700 focus:outline-none"
                >
                  {AREA_EXPENSE_SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 bg-white border border-slate-200 rounded-lg min-w-[220px]">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input
                  value={areaExpenseSearch}
                  onChange={(event) => setAreaExpenseSearch(event.target.value)}
                  placeholder="Buscar gasto..."
                  className="w-full bg-transparent text-[10px] font-bold text-slate-700 placeholder:text-slate-300 focus:outline-none"
                />
              </div>
            </div>
            </div>

            {selectedAreaDashboardRows.length > 0 && (
              <div className="space-y-4">
                {/* Summary Header */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {(() => {
                    const assigned = areaDashboardTotals.assigned;
                    const spent = areaDashboardTotals.spent;
                    const balance = areaDashboardTotals.balance;
                    const usedPercent = assigned > 0 ? Math.min(100, (spent / assigned) * 100) : 0;

                    return (
                      <>
                        <div className="bg-white border border-slate-200 px-4 py-3 rounded-lg shadow-sm">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Presupuesto</div>
                          <div className="text-base font-bold text-slate-900">${assigned.toLocaleString()}</div>
                          <div className="text-[9px] text-slate-400 mt-1 italic">{selectedAreaDashboardRows.length} áreas seleccionadas</div>
                        </div>
                        <div className="bg-white border border-slate-200 px-4 py-3 rounded-lg shadow-sm">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Gasto Global</div>
                          <div className="text-base font-bold text-emerald-600">${spent.toLocaleString()}</div>
                          <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={cn("h-full rounded-full", balance < 0 ? "bg-red-500" : usedPercent >= 85 ? "bg-yellow-400" : "bg-emerald-500")}
                              style={{ width: `${usedPercent}%` }}
                            />
                          </div>
                          <div className="text-[9px] text-slate-400 mt-1 italic">{areaDashboardTotals.records} registros cargados</div>
                        </div>
                        <div className={cn(
                          "px-4 py-3 rounded-lg shadow-sm border bg-white",
                          balance >= 0 ? "border-slate-200 text-slate-950" : "border-red-100 text-red-600"
                        )}>
                          <div className={cn("text-[10px] font-bold uppercase tracking-widest mb-1", balance >= 0 ? "text-blue-700" : "text-red-400")}>Saldo Proyectado</div>
                          <div className="text-base font-bold font-mono tracking-tight">${balance.toLocaleString()}</div>
                          {balance < 0 && <div className="text-[9px] font-bold uppercase mt-1">¡EXCEDIDO!</div>}
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                {selectedAreaDashboardRows.map((areaRow) => (
                <div
                  key={areaRow.area}
                  onDragOver={(event) => {
                    if (!isAreaExpenseDrag(event) || !canEditArea(areaRow.area)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDragOverAreaTarget(`area:${areaRow.area}`);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverAreaTarget(null);
                  }}
                  onDrop={(event) => {
                    if (!isAreaExpenseDrag(event)) return;
                    event.preventDefault();
                    finishAreaExpenseDrop(areaRow.area);
                  }}
                  className={cn(
                    "border-b border-slate-100 last:border-0 transition-colors",
                    dragOverAreaTarget === `area:${areaRow.area}` && "bg-emerald-50/50"
                  )}
                >
                  <div className="bg-slate-900 text-white px-4 py-3 flex justify-between items-center border-l-4 border-emerald-400 shadow-sm">
                    <div className="flex items-center gap-3">
                       <button
                         type="button"
                         onClick={() => toggleCategory(areaRow.area)}
                         className="p-1 text-slate-300 hover:text-white transition-colors"
                         title={collapsedCategories[areaRow.area] ? 'Expandir área' : 'Colapsar área'}
                       >
                         {collapsedCategories[areaRow.area] ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                       </button>
                       <h3 className="text-[12px] font-black uppercase tracking-[0.18em] text-white flex items-center gap-2">
                         <LayoutGrid className="w-3 h-3" />
                         {areaRow.area}
                       </h3>
                       <span className="text-[10px] text-slate-300 font-bold">({areaRow.expenses.length} ítems)</span>
                       {isProjectAdmin && (
                         <button 
                           onClick={() => removeActiveArea(areaRow.area)}
                           className="text-[9px] text-slate-400 hover:text-red-300 font-bold uppercase tracking-widest transition-colors"
                           title="Desactivar gestión de esta área"
                         >
                           Desactivar Gestión
                         </button>
                       )}
                    </div>
                     <div className="flex items-center gap-4">
                      <div className="text-[10px] font-black tracking-widest text-emerald-300">
                        SUBTOTAL: ${areaRow.spent.toLocaleString()}
                      </div>
                      <button
                        onClick={() => createAreaExpenseSubcategory(areaRow.area)}
                        disabled={!canEditArea(areaRow.area)}
                        className="px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-800 bg-white border border-slate-200 rounded hover:bg-slate-100 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
                        title="Crear subcategoria"
                      >
                        Subcategoria
                      </button>
                      <button
                        onClick={() => addAreaExpense(areaRow.area)}
                        disabled={!canEditArea(areaRow.area)}
                        className="p-1.5 text-slate-800 bg-white border border-slate-200 rounded hover:bg-slate-100 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
                        title="Registrar gasto"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {!collapsedCategories[areaRow.area] && (
                  <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-6 py-4 border-b border-slate-100 bg-white">
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Asignado</div>
                      <div className="text-sm font-black text-slate-900">${areaRow.assigned.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Gastado</div>
                      <div className="text-sm font-black text-emerald-600">${areaRow.spent.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Saldo</div>
                          <div className={cn("text-sm font-black", areaRow.balance >= 0 ? "text-slate-900" : "text-red-600")}>${areaRow.balance.toLocaleString()}</div>
                        </div>
                        <div className="w-28 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", areaRow.balance < 0 ? "bg-red-500" : areaRow.usedPercent >= 85 ? "bg-yellow-400" : "bg-emerald-500")}
                            style={{ width: `${areaRow.usedPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="min-w-[1200px]">
                    <div className="grid grid-cols-12 bg-slate-50 border-b border-slate-200 px-6 py-3 gap-2">
                      <div className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Proveedor / Concepto</div>
                      <div className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Descripción Detallada</div>
                      <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Factura</div>
                      <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">P. Unitario</div>
                      <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Cant.</div>
                      <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Total</div>
                      <div className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Fecha Pago</div>
                      <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Rodaje → Pago</div>
                      <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Pagado</div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {areaRow.subcategoryGroups.map((subcategoryGroup) => {
                        const subcategoryKey = `${areaRow.area}__${subcategoryGroup.subcategory}`;
                        const isSubcategoryCollapsed = collapsedAreaSubcategories[subcategoryKey];

                        return (
                          <div
                            key={subcategoryKey}
                            onDragOver={(event) => {
                              if (!isAreaExpenseDrag(event) || !canEditArea(areaRow.area)) return;
                              event.preventDefault();
                              event.stopPropagation();
                              event.dataTransfer.dropEffect = 'move';
                              setDragOverAreaTarget(`subcategory:${subcategoryKey}`);
                            }}
                            onDragLeave={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverAreaTarget(null);
                            }}
                            onDrop={(event) => {
                              if (!isAreaExpenseDrag(event)) return;
                              event.preventDefault();
                              event.stopPropagation();
                              finishAreaExpenseDrop(areaRow.area, subcategoryGroup.subcategory);
                            }}
                            className={cn(
                              "bg-white transition-colors",
                              dragOverAreaTarget === `subcategory:${subcategoryKey}` && "bg-emerald-50"
                            )}
                          >
                            {subcategoryGroup.subcategory && (
                            <div className="flex items-center justify-between gap-3 px-6 py-2 bg-slate-50/70 border-b border-slate-100">
                              <div className="flex items-center gap-2 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => setCollapsedAreaSubcategories((current) => ({
                                    ...current,
                                    [subcategoryKey]: !current[subcategoryKey],
                                  }))}
                                  className="p-1 text-slate-400 hover:text-slate-900 transition-colors"
                                  title={isSubcategoryCollapsed ? 'Expandir subcategoria' : 'Colapsar subcategoria'}
                                >
                                  {isSubcategoryCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>
                                <div className="text-[10px] font-black uppercase tracking-widest text-slate-700 truncate">
                                  {subcategoryGroup.subcategory}
                                </div>
                                <span className="text-[9px] font-bold text-slate-400">
                                  {subcategoryGroup.expenses.length} gastos
                                </span>
                              </div>
                              <div className="text-[10px] font-black font-mono text-slate-700">
                                ${subcategoryGroup.subtotal.toLocaleString()}
                              </div>
                            </div>
                            )}
                            {(!subcategoryGroup.subcategory || !isSubcategoryCollapsed) && (
                              <div className="divide-y divide-slate-100">
                      {subcategoryGroup.expenses.map((item) => (
                          <div
                            key={item.id}
                            draggable={canEditArea(item.area)}
                            onDragStart={(event) => startAreaExpenseDrag(event, item)}
                            onDragEnd={() => {
                              setDraggedAreaExpenseId(null);
                              setDragOverAreaTarget(null);
                            }}
                            onDragEnter={(event) => {
                              if (isAreaExpenseDrag(event)) return;
                              event.preventDefault();
                              if (canUploadAreaFiles(item.area)) setDragOverExpenseId(item.id);
                            }}
                            onDragOver={(event) => {
                              if (isAreaExpenseDrag(event)) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = canUploadAreaFiles(item.area) ? 'copy' : 'none';
                              if (canUploadAreaFiles(item.area)) setDragOverExpenseId(item.id);
                            }}
                            onDragLeave={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                                setDragOverExpenseId(null);
                              }
                            }}
                            onDrop={(event) => {
                              if (isAreaExpenseDrag(event)) return;
                              canUploadAreaFiles(item.area) && handleInvoiceDrop(event, item);
                            }}
                            className={cn(
                              "relative grid grid-cols-12 px-6 py-3 items-center gap-2 transition-colors group",
                              dragOverExpenseId === item.id
                                ? "bg-emerald-50 ring-2 ring-inset ring-emerald-400"
                                : draggedAreaExpenseId === item.id
                                  ? "bg-slate-100 opacity-70"
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
                              <div className="flex items-start gap-2">
                                {canEditArea(item.area) && (
                                  <div className="pt-1 text-slate-300 group-hover:text-slate-500 cursor-grab active:cursor-grabbing" title="Arrastrar gasto">
                                    <GripVertical className="w-3.5 h-3.5" />
                                  </div>
                                )}
                                <BudgetRowCell
                                  item={item}
                                  providers={providers}
                                  onUpdate={updateAreaExpense}
                                  onDelete={deleteAreaExpense}
                                  type="provider"
                                  disabled={!canEditArea(item.area)}
                                />
                              </div>
                            </div>
                            <div className="col-span-2">
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
                            <div className="col-span-1">
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
                            <div className="col-span-2">
                              {renderPaymentScheduleCell(item, 'areaExpenses', !canEditArea(item.area))}
                            </div>
                            <div className="col-span-1">
                              {renderPaymentLeadTimeCell(item)}
                            </div>
                            <div className="col-span-1 flex items-center justify-center gap-2">
                               <BudgetRowCell 
                                 item={item} 
                                 onUpdate={updateAreaExpense} 
                                 type="paid"
                                 onManagePayment={(item) => openPaymentModal(item, 'areaExpenses')}
                                 disabledPayment={!canEditArea(item.area)}
                               />
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
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {areaRow.expenses.length === 0 && (
                        <div className="p-12 text-center text-slate-300 font-bold uppercase tracking-widest text-[10px] italic">
                          Sin gastos registrados en esta área
                        </div>
                      )}
                    </div>
                  </div>
                  </>
                  )}
                </div>
                ))}
                </div>
              </div>
            )}
            {visibleCategories.length > 0 && selectedAreaDashboardRows.length === 0 && (
              <div className="bg-white border border-dashed border-slate-200 rounded-xl p-6 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                Seleccioná una o más áreas para ver gastos y presupuesto
              </div>
            )}
          </div>
        )}

        {activeTab === 'cajas' && (
          <div className="space-y-5 pb-20">
            <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Cajas por Responsable</h2>
                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">
                  Entregas de efectivo, pagos rendidos y saldos disponibles por persona
                </p>
              </div>
              <div className="px-4 py-3 bg-slate-900 text-white rounded-xl text-right">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Mi saldo</div>
                <div className="text-xl font-black font-mono">${currentCashBalance.toLocaleString()}</div>
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {isProjectAdmin && (
                <form onSubmit={createCashDelivery} className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Entregar efectivo</h3>
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mt-1">Admin a responsable del proyecto</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Responsable</label>
                      <select
                        name="toUserEmail"
                        value={cashRecipientEmail}
                        onChange={(event) => setCashRecipientEmail(event.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded text-xs font-bold focus:outline-none focus:border-black"
                      >
                        {cashResponsibles.map((responsible) => (
                          <option key={responsible.email} value={responsible.email}>
                            {responsible.displayName || responsible.email} · {roleLabels[responsible.role]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Monto</label>
                      <input name="amount" type="number" min="0" step="0.01" required className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded text-xs font-bold focus:outline-none focus:border-black" />
                    </div>
                  </div>
                  <input name="notes" placeholder="Nota opcional" className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded text-xs focus:outline-none focus:border-black" />
                  <button type="submit" className="w-full px-4 py-3 bg-black text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all">
                    Registrar entrega
                  </button>
                </form>
              )}

              {isProductionLead && (
                <form onSubmit={createCashTransfer} className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Transferir a Jefe de Área</h3>
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mt-1">Desde tu caja disponible</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Destino</label>
                      <select
                        name="toUserEmail"
                        value={cashTransferTargetEmail}
                        onChange={(event) => setCashTransferTargetEmail(event.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded text-xs font-bold focus:outline-none focus:border-black"
                      >
                        {productionTransferTargets.map((responsible) => (
                          <option key={responsible.email} value={responsible.email}>
                            {responsible.displayName || responsible.email}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Monto</label>
                      <input name="amount" type="number" min="0" max={Math.max(0, currentCashBalance)} step="0.01" required className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded text-xs font-bold focus:outline-none focus:border-black" />
                    </div>
                  </div>
                  <input name="notes" placeholder="Nota opcional" className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded text-xs focus:outline-none focus:border-black" />
                  <button type="submit" disabled={currentCashBalance <= 0 || productionTransferTargets.length === 0} className="w-full px-4 py-3 bg-black text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all disabled:bg-slate-300 disabled:cursor-not-allowed">
                    Transferir efectivo
                  </button>
                </form>
              )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {visibleCashRows.map((row) => (
                <div key={row.email} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-black text-slate-900 truncate">{row.responsible.displayName || row.email}</div>
                      <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mt-1">{roleLabels[row.responsible.role]} · {safeArray(row.responsible.allowedCategories).join(', ') || 'Sin áreas'}</div>
                    </div>
                    <div className="text-right">
                      <div className={cn("text-xl font-black font-mono", row.balance >= 0 ? "text-emerald-600" : "text-red-600")}>${row.balance.toLocaleString()}</div>
                      <div className="text-[9px] uppercase tracking-widest text-slate-400 font-bold">Saldo</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
                    <div className="p-4">
                      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Recibido</div>
                      <div className="text-sm font-black text-slate-900 mt-1">${row.received.toLocaleString()}</div>
                    </div>
                    <div className="p-4">
                      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Pagado</div>
                      <div className="text-sm font-black text-slate-900 mt-1">${row.used.toLocaleString()}</div>
                    </div>
                    <div className="p-4">
                      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Transferido</div>
                      <div className="text-sm font-black text-slate-900 mt-1">${row.transferred.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {row.movements.slice(0, 12).map((movement) => {
                      const incoming = normalizeEmail(movement.toUserEmail) === row.email;
                      const signedAmount = incoming ? Number(movement.amount) || 0 : -(Number(movement.amount) || 0);
                      return (
                        <div key={movement.id} className="px-5 py-3 flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 truncate">
                              {movement.type === 'entrega' ? 'Entrega recibida' : movement.type === 'transferencia' ? (incoming ? 'Transferencia recibida' : 'Transferencia enviada') : 'Pago en efectivo'}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {movement.description || movement.notes || movement.area || 'Movimiento de caja'} · {formatDate(movement.date || movement.createdAt)}
                            </div>
                          </div>
                          <div className={cn("text-xs font-black font-mono", signedAmount >= 0 ? "text-emerald-600" : "text-rose-600")}>
                            {signedAmount >= 0 ? '+' : '-'}${Math.abs(signedAmount).toLocaleString()}
                          </div>
                        </div>
                      );
                    })}
                    {row.movements.length === 0 && (
                      <div className="px-5 py-8 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                        Sin movimientos de caja
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {visibleCashRows.length === 0 && (
                <div className="xl:col-span-2 bg-white border border-dashed border-slate-200 rounded-xl p-8 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                  No hay responsables con caja para mostrar
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'proveedores' && (
          <div className="space-y-4 pb-20">
            <header>
              <h2 className="text-lg font-bold text-slate-900">Proveedores del Proyecto</h2>
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

        {activeTab === 'resultado' && isProjectAdmin && (
          <div className="space-y-4 pb-20">
            <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Resultado del Proyecto</h2>
                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">
                  Analisis de venta, costos, incidencias y margen
                </p>
              </div>
              <div className={cn(
                "px-4 py-3 rounded-xl border text-right",
                margin >= 0 ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100"
              )}>
                <div className={cn("text-[10px] font-bold uppercase tracking-widest", margin >= 0 ? "text-emerald-700" : "text-rose-700")}>
                  Margen estimado
                </div>
                <div className={cn("text-2xl font-black font-mono", margin >= 0 ? "text-emerald-700" : "text-rose-700")}>
                  ${margin.toLocaleString()}
                </div>
                <div className="text-[10px] font-bold text-slate-500">{marginPercent.toFixed(1)}% sobre venta</div>
              </div>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Valor de Venta</div>
                <div className="text-lg font-bold text-slate-900">${saleValue.toLocaleString()}</div>
                <div className="text-[9px] text-slate-400 mt-2">Presupuesto cargado en el proyecto</div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Produccion</div>
                <div className="text-lg font-bold text-slate-900">${productionTotal.toLocaleString()}</div>
                <div className="text-[9px] text-slate-400 mt-2">{productionCategoryTotals.length} categorias con costo</div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Ejecutiva</div>
                <div className="text-lg font-bold text-slate-900">${executiveTotal.toLocaleString()}</div>
                <div className="text-[9px] text-slate-400 mt-2">Separado de Produccion</div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Post Produccion</div>
                <div className="text-lg font-bold text-slate-900">${postProductionTotal.toLocaleString()}</div>
                <div className="text-[9px] text-slate-400 mt-2">Separado de Produccion</div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Incidencias</div>
                <div className="text-lg font-bold text-slate-900">${incidenceTotal.toLocaleString()}</div>
                <div className="text-[9px] text-slate-400 mt-2">Sobre valor de venta</div>
              </div>
              <div className="bg-slate-900 p-5 rounded-xl border border-slate-900 shadow-sm text-white">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Costo Total</div>
                <div className="text-xl font-bold font-mono">${totalCost.toLocaleString()}</div>
                <div className="text-[9px] text-slate-400 mt-2">Directos + incidencias</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Costo directo por categoria</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {resultCategoryTotals.map((category) => {
                    const percent = directCostTotal > 0 ? (category.total / directCostTotal) * 100 : 0;
                    return (
                      <div key={category.area} className="p-4">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div className="text-xs font-black uppercase tracking-wider text-slate-900">{category.area}</div>
                          <div className="text-sm font-bold font-mono text-slate-900">${category.total.toLocaleString()}</div>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-slate-900 rounded-full" style={{ width: `${Math.min(100, percent)}%` }} />
                        </div>
                        <div className="text-[9px] font-bold text-slate-400 mt-2">{percent.toFixed(1)}% del costo directo</div>
                      </div>
                    );
                  })}
                  {resultCategoryTotals.length === 0 && (
                    <div className="p-6 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                      Sin categorias con costo
                    </div>
                  )}
                </div>
              </section>

              <section className="lg:col-span-7">
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Incidencias sobre valor de venta</h3>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {incidenceRows.map((incidence) => (
                      <div key={incidence.id} className="grid grid-cols-12 gap-3 px-5 py-4 items-center">
                        <div className="col-span-5 text-xs font-bold uppercase tracking-wider text-slate-700">{incidence.label}</div>
                        <div className="col-span-3">
                          <div className="relative">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              defaultValue={incidence.percent}
                              onBlur={(event) => updateResultIncidence(incidence.id, Number(event.target.value))}
                              className="w-full px-3 py-2 pr-7 bg-slate-50 border border-slate-100 rounded text-xs font-bold focus:outline-none focus:border-black"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">%</span>
                          </div>
                        </div>
                        <div className="col-span-4 text-right text-sm font-bold font-mono text-slate-900">
                          ${incidence.amount.toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
                {[
                  { label: 'Valor de venta', value: saleValue, tone: 'text-slate-900' },
                  { label: 'Produccion', value: -productionTotal, tone: 'text-rose-600' },
                  { label: 'Ejecutiva', value: -executiveTotal, tone: 'text-rose-600' },
                  { label: 'Post Produccion', value: -postProductionTotal, tone: 'text-rose-600' },
                  { label: 'Incidencias', value: -incidenceTotal, tone: 'text-rose-600' },
                  { label: 'Margen', value: margin, tone: margin >= 0 ? 'text-emerald-600' : 'text-rose-600' },
                ].map((item) => (
                  <div key={item.label} className="p-5">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{item.label}</div>
                    <div className={cn("text-xl font-black font-mono", item.tone)}>
                      {item.value < 0 ? '-' : ''}${Math.abs(item.value).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'saldos' && (
          <div className="space-y-4 pb-20">
            <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
              <h2 className="text-lg font-bold text-slate-900">Finanzas del Proyecto</h2>
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">
                {isProjectAdmin ? 'Pagos, deuda, facturas y comprobantes por proveedor' : 'Vista financiera limitada a tus areas asignadas'}
              </p>
              </div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {filteredProviderSaldos.length} proveedores con movimientos
              </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Presupuestado</div>
                <div className="text-lg font-bold text-slate-900">${financeTotals.budgeted.toLocaleString()}</div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Gastado (Facturado)</div>
                <div className="text-lg font-bold text-slate-900">${financeTotals.spent.toLocaleString()}</div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 text-emerald-600">Total Pagado</div>
                <div className="text-xl font-bold text-emerald-600">${financeTotals.paid.toLocaleString()}</div>
              </div>
              <div className="bg-slate-900 p-5 rounded-xl border border-slate-900 shadow-sm text-white">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Deuda Pendiente</div>
                <div className="text-xl font-bold font-mono">${financeTotals.debt.toLocaleString()}</div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Docs</div>
                <div className="text-lg font-bold text-slate-900">{financeTotals.invoices}/{financeTotals.receipts}</div>
                <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-2">Facturas / comprobantes</div>
              </div>
            </div>


            <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Flujo de Pagos</h3>
                    <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                      Proyección por fecha de pago · {formatPeriodLabel(paymentScheduleAnchor, 'month')}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const anchor = parseProjectDate(paymentScheduleAnchor) || new Date();
                      setPaymentScheduleAnchor(formatDateKey(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)));
                      setSelectedPaymentBucketKey(null);
                      setExpandedPaymentLineId(null);
                    }}
                    className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest hover:border-black"
                  >
                    Mes anterior
                  </button>
                  <label className="relative px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-bold text-slate-900 text-center cursor-pointer min-w-[150px]">
                    {formatPeriodLabel(paymentScheduleAnchor, 'month')}
                    <input
                      type="month"
                      value={paymentScheduleAnchor.slice(0, 7)}
                      onChange={(event) => {
                        setPaymentScheduleAnchor(`${event.target.value}-01`);
                        setSelectedPaymentBucketKey(null);
                        setExpandedPaymentLineId(null);
                      }}
                      className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const anchor = parseProjectDate(paymentScheduleAnchor) || new Date();
                      setPaymentScheduleAnchor(formatDateKey(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)));
                      setSelectedPaymentBucketKey(null);
                      setExpandedPaymentLineId(null);
                    }}
                    className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest hover:border-black"
                  >
                    Mes siguiente
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-0 lg:items-stretch">
                <div className="p-4 border-b lg:border-b-0 lg:border-r border-slate-100 space-y-4">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { label: 'A pagar hoy', value: paymentScheduleStats.todayDebt, count: paymentScheduleStats.todayLines.length, tone: 'text-slate-900' },
                      { label: 'A pagar mes', value: paymentScheduleStats.periodDebt, count: paymentScheduleStats.periodLines.length, tone: 'text-blue-700' },
                      { label: 'Vencidos', value: paymentScheduleStats.overdueDebt, count: paymentScheduleStats.overdueLines.length, tone: 'text-rose-600' },
                      { label: 'Sin fecha', value: paymentScheduleStats.unscheduledDebt, count: paymentScheduleStats.unscheduledLines.length, tone: 'text-amber-600' },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{item.label}</div>
                        <div className={cn("mt-1 text-lg font-black font-mono", item.tone)}>${item.value.toLocaleString()}</div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-300 mt-1">{item.count} pagos</div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
                    <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-100">
                      {['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map((day) => (
                        <div key={day} className="px-2 py-2 text-center text-[9px] font-black uppercase tracking-widest text-slate-400">{day}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7">
                      {paymentScheduleCalendarDays.map((day) => {
                        const isSelected = selectedPaymentBucket?.key === day.key;
                        const hasPayments = day.count > 0;
                        const isHeavy = day.total >= paymentScheduleStats.periodDebt / 4 && paymentScheduleStats.periodDebt > 0;
                        return (
                          <button
                            key={day.key}
                            type="button"
                            onClick={() => {
                              setSelectedPaymentBucketKey(day.key);
                              setExpandedPaymentLineId(null);
                            }}
                            className={cn(
                              "min-h-[86px] border-r border-b border-slate-100 p-2 text-left transition-all hover:bg-slate-50",
                              !day.isCurrentMonth && "bg-slate-50/60 text-slate-300",
                              isSelected && "ring-2 ring-inset ring-slate-900 bg-white",
                              day.isToday && "bg-blue-50",
                              hasPayments && !isSelected && (isHeavy ? "bg-rose-50 hover:bg-rose-100" : "bg-amber-50 hover:bg-amber-100")
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={cn(
                                "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black",
                                day.isToday ? "bg-blue-600 text-white" : "text-slate-700"
                              )}>
                                {day.dayNumber}
                              </span>
                              {hasPayments && <span className="text-[9px] font-black text-rose-600">{day.count}</span>}
                            </div>
                            {hasPayments && (
                              <div className="mt-3">
                                <div className="text-[10px] font-black font-mono text-slate-900">${day.total.toLocaleString()}</div>
                                <div className="mt-1 h-1.5 rounded-full bg-white/80 overflow-hidden">
                                  <div
                                    className={cn("h-full rounded-full", isHeavy ? "bg-rose-500" : "bg-amber-500")}
                                    style={{ width: `${Math.min(100, Math.max(12, (day.total / Math.max(paymentScheduleStats.periodDebt, 1)) * 100))}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <aside className="p-4 bg-slate-50/50 flex min-h-[520px] flex-col">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h4 className="text-xs font-black text-slate-900">{selectedPaymentBucket ? formatDate(selectedPaymentBucket.date) : 'Sin seleccion'}</h4>
                      <p className="text-[9px] uppercase font-bold tracking-widest text-slate-400">Proveedores a pagar en el dia</p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black font-mono text-slate-900">${(selectedPaymentBucket?.total || 0).toLocaleString()}</div>
                      <div className="text-[9px] uppercase font-bold tracking-widest text-slate-300">Total</div>
                    </div>
                  </div>

                  <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
                    {(selectedPaymentBucket?.lines || []).map((line) => {
                      const isExpanded = expandedPaymentLineId === line.id;
                      return (
                      <div
                        key={line.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpandedPaymentLineId(isExpanded ? null : line.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setExpandedPaymentLineId(isExpanded ? null : line.id);
                          }
                        }}
                        className={cn(
                          "w-full cursor-pointer rounded-lg border bg-white p-3 text-left transition-all",
                          isExpanded ? "border-slate-900 shadow-sm" : "border-slate-100 hover:border-slate-300"
                        )}
                      >
                        <div className="flex justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-black text-slate-900 truncate">{line.providerName}</div>
                            <div className="text-[10px] text-slate-500 truncate">{line.description}</div>
                            <div className="text-[9px] uppercase font-bold tracking-widest text-slate-300 mt-1">{line.area} · {line.source}</div>
                          </div>
                          <div className="text-right text-xs font-black font-mono text-rose-600 whitespace-nowrap">${line.debt.toLocaleString()}</div>
                        </div>
                        {isExpanded && (
                          <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2">
                            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">CBU / Alias</div>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate font-mono text-[10px] font-bold text-slate-700">
                                {line.cbu || 'No especificado'}
                              </span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (line.cbu) void navigator.clipboard?.writeText(line.cbu);
                                }}
                                disabled={!line.cbu}
                                className={cn(
                                  "shrink-0 rounded border px-2 py-1 text-[9px] font-black uppercase tracking-widest",
                                  line.cbu
                                    ? "border-slate-200 bg-white text-slate-700 hover:border-black"
                                    : "border-slate-100 bg-white text-slate-300 cursor-not-allowed"
                                )}
                              >
                                Copiar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                    })}
                    {selectedPaymentBucket && selectedPaymentBucket.lines.length === 0 && (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                        Sin pagos programados
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </section>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Buscar</label>
                <input
                  value={financeSearch}
                  onChange={(event) => setFinanceSearch(event.target.value)}
                  placeholder="Proveedor o concepto"
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded text-xs font-medium focus:outline-none focus:border-black"
                />
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Area</label>
                <select
                  value={financeAreaFilter}
                  onChange={(event) => setFinanceAreaFilter(event.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded text-xs font-bold focus:outline-none focus:border-black"
                >
                  <option value="all">Todas</option>
                  {providerSaldosByArea.map((group) => (
                    <option key={group.area} value={group.area}>{group.area}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Estado de pago</label>
                <select
                  value={financeStatusFilter}
                  onChange={(event) => setFinanceStatusFilter(event.target.value as any)}
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded text-xs font-bold focus:outline-none focus:border-black"
                >
                  <option value="all">Todos</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="parcial">Parcial</option>
                  <option value="pagado">Pagado</option>
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Factura</label>
                <select
                  value={financeInvoiceFilter}
                  onChange={(event) => setFinanceInvoiceFilter(event.target.value as any)}
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded text-xs font-bold focus:outline-none focus:border-black"
                >
                  <option value="all">Todas</option>
                  <option value="with">Con factura</option>
                  <option value="without">Sin factura</option>
                </select>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
               <table className="w-full text-left">
                 <thead>
                   <tr className="bg-slate-50 border-b border-slate-200">
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Proveedor</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Cuenta</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Presupuesto</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Gastado</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Pagado</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Deuda</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Documentos / Pagos</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100">
                   {filteredProviderSaldosByArea.map((group) => (
                     <React.Fragment key={group.area}>
                       <tr className="bg-slate-100/70">
                         <td colSpan={7} className="px-6 py-3 text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">
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
                               {isProjectAdmin ? saldo.cbu : 'Disponible para admins'}
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
                       <td className="px-6 py-4">
                         <div className="space-y-2">
                           {saldo.entries.map((entry) => {
                             const entryDebt = entry.total - entry.paid;
                             const paymentReceipts = safeArray(entry.item?.paymentHistory).filter((payment: any) => payment.receipt?.url);
                             return (
                               <div key={`${entry.collectionName}-${entry.id}`} className="flex flex-wrap items-center gap-2 text-[10px]">
                                 <span className="max-w-[170px] truncate text-slate-500" title={entry.description}>
                                   {entry.description || 'Movimiento'}
                                 </span>
                                 {entry.item?.paymentDate && (
                                   <span className="px-2 py-1 rounded bg-slate-50 border border-slate-100 text-slate-500 font-bold uppercase tracking-widest">
                                     Pago {formatDate(entry.item.paymentDate)} · {getPaymentLeadTimeLabel(entry.item.paymentDate, getShootingEndDate(project))}
                                   </span>
                                 )}
                                 <span className={cn(
                                   "px-2 py-1 rounded border font-bold uppercase tracking-widest",
                                   entryDebt > 0 ? "bg-rose-50 border-rose-100 text-rose-700" : "bg-emerald-50 border-emerald-100 text-emerald-700"
                                 )}>
                                   {entryDebt > 0 ? `$${entryDebt.toLocaleString()} debe` : 'Pagado'}
                                 </span>
                                 {entry.invoice?.url && (
                                   <a
                                     href={entry.invoice.url}
                                     target="_blank"
                                     rel="noreferrer"
                                     className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold uppercase tracking-widest hover:bg-emerald-600 hover:text-white"
                                     title={entry.invoice.fileName || 'Ver factura'}
                                   >
                                     <FileText className="w-3 h-3" />
                                     Factura
                                   </a>
                                 )}
                                 {paymentReceipts.map((payment: any, index: number) => (
                                   <a
                                     key={payment.id || index}
                                     href={payment.receipt.url}
                                     target="_blank"
                                     rel="noreferrer"
                                     className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-100 font-bold uppercase tracking-widest hover:bg-blue-600 hover:text-white"
                                     title={payment.receipt.originalFileName || 'Ver comprobante'}
                                   >
                                     <Paperclip className="w-3 h-3" />
                                     Comp.
                                   </a>
                                 ))}
                                 {canManagePaymentForItem(entry.item, entry.collectionName) && (
                                   <button
                                     type="button"
                                     onClick={() => openPaymentModal(entry.item, entry.collectionName)}
                                     className={cn(
                                       "px-2 py-1 rounded border font-bold uppercase tracking-widest transition-all",
                                       entryDebt > 0
                                         ? "bg-white border-slate-200 text-slate-600 hover:border-black hover:text-black"
                                         : "bg-emerald-50 border-emerald-100 text-emerald-700"
                                     )}
                                   >
                                     {entryDebt > 0 ? 'Registrar pago' : 'Pagado'}
                                   </button>
                                 )}
                               </div>
                             );
                           })}
                         </div>
                       </td>
                     </tr>
                   ))}
                     </React.Fragment>
                   ))}
                   {providerSaldos.length === 0 && (
                     <tr>
                       <td colSpan={7} className="px-6 py-12 text-center text-[10px] font-bold uppercase text-slate-300 tracking-widest italic">
                         No hay movimientos financieros con proveedores registrados
                       </td>
                     </tr>
                   )}
                   {providerSaldos.length > 0 && filteredProviderSaldos.length === 0 && (
                     <tr>
                       <td colSpan={7} className="px-6 py-12 text-center text-[10px] font-bold uppercase text-slate-300 tracking-widest italic">
                         No hay movimientos que coincidan con los filtros
                       </td>
                     </tr>
                   )}
                 </tbody>
               </table>
            </div>

            <div className="p-6 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-blue-600 shadow-sm">
                <Info className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-blue-900 uppercase tracking-widest mb-1">Sobre el cálculo de deudas</h4>
                <p className="text-xs text-blue-700 leading-relaxed max-w-2xl">
                  El "Saldo Deudor" se calcula restando lo marcado como <b>Pagado</b> del total <b>Gastado</b>. 
                  Los administradores pueden registrar pagos desde esta pantalla o desde la carga por areas.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'documentos' && (
          <div className="space-y-4 pb-20">
            <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Documentos del Proyecto</h2>
                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">
                  Centro documental por familia: finanzas, contratos, seguros y locaciones
                </p>
              </div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {documentTotals.visible} documentos visibles
              </div>
              {canUploadProjectDocuments && (
                <button
                  type="button"
                  onClick={() => setShowDocumentUploadModal(true)}
                  className="px-4 py-2 bg-black text-white text-[10px] font-bold uppercase tracking-widest rounded flex items-center gap-2 hover:bg-slate-800 transition-all"
                >
                  <Upload className="w-3 h-3" />
                  Subir documento
                </button>
              )}
            </header>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 p-1 bg-slate-100 rounded-xl">
              {DOCUMENT_FAMILIES.map((family) => {
                const count = family.id === 'todos'
                  ? projectDocuments.length
                  : projectDocuments.filter((docItem) => docItem.family === family.id).length;
                const selected = documentFamilyFilter === family.id;
                return (
                  <button
                    key={family.id}
                    type="button"
                    onClick={() => setDocumentFamilyFilter(family.id)}
                    className={cn(
                      "px-4 py-3 rounded-lg text-left transition-all",
                      selected ? "bg-white shadow-sm text-slate-900" : "text-slate-400 hover:text-slate-700"
                    )}
                  >
                    <div className="text-[10px] font-black uppercase tracking-widest">{family.label}</div>
                    <div className="text-lg font-black mt-1">{count}</div>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {[
                { label: 'Facturas', value: documentTotals.invoices },
                { label: 'Comprobantes', value: documentTotals.receipts },
                { label: 'Contratos', value: documentTotals.contracts },
                { label: 'Seguros / Locaciones', value: documentTotals.insurance + documentTotals.locations },
              ].map((item) => (
                <div key={item.label} className="bg-white p-4 rounded-xl border border-slate-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{item.label}</div>
                  <div className="text-lg font-bold text-slate-900">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Familia</label>
                <select
                  value={documentFamilyFilter}
                  onChange={(event) => setDocumentFamilyFilter(event.target.value as any)}
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded text-xs font-bold focus:outline-none focus:border-black"
                >
                  {DOCUMENT_FAMILIES.map((family) => (
                    <option key={family.id} value={family.id}>{family.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Buscar</label>
                <input
                  value={documentSearch}
                  onChange={(event) => setDocumentSearch(event.target.value)}
                  placeholder="Proveedor, concepto o archivo"
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded text-xs font-medium focus:outline-none focus:border-black"
                />
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Tipo</label>
                <select
                  value={documentTypeFilter}
                  onChange={(event) => setDocumentTypeFilter(event.target.value as any)}
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded text-xs font-bold focus:outline-none focus:border-black"
                >
                  <option value="all">Todos</option>
                  <option value="factura">Facturas</option>
                  <option value="comprobante">Comprobantes</option>
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Area</label>
                <select
                  value={documentAreaFilter}
                  onChange={(event) => setDocumentAreaFilter(event.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded text-xs font-bold focus:outline-none focus:border-black"
                >
                  <option value="all">Todas</option>
                  {providerSaldosByArea.map((group) => (
                    <option key={group.area} value={group.area}>{group.area}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Familia</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Tipo</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Documento</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Proveedor</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Area</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Monto</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Origen</th>
                    <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Archivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProjectDocuments.map((docItem) => (
                    <tr key={docItem.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-4">
                        <span className="inline-flex px-2 py-1 rounded border border-slate-100 bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-500">
                          {DOCUMENT_FAMILIES.find((family) => family.id === docItem.family)?.label || docItem.family}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-1 rounded border text-[9px] font-black uppercase tracking-widest",
                          docItem.type === 'factura'
                            ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                            : "bg-blue-50 border-blue-100 text-blue-700"
                        )}>
                          {docItem.type === 'factura' ? <FileText className="w-3 h-3" /> : <Paperclip className="w-3 h-3" />}
                          {docItem.type}
                        </span>
                      </td>
                      <td className="px-5 py-4 max-w-[260px]">
                        <div className="text-xs font-bold text-slate-900 truncate">{docItem.fileName}</div>
                        <div className="text-[10px] text-slate-400 truncate">{docItem.description}</div>
                      </td>
                      <td className="px-5 py-4 text-xs font-bold text-slate-700">{docItem.providerName}</td>
                      <td className="px-5 py-4 text-xs text-slate-500">{docItem.area}</td>
                      <td className="px-5 py-4 text-right text-xs font-bold text-slate-700">{docItem.amount > 0 ? `$${docItem.amount.toLocaleString()}` : '-'}</td>
                      <td className="px-5 py-4 text-xs text-slate-500">{docItem.paymentDate ? `${docItem.source} / ${formatDate(docItem.paymentDate)}` : docItem.source}</td>
                      <td className="px-5 py-4 text-right">
                        <a
                          href={docItem.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-slate-200 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:border-black hover:text-black"
                        >
                          Abrir
                          <LinkIcon className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                  {filteredProjectDocuments.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-[10px] font-bold uppercase text-slate-300 tracking-widest italic">
                        {documentFamilyFilter === 'contratos'
                          ? 'Todavia no hay contratos cargados en el proyecto'
                          : documentFamilyFilter === 'seguros'
                            ? 'Todavia no hay seguros cargados en el proyecto'
                            : documentFamilyFilter === 'locaciones'
                              ? 'Todavia no hay documentos de locaciones cargados'
                              : 'No hay documentos que coincidan con los filtros'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'equipo' && (
          <div className="space-y-12">
            <header className="flex justify-between items-center">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-slate-900">Equipo de Trabajo</h2>
                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">
                  Producción y Staff de Producción por rubro
                </p>
              </div>
            </header>

            {/* Equipo de Producción */}
            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 underline decoration-slate-200 underline-offset-8">Dirección y Producción</h3>
                <div className="h-[1px] bg-slate-100 flex-1"></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* Dueño / Creador */}
                <div className="bg-white border-2 border-slate-900 p-5 rounded-xl shadow-sm flex items-center justify-between group hover:shadow-md transition-all">
                  <div className="flex items-center gap-3">
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
                    <div className="flex items-center gap-3">
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
                    <div className="flex items-center gap-3">
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
              <div className="flex items-center gap-3">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 underline decoration-slate-200 underline-offset-8">Personal de Rubros</h3>
                <div className="h-[1px] bg-slate-100 flex-1"></div>
              </div>
              {visibleCategories.map(area => {
                const areaTeam = visibleBudgetItems.filter(i => i.area === area && (i.providerId || i.providerName));
                if (areaTeam.length === 0) return null;

                return (
                  <div key={area} className="space-y-4 px-4">
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-300">{area}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {areaTeam.map((member) => (
                        <div key={member.id} className="bg-white border border-slate-100 p-4 rounded-xl shadow-sm flex items-center justify-between group hover:border-slate-300 transition-all">
                          <div className="flex items-center gap-3">
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

        {activeTab === 'permisos' && canAssignProjectAreas && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-8">
            <div className="max-w-5xl mx-auto space-y-12">
              <header className="text-center">
                <Shield className="w-12 h-12 text-slate-900 mx-auto mb-4" />
                <h2 className="text-xl font-bold mb-2">Permisos del Proyecto</h2>
                <p className="text-sm text-slate-500 max-w-2xl mx-auto">
                  {isProjectAdmin
                    ? 'Agregá usuarios que ya se hayan logueado y definí si son admins del proyecto, jefes de producción o jefes de área. Esto no cambia su rol global en la app.'
                    : 'Como Jefe de Producción podés asignar tus áreas a otros Jefes de Área del proyecto, sin cambiar roles ni permisos de administración.'}
                </p>
              </header>

              {canManageProjectRoles ? (
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

                <div className="lg:col-span-7 space-y-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Rol dentro del proyecto</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {PROJECT_ADMIN_ROLE_OPTIONS.map((role) => (
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
              ) : (
                <div className="p-5 bg-slate-50 border border-slate-100 rounded-2xl text-sm text-slate-500">
                  Seleccioná abajo qué áreas propias querés habilitar para cada Jefe de Área. Tu acceso a esas áreas se mantiene intacto.
                </div>
              )}

              <div className="pt-8 border-t border-slate-100">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 font-mono">Jefes del Proyecto</h3>
                <div className="space-y-4">
                  {visiblePermissionCollaborators.length === 0 ? (
                    <div className="text-center py-10 border border-dashed border-slate-200 rounded-lg text-slate-300 font-bold uppercase text-[10px] tracking-widest">
                      No hay jefes de área disponibles en este proyecto
                    </div>
                  ) : (
                    visiblePermissionCollaborators.map(col => (
                      <div key={col.email} className="p-6 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-3 mb-8">
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={col.photoURL || `https://ui-avatars.com/api/?name=${col.displayName || col.email || 'U'}&background=000&color=fff`}
                              alt="Avatar"
                              className="w-10 h-10 rounded-full border border-slate-200"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-bold truncate">{col.displayName || col.email}</div>
                              <div className="text-[10px] text-slate-400 font-medium truncate">{col.email}</div>
                              <div className="text-[9px] text-slate-400 font-bold uppercase mt-1">{roleLabels[col.role] || 'Jefe de Área'}</div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 items-center justify-end">
                            {canManageProjectRoles && (
                            <div className="flex gap-1 bg-white p-1 rounded border border-slate-200">
                              {roleOptionsForCurrentUser.map((role) => (
                                <button
                                  key={role}
                                  onClick={() => updateCollaboratorRole(col, role)}
                                  className={cn(
                                    "px-2 py-1 text-[8px] font-bold uppercase tracking-widest rounded transition-all",
                                    col.role === role ? "bg-black text-white" : "text-slate-400 hover:text-black"
                                  )}
                                >
                                  {role === 'jefe_area' ? 'Área' : role === 'jefe_produccion' ? 'Producción' : 'Admin'}
                                </button>
                              ))}
                            </div>
                            )}
                            {canManageProjectRoles && (
                            <button
                              className="text-[10px] text-red-500 font-bold uppercase tracking-widest hover:underline"
                              onClick={() => removeCollaborator(col)}
                            >
                              Eliminar
                            </button>
                            )}
                          </div>
                        </div>

                        {col.role !== 'admin' ? (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {canManageProjectRoles && (
                            <div>
                              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 font-mono">Pestañas Permitidas</div>
                              <div className="flex flex-wrap gap-2">
                                {tabs.filter(t => t.id !== 'permisos' && t.id !== 'resultado').map(tab => {
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
                            )}

                            <div>
                              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 font-mono">Áreas de Presupuesto</div>
                              <div className="flex flex-wrap gap-2">
                                {(isProjectAdmin ? categories : safeArray(userPermissions?.allowedCategories)).map(cat => {
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

                            {canManageProjectRoles && (
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
                            )}
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


        {(activeTab !== 'resumen' && activeTab !== 'presupuesto' && activeTab !== 'equipo' && activeTab !== 'areas' && activeTab !== 'saldos' && activeTab !== 'documentos' && activeTab !== 'resultado' && activeTab !== 'proveedores' && activeTab !== 'permisos') && (
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

              <div className="p-4 space-y-3">
                {canExportPayroll && (
                  <div className="border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
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
                    <div className="border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
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

                    <div className="border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
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
        {showCopyBudgetModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[260] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-widest text-slate-900 flex items-center gap-2">
                    <ArrowRight className="w-4 h-4" />
                    Copiar presupuesto principal
                  </h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                    Copia partidas y categorías sin pagos ni comprobantes
                  </p>
                </div>
                <button onClick={() => setShowCopyBudgetModal(false)} className="text-slate-400 hover:text-black">
                  <Plus className="w-5 h-5 rotate-45" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <input
                  value={copyBudgetSearch}
                  onChange={(event) => setCopyBudgetSearch(event.target.value)}
                  placeholder="Buscar proyecto por nombre, cliente o estado"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black"
                />

                <div className="max-h-[360px] overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {filteredSourceProjects.map((sourceProject) => {
                    const selected = selectedSourceProjectId === sourceProject.id;
                    return (
                      <button
                        key={sourceProject.id}
                        type="button"
                        onClick={() => setSelectedSourceProjectId(sourceProject.id)}
                        className={cn(
                          "w-full text-left px-5 py-4 transition-all flex items-center justify-between gap-4",
                          selected ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50 text-slate-700"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-black truncate">{sourceProject.name || 'Proyecto sin nombre'}</div>
                          <div className={cn("text-[10px] font-bold uppercase tracking-widest mt-1 truncate", selected ? "text-white/60" : "text-slate-400")}>
                            {sourceProject.clientName || 'Sin cliente'} · {sourceProject.status || 'Sin estado'}
                          </div>
                        </div>
                        <div className={cn("text-[10px] font-black uppercase tracking-widest", selected ? "text-emerald-300" : "text-slate-300")}>
                          {selected ? 'Seleccionado' : 'Usar'}
                        </div>
                      </button>
                    );
                  })}
                  {filteredSourceProjects.length === 0 && (
                    <div className="px-5 py-10 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                      No hay proyectos disponibles para copiar
                    </div>
                  )}
                </div>

                {budgetItems.length > 0 && (
                  <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-800">
                    Este proyecto ya tiene {budgetItems.length} partidas. Al copiar, se reemplazará el presupuesto principal actual.
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCopyBudgetModal(false)}
                    className="px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!selectedSourceProjectId || isCopyingBudget}
                    onClick={copyBudgetFromProject}
                    className="px-4 py-3 bg-black text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  >
                    {isCopyingBudget ? 'Copiando...' : 'Copiar presupuesto'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
        <PaymentModal
          projectId={id}
          item={selectedItemForPayment}
          isOpen={paymentModalOpen}
          canManagePayments={canManagePaymentForItem(selectedItemForPayment, selectedItemForPayment?.__paymentCollection || paymentType)}
          canUseCashBox={canManagePaymentForItem(selectedItemForPayment, selectedItemForPayment?.__paymentCollection || paymentType) && currentCashBalance > 0}
          cashBoxBalance={currentCashBalance}
          cashOwnerEmail={currentUserEmail}
          cashOwnerName={currentUserName}
          paymentType={paymentType}
          isDeletingPayment={isDeletingPayment}
          canEditExistingPayments={isProjectAdmin}
          onClose={() => setPaymentModalOpen(false)}
          onPaymentStateChange={updatePaymentState}
          onDeletePayment={deletePaymentFromSelectedItem}
          onCashMovementCreated={(movement) => setCashMovements((current) => [movement as CashMovement, ...current])}
          onCashMovementUpdated={(movementId, updates) => setCashMovements((current) => current.map((movement) => (
            movement.id === movementId ? { ...movement, ...updates } : movement
          )))}
        />
        {showDocumentUploadModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[260] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-widest text-slate-900 flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Subir Documento
                  </h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Contratos, seguros y locaciones</p>
                </div>
                <button onClick={() => setShowDocumentUploadModal(false)} className="text-slate-400 hover:text-black">
                  <Plus className="w-5 h-5 rotate-45" />
                </button>
              </div>

              <form onSubmit={uploadProjectDocument} className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Familia</label>
                    <select name="family" defaultValue={documentFamilyFilter !== 'todos' && documentFamilyFilter !== 'finanzas' ? documentFamilyFilter : 'contratos'} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black">
                      {MANUAL_DOCUMENT_FAMILIES.map((family) => (
                        <option key={family.id} value={family.id}>{family.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Tipo</label>
                    <select name="subtype" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black">
                      {[...DOCUMENT_SUBTYPES.contratos, ...DOCUMENT_SUBTYPES.seguros, ...DOCUMENT_SUBTYPES.locaciones]
                        .filter((value, index, array) => array.indexOf(value) === index)
                        .map((subtype) => (
                          <option key={subtype} value={subtype}>{subtype}</option>
                        ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Titulo</label>
                  <input name="title" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black" placeholder="Ej: Poliza RC productora / Contrato director" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Proveedor</label>
                    <select name="providerId" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black">
                      <option value="">Sin proveedor</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>{providerDisplayName(provider)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Area</label>
                    <select name="area" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black">
                      <option value="">General</option>
                      {categories.map((area) => (
                        <option key={area} value={area}>{area}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Vencimiento</label>
                    <input name="expirationDate" type="date" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black" />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Archivo</label>
                  <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black" required />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Notas</label>
                  <textarea name="notes" rows={3} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black resize-none" placeholder="Observaciones, condiciones o datos utiles" />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowDocumentUploadModal(false)} className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-black">
                    Cancelar
                  </button>
                  <button disabled={isUploadingProjectDocument} type="submit" className="px-5 py-3 bg-black text-white rounded text-[10px] font-bold uppercase tracking-widest disabled:bg-slate-300">
                    {isUploadingProjectDocument ? 'Subiendo...' : 'Subir documento'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
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
              }} className="p-8 space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Nombre de la Producción</label>
                  <input name="name" defaultValue={project.name} required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" />
                </div>
                <div className="grid grid-cols-2 gap-3">
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
