import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { normalizeEmail, normalizeSearchText } from './identity';
import { buildAssistantCapabilities } from './assistantCapabilities';
import type { AssistantProjectContext, AssistantProvider } from './assistantTools';
import { calculateProjectFinance, getItemTotal, getPaymentTotal, getStandaloneBudgetItems } from './projectFinance';
import { getReimbursedCents, isThirdPartyPayment } from './reimbursements';

export type AssistantProjectHandle = {
  id: string;
  name: string;
  clientName?: string;
};

export type AssistantProjectFinance = {
  projectId: string;
  name: string;
  status: string;
  clientName: string;
  budgetTotal: number;
  spent: number;
  paid: number;
  margin: number;
  debt: number;
  pendingLines: number;
  usagePercent: number;
  overBudget: number;
  payableLines: AssistantPayableLine[];
};

export type AssistantPayableLine = {
  id: string;
  projectId: string;
  projectName: string;
  area: string;
  providerName: string;
  description: string;
  total: number;
  paid: number;
  debt: number;
  paymentDate: string;
  source: 'area' | 'budget' | 'reimbursement';
};

// Lista los proyectos a los que el usuario tiene acceso, con las mismas dos
// consultas que usa la pantalla de Proyectos (dueño o colaborador invitado).
export const listAssistantProjects = async ({
  uid,
  email,
  isAppAdmin = false,
}: {
  uid: string;
  email: string;
  isAppAdmin?: boolean;
}): Promise<AssistantProjectHandle[]> => {
  const results = new Map<string, AssistantProjectHandle>();
  const normalizedEmail = normalizeEmail(email);
  const collect = (docs: Array<{ id: string; data: () => any }>) => {
    docs.forEach((entry) => {
      const data = entry.data() || {};
      results.set(entry.id, {
        id: entry.id,
        name: String(data.name || 'Proyecto sin nombre'),
        clientName: data.clientName || '',
      });
    });
  };

  // Los administradores de la aplicación ven todos los proyectos, igual que en
  // la pantalla de Proyectos; el resto ve los propios y los compartidos.
  if (isAppAdmin) {
    try {
      const all = await getDocs(collection(db, 'projects'));
      collect(all.docs);
      return Array.from(results.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    } catch (error) {
      console.warn('No pude listar todos los proyectos para el asistente:', error);
    }
  }

  if (uid) {
    try {
      const owned = await getDocs(query(collection(db, 'projects'), where('createdBy', '==', uid)));
      collect(owned.docs);
    } catch (error) {
      console.warn('No pude listar los proyectos propios para el asistente:', error);
    }
  }
  if (normalizedEmail) {
    try {
      const shared = await getDocs(query(collection(db, 'projects'), where('collaboratorEmails', 'array-contains', normalizedEmail)));
      collect(shared.docs);
    } catch (error) {
      console.warn('No pude listar los proyectos compartidos para el asistente:', error);
    }
  }

  return Array.from(results.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
};

const mapDocs = (docs: Array<{ id: string; data: () => any }>) => (
  docs.map((entry) => ({ id: entry.id, ...entry.data() }))
);

// Carga el contexto de un proyecto usando la sesión del usuario: las reglas de
// Firestore son las que deciden qué puede leer y qué no.
export const loadAssistantProjectContext = async ({
  projectId,
  uid,
  email,
  globalRole,
}: {
  projectId: string;
  uid: string;
  email: string;
  globalRole?: string | null;
}): Promise<AssistantProjectContext | null> => {
  try {
    const projectSnap = await getDoc(doc(db, 'projects', projectId));
    if (!projectSnap.exists()) return null;
    const project = projectSnap.data() || {};

    const normalizedEmail = normalizeEmail(email);
    let collaborator: any = null;
    try {
      const collaboratorSnap = await getDoc(doc(db, 'projects', projectId, 'collaborators', normalizedEmail));
      collaborator = collaboratorSnap.exists() ? collaboratorSnap.data() : null;
    } catch (error) {
      collaborator = null;
    }

    const capabilities = buildAssistantCapabilities({
      projectId,
      projectName: String(project.name || ''),
      projectCreatedBy: String(project.createdBy || ''),
      categories: project.categories,
      activeAreas: project.activeAreas,
      userId: uid,
      globalRole: globalRole || null,
      collaborator,
    });
    if (!capabilities.can.viewProject) return null;

    const [budgetSnap, areaSnap, cashSnap] = await Promise.all([
      getDocs(collection(db, 'projects', projectId, 'budgetItems')),
      getDocs(collection(db, 'projects', projectId, 'areaExpenses')),
      getDocs(collection(db, 'projects', projectId, 'cashMovements')),
    ]);

    const canSeeCollaborators = capabilities.can.manageCollaborators
      || capabilities.can.assignCollaboratorAreas
      || capabilities.tabs.includes('permisos');
    const collaborators = canSeeCollaborators
      ? mapDocs((await getDocs(collection(db, 'projects', projectId, 'collaborators'))).docs)
      : [];
    const documents = capabilities.tabs.includes('documentos')
      ? mapDocs((await getDocs(collection(db, 'projects', projectId, 'projectDocuments'))).docs)
      : [];

    return {
      projectId,
      projectName: String(project.name || ''),
      userEmail: normalizedEmail,
      capabilities,
      meta: {
        clientName: String(project.clientName || ''),
        companyName: String(project.companyName || ''),
        brandName: String(project.brandName || ''),
        status: String(project.status || ''),
        budgetTotal: Number(project.budgetTotal) || 0,
        shootingStartDate: String(project.shootingStartDate || ''),
        shootingEndDate: String(project.shootingEndDate || ''),
        location: String(project.location || ''),
        projectCode: String(project.projectCode || ''),
        areaExpenseSubcategories: project.areaExpenseSubcategories && typeof project.areaExpenseSubcategories === 'object'
          ? project.areaExpenseSubcategories
          : {},
        areaExpenseSubcategoryBudgets: project.areaExpenseSubcategoryBudgets && typeof project.areaExpenseSubcategoryBudgets === 'object'
          ? project.areaExpenseSubcategoryBudgets
          : {},
        resultIncidences: project.resultIncidences && typeof project.resultIncidences === 'object'
          ? project.resultIncidences
          : {},
      },
      categories: Array.isArray(project.categories) ? project.categories : [],
      activeAreas: Array.isArray(project.activeAreas) ? project.activeAreas : [],
      budgetItems: mapDocs(budgetSnap.docs),
      areaExpenses: mapDocs(areaSnap.docs),
      cashMovements: mapDocs(cashSnap.docs),
      collaborators,
      documents,
    };
  } catch (error) {
    console.warn('No pude cargar el proyecto para el asistente:', error);
    return null;
  }
};

// Cálculo liviano por proyecto para el resumen general (mismo criterio que el Dashboard).
export const loadAssistantProjectFinance = async (projectId: string): Promise<AssistantProjectFinance | null> => {
  try {
    const projectSnap = await getDoc(doc(db, 'projects', projectId));
    if (!projectSnap.exists()) return null;
    const project: any = { id: projectId, ...projectSnap.data() };
    const [budgetSnap, areaSnap] = await Promise.all([
      getDocs(collection(db, 'projects', projectId, 'budgetItems')),
      getDocs(collection(db, 'projects', projectId, 'areaExpenses')),
    ]);
    const budgetItems = mapDocs(budgetSnap.docs);
    const areaExpenses = mapDocs(areaSnap.docs);
    const finance = calculateProjectFinance(project, budgetItems, areaExpenses);
    const projectName = String(project.name || 'Proyecto sin nombre');
    const payableLines: AssistantPayableLine[] = [
      ...areaExpenses.map((item) => ({
        id: item.id,
        projectId,
        projectName,
        area: String(item.area || 'Sin area'),
        providerName: String(item.providerName || ''),
        description: String(item.description || ''),
        total: getItemTotal(item),
        paid: getPaymentTotal(item),
        debt: Math.max(0, getItemTotal(item) - getPaymentTotal(item)),
        paymentDate: String(item.paymentDate || ''),
        source: 'area' as const,
      })),
      ...getStandaloneBudgetItems(project, budgetItems).map((item: any) => ({
        id: item.id,
        projectId,
        projectName,
        area: String(item.area || 'Sin area'),
        providerName: String(item.providerName || ''),
        description: String(item.description || ''),
        total: getItemTotal(item),
        paid: getPaymentTotal(item),
        debt: Math.max(0, getItemTotal(item) - getPaymentTotal(item)),
        paymentDate: String(item.paymentDate || ''),
        source: 'budget' as const,
      })),
    ];
    // Reintegros a terceros: deuda con la persona que adelantó el pago.
    [...areaExpenses, ...getStandaloneBudgetItems(project, budgetItems)].forEach((item: any) => {
      (Array.isArray(item.paymentHistory) ? item.paymentHistory : []).forEach((payment: any, index: number) => {
        if (!isThirdPartyPayment(payment)) return;
        const total = Number(payment.amount) || 0;
        const paid = getReimbursedCents(payment) / 100;
        payableLines.push({
          id: `${item.id}-reintegro-${payment.id || index}`,
          projectId,
          projectName,
          area: String(item.area || 'Sin area'),
          providerName: String(payment.thirdPartyPayerName || 'Persona sin identificar'),
          description: `Reintegro por ${item.description || 'gasto'}`,
          total,
          paid,
          debt: Math.max(0, total - paid),
          paymentDate: String(payment.date || ''),
          source: 'reimbursement',
        });
      });
    });
    return {
      projectId,
      name: projectName,
      status: String(project.status || ''),
      clientName: String(project.clientName || ''),
      budgetTotal: Number(finance.budgetTotal) || 0,
      spent: Number(finance.spent) || 0,
      paid: Number(finance.paid) || 0,
      margin: Number(finance.margin) || 0,
      debt: Number(finance.debt) || 0,
      pendingLines: Number(finance.unpaidLines) || 0,
      usagePercent: Number(finance.usagePercent) || 0,
      overBudget: Number(finance.overBudget) || 0,
      payableLines,
    };
  } catch (error) {
    console.warn('No pude calcular las finanzas del proyecto para el asistente:', error);
    return null;
  }
};

export const loadAssistantProviders = async (): Promise<AssistantProvider[]> => {
  try {
    const snapshot = await getDocs(collection(db, 'providers'));
    return mapDocs(snapshot.docs);
  } catch (error) {
    console.warn('No pude cargar los proveedores para el asistente:', error);
    return [];
  }
};

export type AssistantClient = {
  id: string;
  businessName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  cuit?: string;
};

export type AssistantUser = {
  id: string;
  email?: string;
  displayName?: string;
  role?: string;
};

export const loadAssistantClients = async (): Promise<AssistantClient[]> => {
  try {
    const snapshot = await getDocs(collection(db, 'clients'));
    return mapDocs(snapshot.docs);
  } catch (error) {
    console.warn('No pude cargar los clientes para el asistente:', error);
    return [];
  }
};

export const loadAssistantUsers = async (): Promise<AssistantUser[]> => {
  try {
    const snapshot = await getDocs(collection(db, 'users'));
    return mapDocs(snapshot.docs);
  } catch (error) {
    console.warn('No pude cargar los usuarios para el asistente:', error);
    return [];
  }
};

export const findProjectByReference = (
  projects: AssistantProjectHandle[],
  reference: unknown,
) => {
  const raw = String(reference || '').trim();
  if (!raw) return null;
  const direct = projects.find((project) => project.id === raw);
  if (direct) return direct;
  const text = normalizeSearchText(raw);
  return projects.find((project) => normalizeSearchText(project.name) === text)
    || projects.find((project) => normalizeSearchText(project.name).includes(text))
    || projects.find((project) => normalizeSearchText(project.clientName || '').includes(text) && text.length > 3)
    || null;
};
